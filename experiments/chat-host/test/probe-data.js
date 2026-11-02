// Shared synthetic data only: crash/recovery children must not load MCP or JOSE.
import { readFileSync } from 'node:fs';
import { id, principal } from '../src/model.js';

export const fixture = readFileSync(new URL('../../../tests/fixtures/zmachine/fixture.z5',import.meta.url));
export const issuer = 'https://issuer.invalid';
export const audience = 'https://probe.invalid/mcp';
export const owner = principal(issuer,'alice'), other = principal(issuer,'bob');
export const allScopes = 'probe:read probe:stage probe:commit probe:import';
export function proposal(state,label='Renamed Chamber') {
  return {session_id:state.session_id,request_id:id(),expected_revision:state.revision,room_label:label};
}
export function commitArgs(c,approval) {
  return {session_id:c.session_id,request_id:id(),candidate_id:c.candidate_id,digest:c.digest,
    expected_revision:c.base_revision,approval_ref:approval.approval_ref};
}
export const approvalArgs = c => ({session_id:c.session_id,candidate_id:c.candidate_id,digest:c.digest,expected_revision:c.base_revision});
