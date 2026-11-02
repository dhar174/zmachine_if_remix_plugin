import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { hash, id, LIMITS, requireThat, validateFixture } from './model.js';

// Single-process experiment. SQLite is the commit boundary, not a product kernel.
export class ProbeStore {
  constructor(directory, owners, { clock = Date.now, limits = LIMITS } = {}) {
    this.clock = clock; this.limits = limits; this.grants = new Map();
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(directory, 'probe.sqlite'));
    this.db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;
      CREATE TABLE IF NOT EXISTS sessions(owner TEXT PRIMARY KEY, id TEXT UNIQUE, label TEXT, revision INTEGER);
      CREATE TABLE IF NOT EXISTS candidates(id TEXT PRIMARY KEY, owner TEXT, session TEXT, request TEXT, payload TEXT, value TEXT, expires INTEGER, UNIQUE(owner,session,request));
      CREATE TABLE IF NOT EXISTS receipts(owner TEXT, session TEXT, request TEXT, payload TEXT, value TEXT, PRIMARY KEY(owner,session,request));
      CREATE TABLE IF NOT EXISTS imports(id TEXT PRIMARY KEY, owner TEXT, session TEXT, value TEXT, bytes BLOB, expires INTEGER);
      DELETE FROM candidates;`);
    for (const owner of owners) this.db.prepare('INSERT OR IGNORE INTO sessions VALUES (?,?,?,0)').run(owner, id(), 'Probe Chamber');
    this.cleanup();
  }
  cleanup() {
    const now = this.clock();
    this.db.prepare('DELETE FROM candidates WHERE expires <= ?').run(now);
    this.db.prepare('DELETE FROM imports WHERE expires <= ?').run(now);
    for (const [key, grant] of this.grants) if (grant.expires <= now) this.grants.delete(key);
  }
  state(owner, session) {
    const row = this.db.prepare('SELECT * FROM sessions WHERE owner=?').get(owner);
    requireThat(row && (!session || row.id === session), 'NOT_FOUND', 404);
    return { session_id: row.id, room_label: row.label, revision: row.revision };
  }
  receipt(owner, session, request) {
    this.state(owner, session);
    const row = this.db.prepare('SELECT value FROM receipts WHERE owner=? AND session=? AND request=?').get(owner, session, request);
    requireThat(row, 'NOT_FOUND', 404);
    return JSON.parse(row.value);
  }
  candidate(owner, session, candidateId) {
    this.state(owner, session);
    const row = this.db.prepare('SELECT value FROM candidates WHERE id=? AND owner=? AND session=? AND expires>?').get(candidateId, owner, session, this.clock());
    requireThat(row, 'NOT_FOUND', 404);
    return JSON.parse(row.value);
  }
  prepare(owner, args) {
    const state = this.state(owner, args.session_id); this.cleanup();
    const payload = hash(JSON.stringify(args));
    const previous = this.db.prepare('SELECT * FROM candidates WHERE owner=? AND session=? AND request=?').get(owner, args.session_id, args.request_id);
    if (previous) { requireThat(previous.payload === payload, 'IDEMPOTENCY_CONFLICT', 409); return JSON.parse(previous.value); }
    requireThat(args.expected_revision === state.revision, 'STALE_REVISION', 409);
    requireThat(args.room_label !== state.room_label, 'NO_CHANGE');
    const count = this.db.prepare('SELECT COUNT(*) AS n FROM candidates WHERE owner=? AND session=?').get(owner, args.session_id).n;
    requireThat(count < this.limits.candidates, 'CANDIDATE_LIMIT', 429);
    const candidate = { candidate_id: id(), session_id: args.session_id,
      operation: 'set_room_label', base_revision: state.revision,
      diff: { before: state.room_label, after: args.room_label },
      expires_at: this.clock() + this.limits.candidateMs, approval_required: true };
    candidate.digest = hash(JSON.stringify({ schema: VERSION_TAG, owner, ...candidate }));
    this.db.prepare('INSERT INTO candidates VALUES (?,?,?,?,?,?,?)').run(candidate.candidate_id, owner, args.session_id, args.request_id, payload, JSON.stringify(candidate), candidate.expires_at);
    return candidate;
  }
  approve(owner, args) {
    const candidate = this.candidate(owner, args.session_id, args.candidate_id);
    requireThat(candidate.digest === args.digest && candidate.base_revision === args.expected_revision, 'CANDIDATE_MISMATCH', 409);
    requireThat(this.state(owner, args.session_id).revision === candidate.base_revision, 'STALE_REVISION', 409);
    this.revoke(owner, args.session_id, args.candidate_id);
    const grant = { approval_ref: id(), owner, session: args.session_id,
      candidate: candidate.candidate_id, digest: candidate.digest,
      revision: candidate.base_revision, operation: candidate.operation,
      expires: Math.min(candidate.expires_at, this.clock() + this.limits.grantMs) };
    this.grants.set(grant.approval_ref, grant);
    return { approval_ref: grant.approval_ref, expires_at: grant.expires };
  }
  approval(owner, session, candidate) {
    this.candidate(owner, session, candidate);
    for (const grant of this.grants.values()) if (grant.owner === owner && grant.session === session && grant.candidate === candidate && grant.expires > this.clock()) return { approval_ref: grant.approval_ref, expires_at: grant.expires };
    return null;
  }
  revoke(owner, session, candidate) {
    this.candidate(owner, session, candidate);
    for (const [key, grant] of this.grants) if (grant.owner === owner && grant.session === session && grant.candidate === candidate) this.grants.delete(key);
    return { status: 'REVOKED' };
  }
  commit(owner, args) {
    this.state(owner, args.session_id);
    const payload = hash(JSON.stringify(args));
    const old = this.db.prepare('SELECT * FROM receipts WHERE owner=? AND session=? AND request=?').get(owner, args.session_id, args.request_id);
    if (old) { requireThat(old.payload === payload, 'IDEMPOTENCY_CONFLICT', 409); return JSON.parse(old.value); }
    const candidate = this.candidate(owner, args.session_id, args.candidate_id);
    requireThat(candidate.digest === args.digest && candidate.base_revision === args.expected_revision, 'CANDIDATE_MISMATCH', 409);
    const grant = this.grants.get(args.approval_ref);
    requireThat(grant && grant.owner === owner && grant.session === args.session_id && grant.candidate === candidate.candidate_id
      && grant.digest === args.digest && grant.revision === args.expected_revision && grant.operation === 'set_room_label'
      && grant.expires > this.clock(), 'NEEDS_APPROVAL', 403);
    this.db.exec('BEGIN IMMEDIATE');
    let receipt;
    try {
      const state = this.state(owner, args.session_id);
      requireThat(state.revision === args.expected_revision, 'STALE_REVISION', 409);
      receipt = { status: 'COMMITTED', receipt_id: id(), session_id: args.session_id,
        candidate_id: candidate.candidate_id, digest: candidate.digest,
        before: state.room_label, room_label: candidate.diff.after,
        revision: state.revision + 1 };
      this.db.prepare('UPDATE sessions SET label=?, revision=? WHERE owner=? AND revision=?').run(receipt.room_label, receipt.revision, owner, state.revision);
      this.db.prepare('INSERT INTO receipts VALUES (?,?,?,?,?)').run(owner, args.session_id, args.request_id, payload, JSON.stringify(receipt));
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    this.grants.delete(args.approval_ref);
    return receipt;
  }
  importBytes(owner, session, bytes) {
    this.state(owner, session); this.cleanup();
    const metadata = validateFixture(bytes, this.limits.uploadBytes);
    requireThat(this.db.prepare('SELECT COUNT(*) AS n FROM imports WHERE owner=? AND session=?').get(owner, session).n < this.limits.imports, 'IMPORT_LIMIT', 429);
    const value = { import_handle: id(), session_id: session, ...metadata, expires_at: this.clock() + this.limits.importMs };
    this.db.prepare('INSERT INTO imports VALUES (?,?,?,?,?,?)').run(value.import_handle, owner, session, JSON.stringify(value), bytes, value.expires_at);
    return value;
  }
  inspectImport(owner, session, handle) {
    this.state(owner, session);
    const row = this.db.prepare('SELECT value FROM imports WHERE id=? AND owner=? AND session=? AND expires>?').get(handle, owner, session, this.clock());
    requireThat(row, 'NOT_FOUND', 404); return JSON.parse(row.value);
  }
  deleteImport(owner, session, handle) {
    this.inspectImport(owner, session, handle);
    this.db.prepare('DELETE FROM imports WHERE id=? AND owner=? AND session=?').run(handle, owner, session);
    return { status: 'DELETED' };
  }
  close() { this.grants.clear(); this.db.close(); }
}
const VERSION_TAG = 'g1c-candidate-v1';
