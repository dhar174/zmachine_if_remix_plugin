# Codex project specialist candidates

**Status: converted and discovery-tested; substantive use blocked.** These files adapt the eight versioned Zcode roles to `.codex/agents/*.toml`. The engineering coordinator remains the only writer and command executor. Reviewers remain independent, return findings, and never repair reviewed material. The roster and six-part return contract remain owned by [team-coordination.md](team-coordination.md), especially §§4–6 and 9.1.

Read the root contributor guide, both coordination skills identified there, and `.zcode/skills/zmachine-remix-engineering/SKILL.md` as required by the task. These are source instructions; their presence does not install Zcode, a memory profile, or any integration in Codex. The conversion preserves every `.zcode` file. It does not authorize a product probe or change a G0–G6 decision.

## Field mapping

| Zcode source | Codex project equivalent |
| --- | --- |
| Filename, `name`, `description` | Matching `.toml` basename, `name`, and `description`; same eight role identifiers |
| Role markdown | Retained in `developer_instructions`, after an explicit platform/evidence adapter |
| `tools` | Supported feature reductions below, plus mandatory effective-tool admission; no invented Codex Read/Grep/Glob tools |
| Provider-specific `model` and `thoughtLevel` | Omitted; inherit Codex's resolved model/reasoning configuration; no substitute model is selected by these files |
| `color`, `maxTurns`, `injectAgentsMd` | Omitted; no assumed portable equivalent; bounded effort belongs in the assignment packet |

Seven source roles pin `zai-standard-api/GLM-5.3-Flash` with `thoughtLevel: max`; the acceptance reviewer has no model override. Copying that provider identifier into Codex would not establish availability. Each adapter retains the original role's mission, startup sources, exclusions, domain traps, investigation procedure, and return contract. The acceptance reviewer additionally includes `.codex/agents/*.toml` in its configuration-review scope. The adapter explains dated design-only inventory statements; current checkout/probe evidence governs what actually exists.

Every file sets these supported reductions:

```toml
[features]
shell_tool = false
apps = false
plugins = false
memories = false
request_permissions_tool = false

[skills]
include_instructions = false

[skills.bundled]
enabled = false
```

These settings reduce exposure. They do not define a complete tool allowlist. No agent-local sandbox, approval, provider, MCP, or account permission override is included. Instructions prohibit network, mutation, task-state writes, and recursion; qualification still depends on actual enforcement.

## Official documentation and observed limits

The official [Codex subagents documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents) describes project TOML discovery and supported reductions, while explaining that parent permissions and MCP configuration are inherited. The [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) documents `features.shell_tool`. Consult the current pages when rechecking this adapter.

The [dated setup record](setup-verification-codex-2026-10-23.md) separates static conversion, native discovery, mock invocation, and the failed read-only gate. The checked native executable removed shell execution but retained `apply_patch`, goal mutation, and collaboration tools. No native text-file Read/Grep/Glob tools were available. Parent MCP/dynamic/network access would need a separate audit in a real session. A complete source packet can replace missing read access; it cannot remove unwanted capabilities.

Do not install integrations, synchronize user-scope definitions, alter account permissions, enable parallel writers, or relax the policy to make these candidates usable. Until fresh evidence satisfies §9.1, the coordinator performs authorized work directly and reports independent specialist review as unmet. A future qualified invocation must use the advertised exact role name, the full §5 assignment packet, the same stable revision/source packet for independent work, and the §6 return contract.

## Reproduce the configuration check

Use Python 3.11+ and an explicit native Codex `.exe` path. Do not use the `codex` wrapper: it previously attempted unrelated Waggle bootstrap. Choose an existing scratch parent outside the checkout and outside the operating system's temporary directory (the checked binary refuses helper creation under system temp).

```powershell
python docs/agents/verify-codex-agents.py `
  --codex-exe 'C:/path/to/native/codex.exe' `
  --scratch-parent 'C:/path/to/scratch' `
  --receipt 'C:/path/to/configuration-receipt.json'
```

The utility uses an isolated disposable configuration, strips credential-related environment variables, sets the model provider to a loopback deterministic server, and exercises named roles without executing shell, patch, goal, network, or recursive agent calls in the child. It retains only configuration fingerprints and tool evidence in the requested JSON receipt, not the model input or a private transcript. The temporary test configuration trusts the checkout using its native Windows path; this does not update the user's trust or account settings.

An exit of **3** means admission is blocked or still requires a full capability audit; it is not a passing read-only check. An exit of **1** indicates a probe failure. The utility does not grant admission merely because a short deny list is absent. Mock output proves harness wiring and tool exposure only; it does not evaluate specialist reasoning, return-contract adherence, independent review quality, or product behavior.
