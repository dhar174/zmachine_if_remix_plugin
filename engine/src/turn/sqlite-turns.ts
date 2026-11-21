import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { canonicalDigest, canonicalJson } from "../contracts.ts";
import type { CanonicalValue } from "../contracts.ts";
import type { AuthorityRecords, AuthorityTables } from "../auth/authority.ts";
import { DurableReceipt, Stage, TurnImage } from "./contracts.ts";
import type { Access } from "./contracts.ts";
import { recoveryResult, restoreIntent, savedSession } from "../fixture/recovery-contracts.ts";
import type { RestoreIntent, RestoreResult, SavedSession } from "../fixture/recovery-contracts.ts";
import { publicHead, sessionRef } from "../fixture/session-contracts.ts";
import { importedSession, portableBytes, portableEntry, portableHistoryLimit } from "../fixture/portable-session.ts";
import type { PortableEntry, UploadPurpose } from "../fixture/portable-session.ts";

export const branchKey = (scope: Access) => canonicalJson([scope.owner_id, scope.session_id, scope.branch_id]);
const dispositions = ["active", "cancelled", "expired"] as const;
const requestRow = z.object({
  envelope: z.string(), proposal: z.string().nullable(), stage: z.string().nullable(),
  claim: z.string().nullable(), committed_candidate: z.string().nullable(), committed_digest: z.string().nullable(), receipt: z.string().nullable(), cancelled: z.union([z.literal(0), z.literal(1), z.literal(2)]),
});
const parseJson = (text: string): unknown => JSON.parse(text) as unknown;
const lineage = "WITH RECURSIVE ancestry(id) AS (SELECT ? UNION SELECT l.parent FROM checkpoint_links l " +
  "JOIN ancestry a ON a.id=l.id WHERE l.parent IS NOT NULL) ";
const recoveryRow = z.object({
  digest: z.string(), intent: z.string().nullable(), approved: z.union([z.literal(0), z.literal(1)]),
  claim: z.string().nullable(), result: z.string().nullable(),
});

export class SQLiteTurns {
  private readonly db: DatabaseSync;
  private readonly token = randomUUID();

