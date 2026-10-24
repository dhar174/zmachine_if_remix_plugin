# Codex project agent verification — 2026-10-23

**Result: reviewable conversion; read-only admission BLOCKED.** Native discovery and deterministic mock invocation succeeded for all eight roles. The checked client still exposes forbidden capabilities. This is contributor-configuration evidence, separate from Issue #13, G1-C, the G1-B worktree, and all game/runtime evidence.

## Snapshot and isolation

- Base: `origin/main` at `73e7a6ebc86263201e7a2cdcc21ddd05304e5506`.
- Branch: `codex/project-specialist-agents`; isolated Codex-managed worktree. The receipt's per-file SHA-256 values identify the tested role definitions and preserved Zcode inputs.
- Native executable: `codex-cli 0.164.0-alpha.11.1`. Its executable SHA-256 is retained in [the JSON receipt](codex-agent-probe-2026-10-23.json). The coordinator used the explicit native `.exe`, not the PowerShell/npm `codex` wrapper.
- Python: local standard library, including `tomllib`; no dependency or integration installed.
- Probe model traffic: a loopback deterministic HTTP/SSE provider, without OpenAI authentication or live model inference. The test's disposable configuration disabled apps/plugins/memories and web search; it did not load user account configuration or copy user credentials. The disposable test home and synthetic session history were removed by the harness.
- This test trusted the isolated checkout in its disposable configuration using the native Windows backslash path. The forward-slash trust key did not enable project discovery in this binary. No user-scope trust setting, agent installation, or account permission was changed. No project `.codex/config.toml` was needed.

## Checks and evidence

Final command, run from the isolated worktree (paths identify the local tested binary and scratch parent, not project requirements):

```powershell
python docs/agents/verify-codex-agents.py `
  --codex-exe 'C:/Users/darf3/AppData/Local/OpenAI/Codex/bin/8925276705115dea/codex.exe' `
  --scratch-parent 'C:/Users/darf3/.codex/validation' `
  --receipt docs/agents/codex-agent-probe-2026-10-23.json
```

Observed stdout:

```text
Static checks: 8/8; mock role invocation: 8/8; native exit: 0
Admission: blocked
```

The verification utility exited **3**, its explicit admission-blocked result. The native Codex subprocess exited **0**. Its only stderr was `Reading additional input from stdin...`, the CLI's informational message about redirected stdin. There was no error/warning in this final subprocess run. The utility verified the receipt by reading it back.

| Evidence layer | Observed result | Limit |
| --- | --- | --- |
| Static conversion | Eight TOML files parse; exact roster/feature keys; original role bodies retained, with the reviewer scope addition; source/profile hashes recorded | Does not prove discovery or enforcement |
| Project discovery | Native `spawn_agent` accepted each named project role from this checkout | Test-specific Windows trust configuration; no desktop reload claim |
| Instruction loading | Each child provider request contained its exact TOML `developer_instructions` | Does not evaluate whether a model follows them |
| Mock invocation | Eight native child agents completed a controlled two-request introspection round trip | Synthetic outputs, not specialist reasoning or independent review |
| Shell reduction | Every child reported `typeof tools.exec_command === "undefined"`; `exec_command` and `write_stdin` were absent from the advertised nested tools | Verifies this supported reduction only |
| Remaining capabilities | Every child reported `typeof tools.apply_patch === "function"`; runtime names include `create_goal` and `update_goal`; advertised tools include the collaboration namespace | Fails canonical read-only/no-task-write/no-delegation policy |
| Actual writes/commands by children | None: the mock requested only in-memory tool introspection | Does not test write-sandbox effectiveness; no patch or goal mutation was attempted |
| Independent acceptance review | Not performed | Current available specialist tool surface fails admission; author checks are not independent review |
| Live model/product/client behavior | Not tested | No game probe, approval/import test, runtime/language choice, or host/mobile claim |

## Exact remaining blockers

All eight roles received the same effective tool list in the isolated check. [The receipt](codex-agent-probe-2026-10-23.json) retains each role's advertised list and runtime nested-tool introspection. In particular:

- `apply_patch` remains callable in the tool host. The test did not attempt a write and makes no claim about whether the parent's read-only sandbox would reject one. Mere availability already violates the canonical read-only tool requirement.
- `create_goal` and `update_goal` remain callable; task-state mutation is outside specialist authority.
- `collaboration.spawn_agent`, `followup_task`, `send_message`, `interrupt_agent`, `list_agents`, and `wait_agent` remain advertised. The test did not exercise recursive dispatch; their exposure fails the no-delegation boundary.
- No native text-file Read/Grep/Glob tools were exposed. A revision-bound source packet could supply evidence after capability restriction is established, but cannot establish restriction itself.
- Inherited MCP/dynamic tools and real-session network surfaces are not qualified by a test home with no configured integrations. Agent-local `mcp_servers`, `sandbox_mode`, or approval fields would not replace the parent's controls, per current official documentation.

The supported feature reductions therefore cannot qualify these files as independent read-only specialists on the tested native client. Prompt prohibitions are preserved but are not accepted as technical enforcement. Substantive dispatch remains blocked under [policy §9.1](team-coordination.md#91-codex-project-adapter-and-admission-gate). A fresh compatible client's effective-tool evidence and independent acceptance review are required before claiming operational readiness. No account change or installation is authorized by this record.

## Failed exploratory checks and final evidence boundary

Exploratory checks are not credited as passes: an initial command placed `-a` after `exec` (CLI exit 2); a system-temp test home was refused for helper creation; a forward-slash trust key did not discover project agents; ephemeral sessions produced parent-transcript hook warnings; and one isolated plugins-enabled diagnostic produced a featured-catalog HTTP 401 warning. The final reproducible utility uses the native argument order, a non-system-temp disposable home, native Windows trust path, normal disposable session history, and plugins disabled. No integration was installed or account permission altered during those diagnostics.

All source `.zcode` definitions remain unchanged. Documentation integrity receipts under `validation/` remain historical and were not rewritten. The final branch's scope checks and publication status belong in the PR/handoff; they are not additional runtime evidence.
