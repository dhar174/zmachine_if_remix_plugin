import { z } from "zod";
import { HeadExpectation } from "../contracts.ts";
import { restoreResult, saveId, saveResult } from "../fixture/recovery-contracts.ts";
import { compilerView, digest, fixtureContext, opaque, preparedAction, receiptView, requestAction, requestId,
  sessionRef, target } from "../fixture/session-contracts.ts";
import type { Failure, Result } from "../ports.ts";
import { failure, ok } from "../turn/contracts.ts";
import type { TurnService } from "../turn/service.ts";

export const scopes = { read: "probe:read", launch: "probe:import", stage: "probe:stage", commit: "probe:commit" } as const;
export type Principal = { owner: z.infer<typeof HeadExpectation.shape.owner_id>; scopes: ReadonlySet<string> };
const version = z.literal("1.0.0");
const ref = sessionRef.extend({ version });
const contextInput = ref.extend({ request_id: requestId.optional(), source_ref: opaque("source").optional() });
const controlInput = ref.extend({ request_id: requestId, mode: z.enum(["PLAY", "EDITOR"]) });
const historyQuery = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("facts") }),
  z.strictObject({ kind: z.literal("rules") }),
  z.strictObject({ kind: z.literal("history"), limit: z.int().min(1).max(10).optional() }),
  z.strictObject({ kind: z.literal("receipt"), generation_id: target.shape.generation_id, request_id: requestId }),
]);
const failureView = z.strictObject({
  version,
  status: z.enum(["VALIDATION_FAILED", "NEEDS_CLARIFICATION", "NEEDS_APPROVAL", "STALE_REVISION", "POLICY_CONFLICT",
    "CAPABILITY_MISSING", "ABORTED", "INSUFFICIENT_SCOPE"]),
  message: z.string(), retry: z.enum(["none", "same_request", "refresh"]),
  subtype: z.literal("IDEMPOTENCY_CONFLICT").optional(),
});
const view = z.strictObject({ status: z.literal("CONTEXT"), context: fixtureContext, compiler: compilerView.optional() });
const approvalLink = z.string().url();
const restoreControl = z.strictObject({ status: z.literal("NEEDS_BROWSER_CONTROL"), control_url: approvalLink });
const candidatePreview = z.strictObject({
  route: z.enum(["native", "remix", "bridged"]), time: z.enum(["none", "native", "overlay"]),
  operations: z.array(z.string()).max(32),
  assignments: z.array(z.strictObject({ entity_id: z.string(), field: z.string(), value: z.string() })).max(32),
  rule_ids: z.array(z.string()).max(512),
});
const prepared = z.strictObject({ status: z.literal("PREPARED"), candidate_id: opaque("candidate"), diff_digest: digest,
  proposal_digest: digest, expires_at: z.iso.datetime(), preview: candidatePreview, approval_url: approvalLink.optional() });
const inactive = z.strictObject({ status: z.literal("INACTIVE"), proposal_digest: digest, subset_url: approvalLink,
  clauses: z.array(z.strictObject({ id: z.string(), quote: z.string(), status: z.enum(["supported", "unresolved", "excluded"]),
    requires: z.array(z.string()) })).max(512) });
const committed = z.strictObject({ status: z.literal("COMMITTED"), receipt: receiptView });
const inspection = z.strictObject({ status: z.literal("INSPECTION"), context: fixtureContext,
  receipts: z.array(receiptView).max(10), receipt_on_active_lineage: z.boolean().optional() });

function route<T extends z.ZodObject, V extends z.ZodType>(
  input: T, output: V, scope: string, description: string, write: boolean, destructive: boolean,
  run: (principal: Principal, args: z.output<T>) => Result<z.input<V>> | Promise<Result<z.input<V>>>,
) {
  return { input, output: z.strictObject({ version, result: z.union([output, failureView.omit({ version: true })]) }),
    scope, description, write, destructive,
    run(principal: Principal, raw: unknown) {
      const args = input.safeParse(raw);
      return args.success ? run(principal, args.data) : failure("VALIDATION_FAILED", "Tool arguments failed schema validation.");
    },
  };
}

const unavailable = () => failure("NEEDS_APPROVAL", "Authenticated browser control is unavailable.");

const scoped = (principal: Principal, { session_id, branch_id }: z.infer<typeof sessionRef>) =>
  ({ owner_id: principal.owner, session_id, branch_id });
const committedView = (receipt: z.infer<typeof receiptView>) => ({ status: "COMMITTED" as const, receipt });
const rawPlan = z.object({
  route: candidatePreview.shape.route, time: candidatePreview.shape.time,
  operations: z.array(z.object({ operation: z.object({ kind: z.string() }).passthrough() })).max(32),
  amendment: z.object({ active_rules: z.array(z.object({ id: z.string() })).max(512) }).nullable(),
});

function previewOf(diff: string, editor: boolean) {
  const decoded: unknown = JSON.parse(diff);
  const plan = editor ? z.object({ preview: rawPlan }).parse(decoded).preview : rawPlan.parse(decoded);
  const assign = z.object({ entity_id: z.string(), field: z.string(), value: z.string() });
  return candidatePreview.parse({ route: plan.route, time: plan.time,
    operations: plan.operations.map(({ operation }) => operation.kind),
    assignments: plan.operations.flatMap(({ operation }) => operation.kind === "remix.assign" ? [assign.parse(operation)] : []),
    rule_ids: plan.amendment?.active_rules.map(({ id }) => id) ?? [],
  });
}