  constructor(path: string) {
    this.db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    try {
      this.db.exec("PRAGMA busy_timeout=1000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON");
      const settings = [
        ["journal_mode", "delete"], ["synchronous", 2], ["foreign_keys", 1], ["busy_timeout", 1000], ["secure_delete", 1],
      ] as const;
      for (const [name, expected] of settings) {
        if (this.db.prepare("PRAGMA " + name).get()?.[name === "busy_timeout" ? "timeout" : name] !== expected) throw new Error("Unsupported SQLite setting: " + name);
      }
      this.atomic(() => {
        const version = this.db.prepare("PRAGMA user_version").get()?.user_version;
        if (version !== 0 && version !== 1 && version !== 2 && version !== 3) throw new Error("Unsupported turn database version.");
        this.db.exec("CREATE TABLE IF NOT EXISTS coordinator (id INTEGER PRIMARY KEY CHECK(id=1), token TEXT NOT NULL) STRICT");
        this.db.exec("CREATE TABLE IF NOT EXISTS authority (area TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(area,key)) STRICT");
        this.db.exec("CREATE TABLE IF NOT EXISTS checkpoints (id TEXT PRIMARY KEY, digest TEXT NOT NULL, body TEXT NOT NULL, published INTEGER NOT NULL, claim TEXT) STRICT");
        this.db.exec("CREATE TABLE IF NOT EXISTS heads (branch TEXT PRIMARY KEY, checkpoint TEXT NOT NULL REFERENCES checkpoints(id)) STRICT");
        this.db.exec("CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, envelope TEXT NOT NULL, proposal TEXT, stage TEXT, claim TEXT, receipt TEXT, cancelled INTEGER NOT NULL DEFAULT 0, checkpoint TEXT REFERENCES checkpoints(id)) STRICT");
        this.db.exec("CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, request TEXT NOT NULL REFERENCES requests(id), body TEXT NOT NULL) STRICT");
        if (version === 0 || version === 1) {
          this.db.exec("ALTER TABLE requests ADD COLUMN committed_candidate TEXT");
          this.db.exec("ALTER TABLE requests ADD COLUMN committed_digest TEXT");
        }
        this.db.exec("CREATE TABLE IF NOT EXISTS fixture_records (area TEXT NOT NULL, key TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(area,key)) STRICT");
        this.db.exec("CREATE TABLE IF NOT EXISTS fixture_drafts (branch TEXT PRIMARY KEY, checkpoint TEXT NOT NULL UNIQUE, digest TEXT NOT NULL, body TEXT NOT NULL) STRICT");
        if (version !== 3) {
          this.db.exec(`
            CREATE TABLE checkpoint_links (
              id TEXT PRIMARY KEY REFERENCES checkpoints(id), parent TEXT REFERENCES checkpoints(id),
              generation TEXT NOT NULL, branch TEXT NOT NULL, revision INTEGER NOT NULL, origin TEXT,
              CHECK(parent IS NULL OR parent<>id)
            ) STRICT;
            CREATE INDEX checkpoint_restore_origin ON checkpoint_links(branch,generation) WHERE origin IS NOT NULL;
            CREATE INDEX turn_request_checkpoint ON requests(checkpoint);
            INSERT INTO checkpoint_links(id,parent,generation,branch,revision)
              SELECT c.id,p.id,json_extract(c.body,'$.checkpoint.generation_id'),
                json_array(json_extract(c.body,'$.checkpoint.owner_id'),json_extract(c.body,'$.checkpoint.session_id'),
                  json_extract(c.body,'$.checkpoint.branch_id')),json_extract(c.body,'$.checkpoint.revision')
              FROM checkpoints c LEFT JOIN requests r ON r.checkpoint=c.id
              LEFT JOIN checkpoints p ON p.id=json_extract(r.receipt,'$.receipt.pre_checkpoint') AND p.published=1
              WHERE c.published=1;
            CREATE TABLE saved_sessions (
              id TEXT PRIMARY KEY, branch TEXT NOT NULL, checkpoint TEXT NOT NULL REFERENCES checkpoints(id), body TEXT NOT NULL
            ) STRICT;
            CREATE TABLE recovery_requests (
              id TEXT PRIMARY KEY, digest TEXT NOT NULL, approval_id TEXT UNIQUE, intent TEXT,
              approved INTEGER NOT NULL DEFAULT 0, claim TEXT, result TEXT
            ) STRICT;
            PRAGMA user_version=3;
          `);
        }
        this.db.exec(
          "CREATE TABLE IF NOT EXISTS private_uploads (id TEXT PRIMARY KEY, owner TEXT NOT NULL, purpose TEXT NOT NULL, bytes BLOB NOT NULL, expires INTEGER NOT NULL) STRICT;" +
          "CREATE TABLE IF NOT EXISTS private_stories (branch TEXT PRIMARY KEY, bytes BLOB NOT NULL) STRICT;" +
          "CREATE TABLE IF NOT EXISTS private_imports (id TEXT PRIMARY KEY, branch TEXT NOT NULL, digest TEXT NOT NULL, result TEXT NOT NULL) STRICT;" +
          "CREATE TABLE IF NOT EXISTS private_downloads (id TEXT PRIMARY KEY, branch TEXT NOT NULL, save TEXT NOT NULL, expires INTEGER NOT NULL) STRICT;",
        );
        this.db.prepare("INSERT INTO coordinator VALUES(1,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token").run(this.token);
        this.db.exec("UPDATE recovery_requests SET approval_id=NULL,intent=NULL,approved=0,claim=NULL WHERE result IS NULL");
        this.db.exec("UPDATE requests SET claim=NULL WHERE receipt IS NULL");
        // Keep branch freshness and one-turn tombstones. Restart never resurrects Editor mode or permits.
        this.db.exec("UPDATE authority SET value=json_set(value,'$.mode','PLAY','$.epoch',json_extract(value,'$.epoch')+1) WHERE area='states'");
        this.db.exec("DELETE FROM authority WHERE area IN ('leases','candidates','requestCandidates')");
        this.db.exec("UPDATE requests SET stage=NULL WHERE receipt IS NULL AND json_extract(stage,'$.editor')=1");
      }, true);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  close(): void { this.db.close(); }

  transaction<T>(run: () => T): T { return this.atomic(run, false); }

  private atomic<T>(run: () => T, startup: boolean): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (!startup && this.db.prepare("SELECT token FROM coordinator WHERE id=1").get()?.token !== this.token) {
        throw new Error("This turn coordinator has been replaced.");
      }
      const result = run();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw error;
    }
  }

