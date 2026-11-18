---
name: start-remix-session
description: Start the configured remix fixture and set an initial directive.
---

Read the [v1 fixture contract](../../references/fixture-mcp.v1.md).

1. Explain the bundled fixture scope and ask the user to open the configured browser control page and consent. Use their launch handle with `open_story_session`. Keep its session and branch IDs. If the context includes `native.opening`, describe the authored opening effect and the setup command and time cost. An edit to the already-executed opening is unsupported.
2. Pick a fresh request ID and call `set_input_mode` for Editor. Ask the owner to open the returned link, record the exact initial directive, and share the source reference.
3. Get the compiler context with `get_turn_context` and interpret the recorded text in `prepare_turn`. Show supported and unresolved clauses. The fixture is still a draft. Send the subset link so the owner can select supported clauses and approve the exact policy and patch in the browser.
4. Repeat the identical preparation to retrieve the selected candidate. Commit it using the original target and directive source reference. Describe the opening state from the committed receipt and `get_turn_context`. Preserve the exact commit arguments for recovery.
