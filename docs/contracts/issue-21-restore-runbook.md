# Issue #21 fixture restore runbook

## Run a fixture session

Build from a clean LF checkout in `engine/` with `npm ci` and `npm run build`. Use the local [fixture configuration](fixture-mcp.md), one coordinator, and a private SQLite file outside Git. Run `npm run start:fixture -- <local configuration file>`. For `native-z5`, use the exact loopback origin and the bundled seeded fixture from [#20](../evidence/g3-native-turns.md). Keep the same compiled adapter, Node/V8, platform, and architecture throughout the session.

If you need to retain a v1 or v2 store for use with an earlier checkout, stop its coordinator and back up the database before opening it with v3. The additive SQLite upgrade retains the previous checkpoint and receipt rows. Native checkpoint identities still bind the adapter and host. The #21 adapter build requires a fresh native session for #20 databases with incompatible images. Keep the earlier checkout and database backup together if you need to resume those sessions.

## Save and restore

1. Activate the fixture and call `get_turn_context`. Send `save_session` with `version: "1.0.0"` and `target` containing the returned head fields and a fresh `request_id`. Keep the `SAVED` result and its opaque `save_id` with the session and branch IDs. The save is a reference to the committed combined checkpoint in this database.
2. Read the active head when ready to restore. Send `restore_session` with `version`, a fresh `target`, and the chosen `save_id`. Open the returned `control_url` in the independently authenticated browser. Compare the current and saved revisions, input boundary, and clocks before approving.
3. Repeat the same restore arguments after browser confirmation. On `RESTORED`, read fresh context and confirm the returned generation, revisions, and Play mode. Recent history follows the restored ancestry. Use the original generation and request ID when inspecting a displaced receipt. Old chat may still contain text and spoilers from the displaced state.
4. For an expired approval or a worker interruption, retry the exact arguments to check for the outcome or obtain a new preview. For `STALE_REVISION`, confirm the intended save against fresh context and make a new restore request. A malformed or incompatible checkpoint leaves the active head available. Preserve the database and record the error before investigating saved data.

## Recover after process death

Restart one coordinator on the same database and exact runtime build. Startup fences the previous coordinator, clears abandoned claims and pending approvals, revokes Editor authority, and collects unpublished checkpoints that have no live claim. Published checkpoints and private save references survive.

- After a pre-publication death, the previous head remains active and the same restore request requires a new browser confirmation.
- After a post-publication death, the exact same restore request returns its recorded result. The exact arguments of a committed turn likewise return its recorded receipt. Preserve the original arguments while the outcome is uncertain.
- If an active checkpoint fails validation or the store cannot open, retain the database for diagnosis. Avoid manual head changes, re-seeding the session, or invoking native restart as a recovery action.

Native parser save, restore, undo, and restart are blocked. Use the combined tools for the supported seeded line and character boundaries. Portable export and private import belong to [Issue #22](https://github.com/dhar174/zmachine_if_remix_plugin/issues/22).