  readonly authority: AuthorityTables = <K extends keyof AuthorityRecords>(area: K) => {
    const table = {
      has: (key: string) => this.db.prepare("SELECT 1 FROM authority WHERE area=? AND key=?").get(area, key) !== undefined,
      get: (key: string) => {
        const row = this.db.prepare("SELECT value FROM authority WHERE area=? AND key=?").get(area, key);
        return typeof row?.value === "string" ? parseJson(row.value) as AuthorityRecords[K] : undefined;
      },
      set: (key: string, value: AuthorityRecords[K]) => {
        if (!this.db.isTransaction) throw new Error("Authority writes require a transaction.");
        this.db.prepare("INSERT INTO authority VALUES(?,?,?) ON CONFLICT(area,key) DO UPDATE SET value=excluded.value")
          .run(area, key, JSON.stringify(value));

      },
    };
    return table;
  };

  head(scope: Access): TurnImage | undefined {
    const row = this.db.prepare("SELECT c.body,c.digest FROM heads h JOIN checkpoints c ON h.checkpoint=c.id WHERE h.branch=? AND c.published=1")
      .get(branchKey(scope));
    if (!row) return undefined;
    const image = TurnImage.parse(parseJson(z.string().parse(row.body)));
    if (canonicalDigest(image) !== row.digest) throw new Error("Checkpoint digest mismatch.");
    return image;
  }

  draft(scope: Access): TurnImage | undefined {
    const row = this.db.prepare("SELECT body,digest FROM fixture_drafts WHERE branch=?").get(branchKey(scope));
    if (!row) return undefined;
    const image = TurnImage.parse(parseJson(z.string().parse(row.body)));
    if (canonicalDigest(image) !== row.digest) throw new Error("Draft digest mismatch.");
    return image;
  }

  initializeDraft(image: TurnImage): void {
    this.db.prepare("INSERT INTO fixture_drafts VALUES(?,?,?,?)")
      .run(branchKey(image.snapshot.head), image.checkpoint.checkpoint_id, canonicalDigest(image), canonicalJson(image));
  }

  fixtureRecord(area: "launch" | "session" | "source" | "compilation", key: string): unknown {
    const row = this.db.prepare("SELECT body FROM fixture_records WHERE area=? AND key=?").get(area, key);
    return typeof row?.body === "string" ? parseJson(row.body) : undefined;
  }

  saveFixtureRecord(area: "launch" | "session" | "source" | "compilation", key: string, body: CanonicalValue): void {
    this.db.prepare("INSERT INTO fixture_records VALUES(?,?,?) ON CONFLICT(area,key) DO UPDATE SET body=excluded.body")
      .run(area, key, canonicalJson(body));
  }

  fixtureReceipts(checkpoint: string, limit: number): DurableReceipt[] {
    return this.db.prepare(lineage +
      "SELECT r.receipt FROM ancestry a JOIN requests r ON r.checkpoint=a.id WHERE r.receipt IS NOT NULL " +
      "ORDER BY json_extract(r.receipt,'$.receipt.revision') DESC LIMIT ?",
    ).all(checkpoint, limit).map(({ receipt }) => DurableReceipt.parse(parseJson(z.string().parse(receipt))));
  }

  isAncestor(checkpoint: string, historical: string): boolean {
    return this.db.prepare(lineage + "SELECT 1 FROM ancestry WHERE id=?").get(checkpoint, historical) !== undefined;
  }

  restoreOrigin(head: TurnImage["snapshot"]["head"]) {
    const row = this.db.prepare("SELECT origin FROM checkpoint_links WHERE branch=? AND generation=? AND origin IS NOT NULL")
      .get(branchKey(head), head.generation_id);
    return typeof row?.origin === "string" ? publicHead.parse(parseJson(row.origin)) : undefined;
  }

