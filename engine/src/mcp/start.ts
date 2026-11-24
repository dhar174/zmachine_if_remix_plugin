import { readFileSync } from "node:fs";
import { z } from "zod";
import { createFixtureExecutor } from "../fixture/synthetic-world.ts";
import { TurnService } from "../turn/service.ts";
import { authConfig, createFixtureAuth } from "./auth.ts";
import { fixtureServer } from "./server.ts";
import { createNativeFixtureExecutor } from "../native/executor.ts";

const configSchema = z.strictObject({
  listen_port: z.int().min(1).max(65535), database_file: z.string().min(1), auth: authConfig,
  audit_tool_status: z.boolean().optional(),
  private_story_files: z.boolean().default(false),
  heidi_trial: z.boolean().default(false),
  transfer_key_env: z.string().regex(/^[A-Z][A-Z0-9_]*$/u).optional(),
  profile: z.enum(["synthetic", "native-z5"]).default("synthetic"),
});
const configPath = process.argv[2];
if (!configPath || process.argv.length !== 3) {
  process.stderr.write("Usage: npm run start:fixture -- <local configuration file>\n");
  process.exitCode = 1;
} else {
  try {
    const config = configSchema.parse(JSON.parse(readFileSync(configPath, "utf8")) as unknown);
    if (config.profile === "native-z5" && !config.private_story_files && config.auth.public_origin !== "http://127.0.0.1:" + config.listen_port) {
      throw new Error("The native Z5 profile requires its loopback origin.");
    }
    if (config.private_story_files && config.profile !== "native-z5") {
      throw new Error("Private stories require the native profile.");
    }
    if (config.heidi_trial && !config.private_story_files) {
      throw new Error("The Heidi trial requires private story transfers.");
    }
    const key = config.transfer_key_env && process.env[config.transfer_key_env];
    if (config.private_story_files && (!key || !/^[0-9a-f]{64}$/u.test(key))) {
      throw new Error("Private transfers need a configured 32-byte hexadecimal key.");
    }
    const auth = createFixtureAuth(config.auth);
    const executor = config.profile === "native-z5" ? createNativeFixtureExecutor() : createFixtureExecutor();
    const service = new TurnService(config.database_file, executor, undefined, undefined, config.profile,
      config.private_story_files && key ? { key: Buffer.from(key, "hex"), heidiTrial: config.heidi_trial } : undefined);
    const collected = service.collectAbandoned();
    if (!collected.ok) {
      service.close();
      throw new Error("Fixture recovery cleanup failed.");
    }
    const server = fixtureServer(service, config.auth.public_origin, auth, config.audit_tool_status ? {
      audit: ({ tool, status }) => { process.stdout.write(JSON.stringify({ tool, status }) + "\n"); },
    } : {});
    server.once("error", () => {
      service.close();
      process.stderr.write("Fixture listener could not start. Check the configured loopback port.\n");
      process.exitCode = 1;
    });
    const sweep = config.private_story_files ? setInterval(() => { service.collectAbandoned(); }, 30_000) : undefined;
    sweep?.unref();
    const stop = () => {
      clearInterval(sweep);
      server.close(() => service.close());
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    server.listen(config.listen_port, "127.0.0.1", () => {
      process.stdout.write("Fixture " + config.profile + " listening on loopback port " + config.listen_port + "\n");
    });
  } catch {
    process.stderr.write("Fixture startup configuration or database could not be opened.\n");
    process.exitCode = 1;
  }
}