export function fixtureTools(service: TurnService, origin: string, browserAvailable: boolean) {
  const browserUrl = (path: string, query?: Record<string, string>) => {
    const url = new URL(path, origin);
    if (query) url.search = new URLSearchParams(query).toString();
    return url.toString();
  };
  return {
    open_story_session: route(z.strictObject({ version, launch_handle: opaque("launch") }), view, scopes.launch,
      "Open the configured bundled fixture with an owner-approved browser launch handle. Repeat the same handle to recover the same session.",
      true, false, async (who, args) => {
        const result = await service.openFixture(who.owner, args.launch_handle);
        return result.ok ? ok({ status: "CONTEXT" as const, context: result.value }) : result;
      }),
    get_turn_context: route(contextInput, view, scopes.read,
      "Read bounded fixture context. A browser-recorded source reference returns authorized text and compiler inputs.",
      false, false, (who, args) => {
        const access = scoped(who, args);
        if (!args.source_ref) {
          const result = service.readFixture(access, args.request_id);
          return result.ok ? ok({ status: "CONTEXT" as const, context: result.value }) : result;
        }
        const compiler = service.fixtureCompilerView(access, args.source_ref);
        if (!compiler.ok) return compiler;
        if (args.request_id && args.request_id !== compiler.value.request_id) {
          return failure("VALIDATION_FAILED", "Invalid or unavailable fixture target.");
        }
        const result = service.readFixture(access, compiler.value.request_id);
        return result.ok ? ok({ status: "CONTEXT" as const, context: result.value, compiler: compiler.value }) : result;
      }),
    set_input_mode: route(controlInput, z.strictObject({ status: z.literal("NEEDS_BROWSER_CONTROL"), control_url: approvalLink,
      current_mode: z.enum(["PLAY", "EDITOR"]), requested_mode: z.enum(["PLAY", "EDITOR"]) }), scopes.read,
    "Get a link to independent browser mode, source, and approval controls. This call cannot issue a mode or lease.",
    false, false, (who, args) => {
      const result = service.readFixture(scoped(who, args));
      if (!result.ok) return result;
      if (!browserAvailable) return unavailable();
      return ok({ status: "NEEDS_BROWSER_CONTROL" as const, current_mode: result.value.mode, requested_mode: args.mode,
        control_url: browserUrl("/fixture-control", { session_id: args.session_id, branch_id: args.branch_id, request_id: args.request_id }) });
    }),
    prepare_turn: route(z.strictObject({ version, target, action: preparedAction }),
      z.discriminatedUnion("status", [prepared, inactive, committed]),
      scopes.stage, "Stage a typed fixture turn or compile an inactive browser-recorded directive. Preparation never activates a draft.",
      true, false, (who, args) => {
        const result = service.prepareFixture(scoped(who, args.target), args.target, args.action, browserAvailable);
        if (!result.ok) return result;
        const value = result.value;
        if (value.kind === "committed") return ok(committedView(service.viewFixtureReceipt(value.record)));
        if (value.kind === "inactive" && args.action.kind === "directive") {
          return ok({ status: "INACTIVE" as const, proposal_digest: value.proposal.digest,
            subset_url: browserUrl("/fixture-subset", { id: args.action.source_ref }),
            clauses: value.proposal.clauses.map(({ id, quote, status, requires }) => ({ id, quote, status, requires })) });
        }
        if (value.kind !== "prepared") return failure("VALIDATION_FAILED", "Invalid fixture preparation.");
        const { candidate_id, proposal_digest, expires_at } = value.handle;
        return ok({ status: "PREPARED" as const, candidate_id, proposal_digest, expires_at, diff_digest: value.diff_digest,
          preview: previewOf(value.diff, args.action.kind === "directive"),
          ...(args.action.kind === "directive" ? { approval_url: browserUrl("/candidate", { id: candidate_id }) } : {}) });
      }),
    commit_turn: route(z.strictObject({ version, target, action: requestAction, candidate_id: opaque("candidate"), diff_digest: digest }),
      committed, scopes.commit, "Commit the exact staged fixture candidate. Retry with all original fields to recover a durable receipt.",
      true, true, async (who, args) => {
        const result = await service.commitFixture(scoped(who, args.target), args.target, args.action,
          args.candidate_id, args.diff_digest, browserAvailable);
        return result.ok ? ok(committedView(service.viewFixtureReceipt(result.value))) : result;
      }),
    inspect_session: route(ref.extend({ query: historyQuery }), inspection, scopes.read,
      "Read an authorized fixture head and bounded facts, rules or receipts. This never advances time.",
      false, false, (who, args) => {
        const result = service.inspectFixture(scoped(who, args), args.query);
        return result.ok ? ok({ status: "INSPECTION" as const, ...result.value }) : result;
      }),
    save_session: route(z.strictObject({ version, target }), saveResult, scopes.commit,
      "Save the active combined fixture head privately. Keep the returned save ID.", true, false,
      (who, args) => service.recovery.save(who.owner, args.target)),
    restore_session: route(z.strictObject({ version, target, save_id: saveId }),
      z.union([restoreControl, restoreResult]), scopes.commit,
      "Restore a combined save after independent browser approval. Retry the exact same arguments to recover the result.",
      true, true, async (who, args) => {
        const result = await service.recovery.restore(who.owner, args.target, args.save_id, browserAvailable);
        if (!result.ok) return result;
        if (result.value.status === "RESTORED") return ok(result.value);
        return ok({ status: "NEEDS_BROWSER_CONTROL" as const,
          control_url: browserUrl("/fixture-restore", { id: result.value.id }) });
      }),
  };
}

export function toolFailure({ status, message, retry, subtype }: Failure) {
  return failureView.omit({ version: true }).parse({ status, message, retry, ...(subtype ? { subtype } : {}) });
}

export function insufficientScope() {
  return failureView.omit({ version: true }).parse({ status: "INSUFFICIENT_SCOPE", message: "This operation requires additional access.", retry: "none" });
}