  checkpointHistoryValid(image: TurnImage): boolean {
    const { checkpoint, snapshot } = image;
    const brokenLink = this.db.prepare(lineage + `
      SELECT 1 FROM ancestry a
      LEFT JOIN checkpoint_links l ON l.id=a.id
      LEFT JOIN checkpoints c ON c.id=a.id AND c.published=1
      LEFT JOIN checkpoint_links p ON p.id=l.parent
      LEFT JOIN requests r ON r.checkpoint=a.id
      WHERE l.id IS NULL OR c.id IS NULL OR l.branch IS NOT ?
        OR (l.parent IS NOT NULL AND (p.id IS NULL OR p.revision >= l.revision))
        OR (r.id IS NULL AND l.parent IS NOT NULL AND l.origin IS NULL)
        OR (r.id IS NOT NULL AND (r.receipt IS NULL OR
          json_extract(r.receipt,'$.receipt.post_checkpoint') IS NOT a.id OR
          (l.parent IS NOT NULL AND json_extract(r.receipt,'$.receipt.pre_checkpoint') IS NOT l.parent) OR
          (l.parent IS NULL AND l.revision<>1) OR EXISTS(
            SELECT 1 FROM json_each(r.receipt,'$.receipt.event_ids') e
            WHERE NOT EXISTS(SELECT 1 FROM events WHERE id=e.value AND request=r.id)
          )))
      LIMIT 1
    `).get(checkpoint.checkpoint_id, branchKey(snapshot.head));
    if (brokenLink) return false;
    const receipts = this.db.prepare(lineage +
      "SELECT r.receipt FROM ancestry a JOIN requests r ON r.checkpoint=a.id");
    for (const { receipt } of receipts.iterate(checkpoint.checkpoint_id)) {
      if (typeof receipt !== "string" || !DurableReceipt.safeParse(parseJson(receipt)).success) return false;
    }
    return true;
  }

  savedSession(scope: Access, id: string): SavedSession | undefined {
    const row = this.db.prepare("SELECT body,checkpoint FROM saved_sessions WHERE id=? AND branch=?").get(id, branchKey(scope));
    if (!row || typeof row.body !== "string") return undefined;
    const saved = savedSession.safeParse(parseJson(row.body));
    return saved.success && saved.data.save_id === id && saved.data.checkpoint === row.checkpoint &&
      branchKey(saved.data.head) === branchKey(scope) ? saved.data : undefined;
  }

  savedImage(saved: SavedSession): TurnImage | undefined {
    const row = this.db.prepare("SELECT body,digest FROM checkpoints WHERE id=? AND published=1").get(saved.checkpoint);
    if (!row || typeof row.body !== "string" || row.digest !== saved.digest) return undefined;
    const parsed = TurnImage.safeParse(parseJson(row.body));
    if (!parsed.success) return undefined;
    const image = parsed.data;
    return canonicalDigest(image) === saved.digest && image.checkpoint.checkpoint_id === saved.checkpoint &&
      canonicalDigest(image.snapshot.head) === canonicalDigest(saved.head) ? image : undefined;
  }

  insertSave(saved: SavedSession): void {
    this.db.prepare("INSERT INTO saved_sessions VALUES(?,?,?,?)")
      .run(saved.save_id, branchKey(saved.head), saved.checkpoint, canonicalJson(saved));
  }

  recoveryRequest(id: string) {
    const row = this.db.prepare("SELECT digest,intent,approved,claim,result FROM recovery_requests WHERE id=?").get(id);
    if (!row) return undefined;
    const data = recoveryRow.parse(row);
    return { ...data, intent: data.intent === null ? null : restoreIntent.parse(parseJson(data.intent)),
      result: data.result === null ? null : recoveryResult.parse(parseJson(data.result)) };
  }

  restoreKey(id: string): string | undefined {
    const row = this.db.prepare("SELECT id FROM recovery_requests WHERE approval_id=? AND result IS NULL").get(id);
    return typeof row?.id === "string" ? row.id : undefined;
  }

  bindRecovery(id: string, digest: string, intent?: RestoreIntent): void {
    this.db.prepare("INSERT INTO recovery_requests(id,digest,approval_id,intent) VALUES(?,?,?,?) " +
      "ON CONFLICT(id) DO UPDATE SET approval_id=excluded.approval_id,intent=excluded.intent,approved=0")
      .run(id, digest, intent?.id ?? null, intent ? canonicalJson(intent) : null);
  }

  approveRestore(id: string): void {
    this.db.prepare("UPDATE recovery_requests SET approved=1 WHERE id=? AND result IS NULL").run(id);
  }

  claimRestore(id: string, claim: string | null): void {
    this.db.prepare("UPDATE recovery_requests SET claim=? WHERE id=? AND result IS NULL").run(claim, id);
  }

  completeRecovery(id: string, claim: string | null, result: z.infer<typeof recoveryResult>): void {
    const saved = this.db.prepare("UPDATE recovery_requests SET result=?,approval_id=NULL,intent=NULL,approved=0,claim=NULL " +
      "WHERE id=? AND claim IS ? AND result IS NULL").run(canonicalJson(result), id, claim);
    if (saved.changes !== 1) throw new Error("Recovery request claim changed.");
  }

