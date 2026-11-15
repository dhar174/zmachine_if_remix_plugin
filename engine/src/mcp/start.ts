import { readFileSync } from "node:fs";
import { z } from "zod";
import { createFixtureExecutor } from "../fixture/synthetic-world.ts";
import { TurnService } from "../turn/service.ts";
import { authConfig, createFixtureAuth } from "./auth.ts";
import { fixtureServer } from "./server.ts";

const configSchema = z.strictObject({
  listen_port: z.int().min(1).max(65535), database_file: z.string().min(1), auth: authConfig,
  audit_tool_status: z.boolean().optional(),
});
const configPath = process.argv[2];
if (!configPath || process.argv.length !== 3) {
  process.stderr.write("Usage: npm run start:fixture -- <local configuration file>\n");
  process.exitCode = 1;
} else {
  try {
    const config = configSchema.parse(JSON.parse(readFileSync(configPath, "utf8")) as unknown);
    const auth = createFixtureAuth(config.auth);
    const service = new TurnService(config.database_file, createFixtureExecutor());
    const server = fixtureServer(service, config.auth.public_origin, auth, config.audit_tool_status ? {
      audit: ({ tool, status }) => { process.stdout.write(JSON.stringify({ tool, status }) + "\n"); },
    } : {});
    server.once("error", () => {
      service.close();
      process.stderr.write("Fixture listener could not start. Check the configured loopback port.\n");
      process.exitCode = 1;
    });
    const stop = () => server.close(() => service.close());
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    server.listen(config.listen_port, "127.0.0.1", () => {
      process.stdout.write("Synthetic fixture listening on loopback port " + config.listen_port + "\n");
    });
  } catch {
    process.stderr.write("Fixture startup configuration or database could not be opened.\n");
    process.exitCode = 1;
  }
}
