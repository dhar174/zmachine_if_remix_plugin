# Agent-team setup verification — 2026-10-22

Point-in-time evidence record for the Zcode specialist-team configuration performed on 2026-10-22. Written per the close-out rule in [team-coordination.md](team-coordination.md) §3. This record describes what was actually checked and observed; it claims no runtime behavior for the product and no more verification than occurred.

## Inspected revision and environment

- Working checkout: branch `glm/begin_implementation` at commit `92cddc5` (tree clean at session start except untracked `.mimosa/` hook-state tool files, preserved untouched). The change under review is **uncommitted** working-tree content on top of that commit.
- Branch state: `main` is at `eaab2ee` (merged PR #33) and is **not** an ancestor of this branch; the decision register, contract reconciliation, acceptance supplement (S01–S24), and three G1 probe briefs exist on `main` only. All references to them in the configuration are marked conditional.
- Remote sources checked read-only via the GitHub CLI: Issue #10 **closed** (D01–D37 conceptually approved, D38 not approved); Issue #2 **open** (G0–G6 epic); PR #33 **merged**. Live remote state is as of check time, not a standing claim.
- Platform documentation consulted (2026-10-22): Zcode subagents page (user-scope-only discovery at `~/.zcode/agents/`, required/supported frontmatter, no subagent nesting), Antigravity rules page (`.agents/rules/*.md` immediate children with required `trigger` frontmatter; root `AGENTS.md`/`GEMINI.md` always active). Installed-version behavior corroborated by nine pre-existing working agent definitions in `~/.zcode/agents/`.

## Deliverables written

- `.zcode/agents/zmachine-*.md` — 8 read-only specialist definitions (`zmachine-context-contracts`, `zmachine-policy-directives`, `zmachine-vm-bridge`, `zmachine-turn-persistence`, `zmachine-chat-host`, `zmachine-narrative-knowledge`, `zmachine-continuity-provenance`, `zmachine-acceptance-reviewer`).
- `docs/agents/team-coordination.md` — canonical coordination policy (roles, routing table, assignment/return contracts, shared invariants, platform behavior).
- `docs/agents/README.md` — roster, installation/update/removal, invocation examples, verification checklist.
- `docs/agents/setup-verification-2026-10-22.md` — this record.
- Root `AGENTS.md` (coordinator duties + directory entries), root `GEMINI.md` (Gemini CLI / Antigravity entry point), `.agents/rules/team-coordination.md` (Antigravity always-on rule), `docs/README.md` (engineering-documentation map entry).

## Verification states

| State | Result |
| --- | --- |
| Written | Yes — all files above exist as repository templates. |
| Installed | Yes — 8 definitions copied additively to `~/.zcode/agents/`. Pre-install listing showed only the 9 unrelated `tiny-village-*.md` files; post-install listing shows those unchanged plus the 8 additions. No existing file was overwritten (basis: before/after directory listings taken during the session; no pre-install hash snapshot was taken — see Limitations). The 2026-10-22 independent re-review confirmed installed copies match templates by full-text comparison (3 changed files) and the stand-in review by hashing (8/8 sha256 match before the final two wording edits; the two edited files were re-synced afterwards). |
| Discovered | Yes — for all 8 agents, observed **mid-session** in this desktop session immediately after installation. Official documentation states a fresh session is required; this observed deviation is recorded in `docs/agents/team-coordination.md` §9 and `docs/agents/README.md`. Discovery has not been re-verified in a fresh session or on any other client. |
| Invocation-verified | Partial — one of eight roles exercised with a real named-agent invocation (see below); two further roles were exercised via stand-in agents; the remaining five roles are discovered but unexercised. |

## Checks actually executed

1. **Static configuration checks (script, 266 assertions — ALL PASSED).** Covered: frontmatter validity for all 8 definitions (name equals file stem; description present and bounded; `model: inherit`; tools exactly `[Read, Grep, Glob]`; `injectAgentsMd: true`; `maxTurns` a positive integer; no unsupported keys), required body sections, roster == routing-table == entry-point consistency, referenced-path existence on this branch, and conditional marking of main-only references. The script was a session artifact in a temporary directory and was **not committed** (keeps the docs-only repository free of tooling); its check categories are described here and reproducible from them. First run surfaced 1 real defect (reviewer definition lacked an explicit "failure modes" section) and 3 checker bugs (case-sensitive phrase matching; a path normalizer that mangled `.agents/`/`.zcode/` prefixes; home paths treated as repo-relative) — all fixed before the passing runs.
2. **Two-specialist smoke investigation (assignment/return templates exercised).** Two general-purpose stand-in agents ran assignments `zirp-20261022-01` (permission-versus-capability limits across the policy, bridge, and turn contracts; A17/A20 identified as the boundary family) and `zirp-20261022-02` (planned acceptance cases versus test evidence; validation records correctly pinned to `ca8a115`, S01–S24 confirmed absent on this branch). Both returned complete six-part reports per the new return contract, labeled findings observed/inferred/proposed, and correctly treated main-only material as absent. Their reports were returned in-session and summarized here, not committed — specialist reports are transient working material per the coordination policy. Design-doc improvement suggestions they raised (e.g. a cross-reference from `world-policy.md` §5 to `state-and-vm-bridge.md` §5) are **recorded for the owner, not applied** — outside this task's authorization.
3. **Independent full review (stand-in for `zmachine-acceptance-reviewer`, task `zirp-20261022-03`).** Verified all frontmatter, roster/routing/entry-point consistency, installed-copy identity (8/8 hashes), section references into pre-existing docs, D01–D37/D38 claims against main's decision register, working-tree scope (only intended files changed), and evidence claims. Findings: F1 missing verification record; F2 unretained script output and smoke reports; F3 overstated claim that the script conditionally checked the three G1 probe briefs (they are prose-referenced without full paths, so no path-level check fired — the prose guards were verified correct instead); F4 unmarked S-ID use sites; F5 tracked `.mimosa/` tool-state hygiene (pre-existing at `92cddc5`, not part of this change; no privacy violation found); F6 "purely additive install" not provable post-hoc; F7 one platform claim sourced beyond the assignment packet (verified against the official docs during research).
4. **Fix delta re-review by the real named agent (`zmachine-acceptance-reviewer`, task `zirp-20261022-04`).** First genuine named-agent invocation (Read/Grep/Glob only, as its tool list enforces). Verdict: F4(a)/(b) and the fresh-session wording fixes **resolved**; no regressions (section numbering, authority statements, tool lists, routing consistency, main-only marking all intact); installed copies match templates. Residual low-severity items: two remaining unmarked S-ID sites (optional cleanup — the `zmachine-context-contracts.md` §9 site and the policy §8 invariant have since been marked; `zmachine-continuity-provenance.md` §5's Future-lane mention and the reviewer's own conditional wording were left as-is, governed transitively by the policy §6 rule); the "sixth edited file" was this record, written after the re-review per disclosed ordering.

## Honest limitations

- The verification script does not check same-directory relative links (that is how the then-dangling `setup-verification-2026-10-22.md` link in `docs/agents/README.md` escaped it); full link integrity is not claimed. Script output beyond the summary counts was not retained.
- Platform behaviors (user-scope-only discovery, fresh-session reload semantics, subagent nesting prohibition) rest on official documentation, nine working pre-existing agents, and this session's observations — not on exhaustive client testing. The observed mid-session reload deviates from the documented behavior; both statements are recorded.
- Invocation-verified covers 1 of 8 roles by name; stand-in coverage extends to 2 more role missions; 5 roles are discovered but never dispatched. Discovery is verified only for this session/client.
- The smoke investigation reports and review reports are summarized here, not committed verbatim.
- "Purely additive install" rests on before/after listings and post-hoc hash/text comparison, not a pre-install snapshot.

## Not done (outside this task's authorization)

No engine implementation, no feasibility-probe execution or interpreter download, no model spend, no product deployment, no commit, push, or merge, no change to accepted product decisions (D01–D37 untouched; D38 left unresolved), no edits to design-document content (specialist recommendations were recorded, not applied).

## Suggested owner follow-ups

1. Commit this configuration on a feature branch and open a PR to `main` (PRs target `main` per the repository convention; nothing has been pushed).
2. Run the fresh-session discovery/invocation checklist in `docs/agents/README.md` on any client where mid-session reload is not observed, and extend this record (or a successor) with the results.
3. Housekeeping (separately authorized): commit `92cddc5` tracks six `.mimosa/` tool-state JSON files; consider removing them from tracking and gitignoring `.mimosa/` (review finding F5 — hygiene only, no privacy violation found).
4. Owner decisions recorded from the smoke investigation: whether to add the policy-to-bridge capability cross-reference and a `CAPABILITY_MISSING` acceptance case for remix/bridged (non-native) effects — both are design-document changes requiring separate authorization.