  stageStory(owner: Access["owner_id"], id: string, purpose: UploadPurpose, story: Buffer, now: number): boolean {
    this.db.prepare("DELETE FROM private_uploads WHERE owner=? AND expires<=?").run(owner, now);
    const staged = this.db.prepare("INSERT INTO private_uploads SELECT ?,?,?,?,? WHERE " +
      "(SELECT COUNT(*) FROM private_uploads WHERE owner=?) < 8").run(id, owner, purpose, story, now + 3_600_000, owner);
    return staged.changes === 1;
  }

  pendingStory(owner: Access["owner_id"], id: string, purpose: UploadPurpose, now: number): Buffer | undefined {
    const row = this.db.prepare("SELECT bytes FROM private_uploads WHERE owner=? AND id=? AND purpose=? AND expires>?")
      .get(owner, id, purpose, now);
    return row?.bytes instanceof Uint8Array ? Buffer.from(row.bytes) : undefined;
  }

  removeUpload(owner: Access["owner_id"], id: string): boolean {
    return this.db.prepare("DELETE FROM private_uploads WHERE owner=? AND id=?").run(owner, id).changes === 1;
  }

  retainStory(scope: Access, story: Buffer): void {
    this.db.prepare("INSERT INTO private_stories VALUES(?,?)").run(branchKey(scope), story);
  }

  storyFor(scope: Access): Buffer | undefined {
    const row = this.db.prepare("SELECT bytes FROM private_stories WHERE branch=?").get(branchKey(scope));
    return row?.bytes instanceof Uint8Array ? Buffer.from(row.bytes) : undefined;
  }

  portableHistory(image: TurnImage): PortableEntry[] | undefined {
    if (!this.checkpointHistoryValid(image)) return;
    const rows = this.db.prepare(lineage + "SELECT c.body,c.digest,l.parent,l.origin,r.id AS request,r.receipt " +
      "FROM ancestry a JOIN checkpoints c ON c.id=a.id JOIN checkpoint_links l ON l.id=a.id " +
      "LEFT JOIN requests r ON r.checkpoint=a.id ORDER BY l.revision LIMIT ?")
      .iterate(image.checkpoint.checkpoint_id, portableHistoryLimit + 1);
    const event = this.db.prepare("SELECT body FROM events WHERE request=? AND id=?");
    const history: PortableEntry[] = [];
    let bytes = 0;
    for (const row of rows) {
      const body = z.string().parse(row.body);
      bytes += Buffer.byteLength(body);
      if (history.length >= portableHistoryLimit || bytes > portableBytes) return;
      const snapshot = TurnImage.parse(parseJson(body));
      if (canonicalDigest(snapshot) !== row.digest) throw new Error("Invalid ancestral checkpoint.");
      const receipt = row.receipt === null ? null : DurableReceipt.parse(parseJson(z.string().parse(row.receipt)));
      const entry = portableEntry.parse({ image: snapshot, parent: row.parent, receipt,
        origin: row.origin === null ? null : parseJson(z.string().parse(row.origin)),
        events: receipt?.receipt.event_ids.map((id) => parseJson(z.string().parse(event.get(row.request ?? null, id)?.body))) ?? [],
      });
      bytes += Buffer.byteLength(canonicalJson({ ...entry, image: null }));
      if (bytes > portableBytes) return;
      history.push(entry);
    }
    return history;
  }

  importSession(id: string, digest: string, story: Buffer, data: {
    entries: PortableEntry[]; imported: TurnImage; parent: string; origin: RestoreResult["restored_from"];
  }): z.infer<typeof importedSession> {
    for (const { image, parent, origin, receipt, events } of data.entries) {
      this.insertCheckpoint(image, null);
      this.db.prepare("UPDATE checkpoints SET published=1 WHERE id=?").run(image.checkpoint.checkpoint_id);
      this.appendLineage(image, parent, origin);
      if (!receipt) continue;
      const { owner_id, session_id, branch_id, generation_id, request_id, event_ids } = receipt.receipt;
      const key = canonicalJson({ owner_id, session_id, branch_id, generation_id, request_id });
      this.db.prepare("INSERT INTO requests(id,envelope,receipt,checkpoint) VALUES(?,?,?,?)")
        .run(key, "", canonicalJson(receipt), image.checkpoint.checkpoint_id);
      for (const [index, eventId] of event_ids.entries()) {
        this.db.prepare("INSERT INTO events VALUES(?,?,?)").run(eventId, key, canonicalJson(events[index] ?? null));
      }
    }
    const { imported, parent, origin } = data;
    const scope = imported.snapshot.head;
    this.insertCheckpoint(imported, null);
    this.db.prepare("UPDATE checkpoints SET published=1 WHERE id=?").run(imported.checkpoint.checkpoint_id);
    this.appendLineage(imported, parent, origin);
    this.db.prepare("INSERT INTO heads VALUES(?,?)").run(branchKey(scope), imported.checkpoint.checkpoint_id);
    this.saveFixtureRecord("session", branchKey(scope), true);
    this.retainStory(scope, story);
    const result = importedSession.parse({ status: "IMPORTED", head: publicHead.strip().parse(scope) });
    this.db.prepare("INSERT INTO private_imports VALUES(?,?,?,?)").run(id, branchKey(scope), digest, canonicalJson(result));
    return result;
  }

