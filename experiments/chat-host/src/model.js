import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';

export const VERSION = '0.1.0';
export const FIXTURE_SHA = '96c80b804d4400ed1cf4f9e383727c4d7a0f2925e1eac4e6bbe15bd455190c2b';
export const LIMITS = Object.freeze({ requestBytes: 16384, resultBytes: 16384,
  labelChars: 64, uploadBytes: 262144, candidates: 8, imports: 2,
  candidateMs: 300000, grantMs: 60000, importMs: 3600000,
  requestsPerMinute: 30, requestMs: 5000, uploadMs: 10000 });
export const hash = value => createHash('sha256').update(value).digest('hex');
export const id = () => randomBytes(24).toString('base64url');
export const principal = (issuer, subject) => hash(JSON.stringify([issuer, subject]));
export class ProbeError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export function requireThat(condition, code, status = 400) {
  if (!condition) throw new ProbeError(code, status);
}
const handle = z.string().regex(/^[A-Za-z0-9_-]{32}$/);
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const schemas = {
  probe_get_state: z.strictObject({}),
  probe_prepare_label: z.strictObject({ session_id: handle, request_id: handle,
    expected_revision: revision, room_label: z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9 '-]*$/) }),
  probe_get_candidate: z.strictObject({ session_id: handle, candidate_id: handle }),
  probe_commit_label: z.strictObject({ session_id: handle, request_id: handle,
    candidate_id: handle, digest, expected_revision: revision, approval_ref: handle }),
  probe_import_fixture: z.strictObject({ session_id: handle, file: z.strictObject({
    download_url: z.string().url().max(2048), file_id: z.string().min(1).max(256),
    mime_type: z.string().max(128).optional(), file_name: z.string().max(128).optional() }) }),
  probe_inspect_import: z.strictObject({ session_id: handle, import_handle: handle })
};
export const scopes = { probe_get_state: 'probe:read', probe_get_candidate: 'probe:read',
  probe_inspect_import: 'probe:read', probe_prepare_label: 'probe:stage',
  probe_commit_label: 'probe:commit', probe_import_fixture: 'probe:import' };
const candidateOutput = z.strictObject({candidate_id:handle,session_id:handle,
  operation:z.literal('set_room_label'),base_revision:revision,
  diff:z.strictObject({before:z.string().max(64),after:z.string().max(64)}),
  expires_at:z.number().int(),approval_required:z.literal(true),digest});
const importOutput = z.strictObject({import_handle:handle,session_id:handle,sha256:digest,
  size:z.literal(88576),story_version:z.literal(5),expires_at:z.number().int()});
export const outputs = {
  probe_get_state:z.strictObject({session_id:handle,room_label:z.string().max(64),revision,
    control_url:z.string().url(),untrusted_fixture_text:z.string().max(256)}),
  probe_prepare_label:candidateOutput.extend({approval_url:z.string().url()}),
  probe_get_candidate:candidateOutput.extend({approval:z.strictObject({approval_ref:handle,expires_at:z.number().int()}).nullable()}),
  probe_commit_label:z.strictObject({status:z.literal('COMMITTED'),receipt_id:handle,session_id:handle,
    candidate_id:handle,digest,before:z.string().max(64),room_label:z.string().max(64),revision}),
  probe_import_fixture:importOutput,probe_inspect_import:importOutput
};
export function checkOutput(value, max = LIMITS.resultBytes) {
  requireThat(Buffer.byteLength(JSON.stringify(value)) <= max, 'OUTPUT_LIMIT', 500);
  return value;
}
export function parse(schema, value) {
  const parsed = schema.safeParse(value);
  requireThat(parsed.success, 'BAD_SCHEMA');
  return parsed.data;
}
export function validateFixture(bytes, limit = LIMITS.uploadBytes) {
  requireThat(bytes.length <= limit, 'UPLOAD_TOO_LARGE', 413);
  // This import-only probe accepts exactly the reviewed fixture, including its
  // 32 zero padding bytes; it is not a general Z-machine format validator.
  requireThat(bytes.length === 88576 && bytes[0] === 5, 'INVALID_STORY');
  const staticBase = bytes.readUInt16BE(14), highBase = bytes.readUInt16BE(4);
  const declared = bytes.readUInt16BE(26) * 4;
  requireThat(staticBase >= 64 && staticBase <= highBase && highBase < bytes.length
    && declared > highBase && declared <= bytes.length && bytes.length - declared < 512
    && bytes.subarray(declared).every(x => x === 0), 'INVALID_STORY');
  const sha256 = hash(bytes);
  requireThat(sha256 === FIXTURE_SHA, 'DISALLOWED_FIXTURE');
  return { sha256, size: bytes.length, story_version: 5 };
}
