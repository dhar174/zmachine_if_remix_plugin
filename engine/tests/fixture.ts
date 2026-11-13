const hash = "a".repeat(64);
export const identity = {
  owner_id: "owner:synthetic", session_id: "session:fixture", branch_id: "branch:main",
  generation_id: "generation:one", request_id: "request:001",
};
export const base = { ...identity, version: "1.0.0", expected_revision: 2, expected_policy_revision: 1 };
export const line = { kind: "line", text: "look" };
export const entity = "remix:chamber";
export const envelope = { ...base, input: line };
export const proposal = {
  ...base, intent: "PLAY", route: "native", normalized_intent: "look", entity_ids: [entity],
  operations: [{ kind: "native.line", text: "look" }], known_effects: [], effect_coverage: "known",
  rule_ids: [], guard_ids: [], unresolved: [], time: "native", generation_requests: [],
};
export const candidate = {
  ...base, candidate_id: "candidate:one", proposal_digest: hash,
  approval_scope: ["scope:fixture"], expires_at: "2030-01-01T00:00:00Z",
};
const world = { owner_id: identity.owner_id, session_id: identity.session_id, branch_id: identity.branch_id, generation_id: identity.generation_id };
const build = { story_sha256: hash, runtime_build: hash, adapter_build: hash, checkpoint_format: "format:synthetic" };
export const manifest = { version: "1.0.0", ...build, capabilities: [{
  id: "capability:look", operation: "native.line", boundary: { kind: "line" }, preconditions: [], effects: [],
  coverage: "supported", evidence: ["synthetic"], recovery: "checkpoint",
}] };
export const checkpoint = {
  ...world, version: "1.0.0", ...build, revision: 3, policy_revision: 1,
  checkpoint_id: "checkpoint:three", native_state: { pending_input: { kind: "character" }, payload_ref: "blob:native", payload_sha256: hash },
  remix_state_ref: "blob:remix", policy_ref: "blob:policy", history_ref: "blob:history",
  clocks: { native: 1, overlay: 0, policy: "native_running" },
};
export const receipt = {
  ...identity, version: "1.0.0", status: "COMMITTED", revision: 3,
  pre_checkpoint: "checkpoint:two", post_checkpoint: "checkpoint:three",
  native_output: ["The door stays shut."], event_ids: ["event:1"], narration_facts: [], visibility: "player",
  time_cost: 1, policy_revision: 1, in_fiction_result: "failure", warnings: [],
};