  priorImport(id: string) {
    const row = this.db.prepare("SELECT digest,result FROM private_imports WHERE id=?").get(id);
    if (typeof row?.digest !== "string" || typeof row.result !== "string") return;
    return { digest: row.digest, result: importedSession.parse(parseJson(row.result)) };
  }

  issueDownload(id: string, scope: Access, save: string, expires: number): void {
    this.db.prepare("INSERT INTO private_downloads VALUES(?,?,?,?)").run(id, branchKey(scope), save, expires);
  }

  consumeDownload(id: string, scope: Access, save: string, now: number): boolean {
    return this.db.prepare("DELETE FROM private_downloads WHERE id=? AND branch=? AND save=? AND expires>?")
      .run(id, branchKey(scope), save, now).changes === 1;
  }

  privateSessions(owner: Access["owner_id"]): z.infer<typeof sessionRef>[] {
    return this.db.prepare("SELECT json_extract(branch,'$[1]') AS session_id, json_extract(branch,'$[2]') AS branch_id " +
      "FROM private_stories WHERE json_extract(branch,'$[0]')=? ORDER BY branch")
      .all(owner).map((row) => sessionRef.parse(row));
  }

  privateSaveIds(scope: Access): string[] {
    return this.db.prepare("SELECT id FROM saved_sessions WHERE branch=? ORDER BY id").all(branchKey(scope))
      .map((row) => z.string().parse(row.id));
  }

  deletePrivateSession(scope: Access): boolean {
    const branch = branchKey(scope);
    if (this.db.prepare("DELETE FROM private_stories WHERE branch=?").run(branch).changes !== 1) return false;
    const { owner_id, session_id, branch_id } = scope;
    this.db.prepare("DELETE FROM private_downloads WHERE branch=?").run(branch);
    this.db.prepare("DELETE FROM private_imports WHERE branch=?").run(branch);
    this.db.prepare("DELETE FROM saved_sessions WHERE branch=?").run(branch);
    this.db.prepare("DELETE FROM heads WHERE branch=?").run(branch);
    this.db.prepare("DELETE FROM fixture_drafts WHERE branch=?").run(branch);
    this.db.prepare("DELETE FROM recovery_requests WHERE json_extract(id,'$[1]')=? AND json_extract(id,'$[2]')=? AND json_extract(id,'$[3]')=?")
      .run(owner_id, session_id, branch_id);
    const requestScope = "json_extract(id,'$.owner_id')=? AND json_extract(id,'$.session_id')=? AND json_extract(id,'$.branch_id')=?";
    this.db.prepare("DELETE FROM events WHERE request IN (SELECT id FROM requests WHERE json_valid(id) AND " + requestScope + ")")
      .run(owner_id, session_id, branch_id);
    this.db.prepare("DELETE FROM requests WHERE json_valid(id) AND " + requestScope).run(owner_id, session_id, branch_id);
    this.db.prepare("DELETE FROM checkpoint_links WHERE branch=?").run(branch);
    this.db.prepare("DELETE FROM checkpoints WHERE json_extract(body,'$.checkpoint.owner_id')=? " +
      "AND json_extract(body,'$.checkpoint.session_id')=? AND json_extract(body,'$.checkpoint.branch_id')=?")
      .run(owner_id, session_id, branch_id);
    this.db.prepare("DELETE FROM fixture_records WHERE area='compilation' AND key IN " +
      "(SELECT key FROM fixture_records WHERE area='source' AND json_extract(body,'$.head.owner_id')=? " +
      "AND json_extract(body,'$.head.session_id')=? AND json_extract(body,'$.head.branch_id')=?)").run(owner_id, session_id, branch_id);
    this.db.prepare("DELETE FROM fixture_records WHERE (area='session' AND key=?) OR (area='source' AND " +
      "json_extract(body,'$.head.owner_id')=? AND json_extract(body,'$.head.session_id')=? AND json_extract(body,'$.head.branch_id')=?)")
      .run(branch, owner_id, session_id, branch_id);
    this.db.prepare("DELETE FROM authority WHERE (area IN ('states','generations') AND key=?) " +
      "OR (area IN ('overrides','requestCandidates') AND json_valid(key) AND json_extract(key,'$[0]')=?) " +
      "OR (area IN ('leases','candidates') AND json_extract(value,'$.head.owner_id')=? " +
      "AND json_extract(value,'$.head.session_id')=? AND json_extract(value,'$.head.branch_id')=?)")
      .run(branch, branch, owner_id, session_id, branch_id);
    return true;
  }

