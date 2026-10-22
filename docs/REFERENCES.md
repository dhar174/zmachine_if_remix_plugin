# Sources and evidence boundaries

**External references checked:** 2026-10-21. Documentation can change; pin actual software and contracts during implementation. These are primary-source references, not evidence that the proposed engine has been built.

## Platform and protocol

- **P1. OpenAI, Skills:** https://developers.openai.com/plugins/concepts/skills  
  Supports separating model-facing instructions/resources from executable service responsibilities. Our skill names and workflow are proposals.
- **P2. OpenAI, Build an MCP server:** https://developers.openai.com/plugins/build/mcp-server  
  Documents server tools, structured results, stable IDs, optional UI, validation, authorization, and tool annotations. These mechanisms support the proposed architecture but do not prove our tools exist.
- **P3. OpenAI, Connect and test your plugin:** https://developers.openai.com/plugins/deploy/connect-chatgpt  
  Documents endpoint/tunnel testing and testing the combined skills/tool experience. Target-client compatibility and approval provenance must still be verified.
- **P4. OpenAI, Plugin quickstart:** https://developers.openai.com/plugins/quickstart  
  Describes plugins with skills, MCP, or both, and a web-hosted testing flow. It is not a guarantee of mobile or local-script support.
- **M1. MCP project, Tool annotations as risk vocabulary:** https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/  
  Explains why annotations are hints rather than enforcement and do not replace sandboxing, authorization, or prompt-injection controls.

## Z-machine

- **S1. Z-machine standard, Memory map:** https://inform-fiction.ifarchive.org/zmachine/standards/z1point1/sect01.html  
  Defines dynamic/static/high memory and their access properties.
- **S2. Z-machine standard, Object table:** https://inform-fiction.ifarchive.org/zmachine/standards/z1point1/sect12.html  
  Defines object entries, links, attributes, and properties. Story-level meanings require additional evidence.
- **S3. Z-machine standard, Opcode dictionary:** https://inform-fiction.ifarchive.org/zmachine/standards/z1point1/sect15.html  
  Defines operations including input, random, save/restore, and object manipulation. Runtime integration and complete checkpoint behavior need implementation tests.

## Repository evidence

The inspected baseline was commit `f4e019743f4026b4ceb82668164b7c36759b2b68`. Its tracked files were `.gitignore`, `README.md`, and `docs/design_draft_v0.1.md`. There was no runtime code or test suite in that inspected tree. This statement is pinned to the baseline, not a claim about future main.

The existing v0.1 draft was copied into a prior chat artifact. The local copy's Git blob hash was checked against the repository blob `47ac21a066fa09066faf076108868545a0a08287`. The original file is retained unchanged; the new README, documentation index, and v0.2 specification explain its historical status.

The v0.1 binary-audit attachment is private and is not added to this public documentation set. This revision does not reassert or newly verify its object counts, game title, story-specific flags, runtime compatibility, or playability. No original story text corpus or story binary is published.

## What validation can and cannot establish

Local documentation checks can establish file presence, internal links, JSON/schema structure, sample validity, malformed sample rejection, and preservation of the archived draft. They cannot establish runtime safety, VM round trips, native-state changes, live-model compliance, host/mobile integration, or absence of every semantic conflict.
