---
name: start-remix-session
description: Start the configured remix fixture and set an initial directive.
---

Read the [v1 fixture contract](../../references/fixture-mcp.v1.md).

1. Ask the user to open the configured browser control page and consent. If that page offers private story import, have the user select a supported file there. Use only the user's launch handle with `open_story_session` and keep the returned session and branch IDs. For an imported combined save, use the session and branch IDs provided by the private browser page with `get_turn_context`. Explain observed opening output and report setup time when the corresponding record includes a command.
2. Pick a fresh request ID and call `set_input_mode` for Editor. Ask the owner to open the returned link, record the exact initial directive, and share the source reference.
3. Get the compiler context with `get_turn_context` and interpret the recorded text in `prepare_turn`. Show supported and unresolved clauses. The fixture is still a draft. Send the subset link so the owner can select supported clauses and approve the exact policy and patch in the browser.
4. Repeat the identical preparation to retrieve the selected candidate. Commit it using the original target and directive source reference. Describe the opening state from the committed receipt and `get_turn_context`. Preserve the exact commit arguments for recovery.