  hasCheckpoint(id: string): boolean {
    return this.db.prepare("SELECT 1 FROM checkpoints WHERE id=? UNION ALL SELECT 1 FROM fixture_drafts WHERE checkpoint=?").get(id, id) !== undefined;
  }

  initialize(image: TurnImage): void {
    this.insertCheckpoint(image, null);
    this.db.prepare("UPDATE checkpoints SET published=1 WHERE id=?").run(image.checkpoint.checkpoint_id);
    this.db.prepare("INSERT INTO heads VALUES(?,?)").run(branchKey(image.snapshot.head), image.checkpoint.checkpoint_id);
    this.appendLineage(image, null);
  }

  request(id: string) {
    const row = this.db.prepare("SELECT envelope,proposal,stage,claim,receipt,cancelled,committed_candidate,committed_digest FROM requests WHERE id=?").get(id);
    if (!row) return undefined;
    const data = requestRow.parse(row);
    const stage = data.stage === null ? null : Stage.parse(parseJson(data.stage));
    const receipt = data.receipt === null ? null : DurableReceipt.parse(parseJson(data.receipt));
    return { ...data, stage, receipt, disposition: dispositions[data.cancelled] };
  }

  bind(id: string, envelope: string, stage: Stage): void {
    this.db.prepare("INSERT INTO requests(id,envelope,proposal,stage) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET stage=excluded.stage")
      .run(id, envelope, stage.handle.proposal_digest, canonicalJson(stage));
  }

  claim(id: string, claim: string | null): void {
    this.db.prepare("UPDATE requests SET claim=? WHERE id=? AND receipt IS NULL").run(claim, id);
  }

  cancel(id: string, reason: "cancelled" | "expired" = "cancelled"): void {
    this.db.prepare("UPDATE requests SET cancelled=?,stage=NULL,claim=NULL WHERE id=? AND receipt IS NULL")
      .run(dispositions.indexOf(reason), id);
  }

  insertCheckpoint(image: TurnImage, claim: string | null): void {
    this.db.prepare("INSERT INTO checkpoints VALUES(?,?,?,0,?)")
      .run(image.checkpoint.checkpoint_id, canonicalDigest(image), canonicalJson(image), claim);
  }

  publish(id: string, claim: string, old: TurnImage, image: TurnImage, receipt: DurableReceipt,
    events: readonly CanonicalValue[], stage: Stage, draft: boolean): void {
    const value = this.markPublished(image, claim);
    const branch = branchKey(old.snapshot.head);
    let head;
    if (draft) {
      const removed = this.db.prepare("DELETE FROM fixture_drafts WHERE branch=? AND checkpoint=?")
        .run(branch, old.checkpoint.checkpoint_id);
      if (removed.changes !== 1) throw new Error("Draft base changed.");
      head = this.db.prepare("INSERT INTO heads VALUES(?,?)").run(branch, value);
    } else {
      head = this.db.prepare("UPDATE heads SET checkpoint=? WHERE branch=? AND checkpoint=?")
        .run(value, branch, old.checkpoint.checkpoint_id);
    }
    if (head.changes !== 1) throw new Error("Committed head changed.");
    this.appendLineage(image, draft ? null : old.checkpoint.checkpoint_id);
    for (const [index, event] of events.entries()) {
      const eventId = receipt.receipt.event_ids[index];
      if (!eventId) throw new Error("Missing event ID.");
      this.db.prepare("INSERT INTO events VALUES(?,?,?)").run(eventId, id, canonicalJson(event));
    }
    const saved = this.db.prepare("UPDATE requests SET receipt=?,checkpoint=?,committed_candidate=?,committed_digest=?,claim=NULL,stage=NULL WHERE id=? AND claim=? AND receipt IS NULL")
      .run(canonicalJson(receipt), value, stage.handle.candidate_id, stage.diff_digest, id, claim);
    if (saved.changes !== 1) throw new Error("Request claim changed.");
  }

