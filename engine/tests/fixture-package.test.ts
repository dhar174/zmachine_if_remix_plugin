import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { z } from "zod";
import { createFixtureExecutor } from "../src/fixture/synthetic-world.ts";
import { fixtureTools } from "../src/mcp/tools.ts";
import { TurnService } from "../src/turn/service.ts";

void test("portable fixture package has four instruction-only skills and references the actual tool catalog", () => {
  const root = new URL("../../plugin/", import.meta.url);
  const read = (url: URL) => readFileSync(url, "utf8");
  const manifest = z.strictObject({ $schema: z.literal("https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"),
    name: z.literal("zmachine-if-remix"), version: z.literal("1.0.0"), description: z.string().min(1),
  }).parse(JSON.parse(read(new URL("plugin.json", root))));
  assert.equal(manifest.version, "1.0.0");
  assert.deepEqual(readdirSync(root).sort(), ["plugin.json", "references", "skills"]);
  const names = ["edit-remix-world", "inspect-remix-session", "play-remix-story", "start-remix-session"];
  assert.deepEqual(readdirSync(new URL("skills/", root)).sort(), names);
  for (const name of names) {
    const path = new URL("skills/" + name + "/", root);
    assert.deepEqual(readdirSync(path), ["SKILL.md"]);
    const content = read(new URL("SKILL.md", path));
    assert.match(content, new RegExp("^---\\r?\\nname: " + name + "\\r?\\ndescription: .+"));
    const matches = [...content.matchAll(/\]\(([^)]+)\)/gu)];
    assert.equal(matches.length, 1);
    for (const [, destination] of matches) {
      assert.ok(destination);
      const reference = new URL(destination, path);
      assert.ok(reference.href.startsWith(root.href));
      assert.match(read(reference), /fixture MCP contract v1/u);
    }
  }
  const contract = read(new URL("references/fixture-mcp.v1.md", root));
  const directory = mkdtempSync(join(tmpdir(), "zirp-package-"));
  const service = new TurnService(join(directory, "fixture.sqlite"), createFixtureExecutor());
  try {
    const routes = Object.keys(fixtureTools(service, "https://fixture.test", true));
    assert.equal(routes.length, 8);
    for (const name of routes) assert.ok(contract.includes("`" + name + "`"), name);
  } finally {
    service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