  private markPublished(image: TurnImage, claim: string): string {
    const id = image.checkpoint.checkpoint_id;
    const result = this.db.prepare("UPDATE checkpoints SET published=1,claim=NULL WHERE id=? AND claim=? AND published=0 AND digest=?")
      .run(id, claim, canonicalDigest(image));
    if (result.changes !== 1) throw new Error("Staged checkpoint is missing.");
    return id;
  }

  private appendLineage(image: TurnImage, parent: string | null, origin: RestoreResult["restored_from"] | null = null): void {
    this.db.prepare("INSERT INTO checkpoint_links(id,parent,generation,branch,revision,origin) VALUES(?,?,?,?,?,?)")
      .run(image.checkpoint.checkpoint_id, parent, image.snapshot.head.generation_id, branchKey(image.snapshot.head),
        image.checkpoint.revision, origin ? canonicalJson(origin) : null);
  }

  publishRestore(id: string, claim: string, intent: RestoreIntent, image: TurnImage, result: RestoreResult): void {
    const value = this.markPublished(image, claim);
    const branch = branchKey(image.snapshot.head);
    const head = this.db.prepare("UPDATE heads SET checkpoint=? WHERE branch=? AND checkpoint=?")
      .run(value, branch, intent.base);
    if (head.changes !== 1) throw new Error("Committed head changed.");
    this.appendLineage(image, intent.save.checkpoint, result.restored_from);
    this.completeRecovery(id, claim, result);
  }

  collect(now: number): number {
    this.db.prepare("DELETE FROM private_uploads WHERE expires<=?").run(now);
    this.db.prepare("DELETE FROM private_downloads WHERE expires<=?").run(now);
    this.db.prepare("UPDATE recovery_requests SET approval_id=NULL,intent=NULL,approved=0 " +
      "WHERE result IS NULL AND claim IS NULL AND json_extract(intent,'$.expires')<=?").run(now);
    const discarded = this.db.prepare("DELETE FROM checkpoints WHERE published=0 AND (claim IS NULL OR claim NOT IN (" +
      "SELECT claim FROM requests WHERE claim IS NOT NULL UNION ALL SELECT claim FROM recovery_requests WHERE claim IS NOT NULL))")
      .run();
    this.db.prepare("UPDATE requests SET cancelled=CASE WHEN json_extract(stage,'$.editor')=1 THEN 2 ELSE cancelled END, stage=NULL WHERE claim IS NULL AND json_extract(stage,'$.handle.expires_at')<=?")
      .run(new Date(now).toISOString());
    this.db.prepare("DELETE FROM authority WHERE area IN ('leases','candidates') AND json_extract(value,'$.expires')<=?").run(now);
    this.db.exec("DELETE FROM authority WHERE area='requestCandidates' AND NOT EXISTS (SELECT 1 FROM authority AS candidate WHERE candidate.area='candidates' AND candidate.key=json_extract(authority.value,'$'))");
    return Number(discarded.changes);
  }
}

/** Synchronous atomic storage boundary for one active coordinator per database. */
export type TurnStore = Pick<SQLiteTurns, "transaction" | "close" | "authority" | "head" | "initialize" |
  "draft" | "initializeDraft" | "fixtureRecord" | "saveFixtureRecord" | "fixtureReceipts" | "hasCheckpoint" | "request" | "bind" | "claim" |
  "cancel" | "insertCheckpoint" | "publish" | "collect" | "isAncestor" | "restoreOrigin" | "checkpointHistoryValid" |
  "savedSession" | "savedImage" | "insertSave" | "recoveryRequest" | "restoreKey" | "bindRecovery" | "approveRestore" |
  "claimRestore" | "completeRecovery" | "publishRestore" | "stageStory" | "pendingStory" | "removeUpload" | "retainStory" | "storyFor" |
  "portableHistory" | "importSession" | "priorImport" | "issueDownload" | "consumeDownload" | "privateSessions" | "privateSaveIds" | "deletePrivateSession">;
