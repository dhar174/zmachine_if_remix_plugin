import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { HeadExpectation, OwnerId } from "../contracts.ts";
import type { Authority } from "./authority.ts";

export interface BrowserSession {
  readonly owner: z.infer<typeof OwnerId>;
  readonly csrf: string;
}

/** This verifier must authenticate a browser session independently of tool credentials. */
export type BrowserVerifier = (request: IncomingMessage) => BrowserSession | undefined;
const candidateId = z.string().regex(/^candidate:[0-9a-f-]{36}$/u);
const approve = z.strictObject({ candidate: candidateId, digest: z.string().regex(/^[a-f0-9]{64}$/u) });
const controls = z.strictObject({ head: HeadExpectation, request_id: z.string().regex(/^request:[A-Za-z0-9._:-]+$/u).max(256),
  command: z.string().max(4096) });
const lease = z.strictObject({ head: HeadExpectation, fields: z.array(z.strictObject({
  entity_id: z.string().max(256), field: z.string().max(256),
})).max(32), duration: z.int(), uses: z.int() });
const escaped = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

async function body(request: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > 16_384) throw new Error("Control request too large");
    chunks.push(chunk);
  }
  const data = Buffer.concat(chunks).toString("utf8");
  if (request.headers["content-type"] === "application/json") return JSON.parse(data) as unknown;
  if (request.headers["content-type"] !== "application/x-www-form-urlencoded") throw new Error("Unsupported content type");
  const values = new URLSearchParams(data);
  if (new Set(values.keys()).size !== [...values.keys()].length) throw new Error("Duplicate form fields");
  return Object.fromEntries(values);
}

/** Framework-neutral local control endpoints. No tool route is mounted here. */
export function browserControl(authority: Authority, origin: string, verifyBrowser: BrowserVerifier | null) {
  if (new URL(origin).origin !== origin) throw new Error("Use an exact control origin.");
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const reply = (status: number, value: unknown) => {
      response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(value));
    };
    response.setHeader("cache-control", "no-store");
    response.setHeader("content-security-policy", "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "no-referrer");
    try {
      const url = new URL(request.url ?? "/", origin);
      if (request.headers.host !== new URL(origin).host || url.origin !== origin) return reply(403, { error: "CONTROL_ORIGIN" });
      if (!verifyBrowser) return reply(409, { error: "NEEDS_APPROVAL", reason: "Authenticated browser control is unavailable." });
      const session = verifyBrowser(request);
      if (!session) return reply(401, { error: "BROWSER_AUTH_REQUIRED" });
      const result = <T>(value: import("../ports.ts").Result<T>) =>
        reply(value.ok ? 200 : value.error.status === "VALIDATION_FAILED" ? 404 : 409, value);
      if (request.method === "GET" && url.pathname === "/candidate") {
        const id = candidateId.safeParse(url.searchParams.get("id"));
        if (!id.success) return reply(404, { error: "UNAVAILABLE" });
        const display = authority.display(session.owner, id.data);
        if (!display.ok) return result(display);
        const hidden = (name: string, value: string) => `<input type="hidden" name="${name}" value="${escaped(value)}">`;
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><title>Review Editor change</title><h1>Review Editor change</h1><pre>${escaped(display.value.diff)}</pre><form method="post" action="/approve">${hidden("candidate", id.data)}${hidden("digest", display.value.digest)}${hidden("csrf", session.csrf)}<button>Approve this exact change</button></form>`);
        return;
      }
      if (request.method !== "POST") return reply(404, { error: "UNAVAILABLE" });
      if (request.headers.origin !== origin) return reply(403, { error: "CONTROL_ORIGIN" });
      const raw = await body(request);
      const input = z.record(z.string(), z.unknown()).safeParse(raw);
      if (!input.success) return reply(400, { error: "INVALID_CONTROL" });
      const { csrf, ...data } = input.data;
      if (!session.csrf || (csrf ?? request.headers["x-csrf-token"]) !== session.csrf) {
        return reply(403, { error: "CONTROL_CSRF" });
      }
      if (url.pathname === "/approve") {
        const parsed = approve.safeParse(data);
        if (!parsed.success) return reply(400, { error: "INVALID_CONTROL" });
        const confirmed = authority.confirm(session.owner, parsed.data.candidate, parsed.data.digest);
        return confirmed.ok ? reply(200, { approved: true }) : result(confirmed);
      }
      if (url.pathname === "/mode") {
        const parsed = controls.safeParse(data);
        return parsed.success ? result(authority.control(session.owner, parsed.data.head, parsed.data.request_id, parsed.data.command))
          : reply(400, { error: "INVALID_CONTROL" });
      }
      if (url.pathname === "/lease") {
        const parsed = lease.safeParse(data);
        return parsed.success ? result(authority.issueLease(session.owner, parsed.data.head, parsed.data.fields,
          parsed.data.duration, parsed.data.uses)) : reply(400, { error: "INVALID_CONTROL" });
      }
      if (url.pathname === "/revoke") {
        const parsed = z.strictObject({ candidate: candidateId }).safeParse(data);
        return parsed.success ? result(authority.revokeCandidate(session.owner, parsed.data.candidate))
          : reply(400, { error: "INVALID_CONTROL" });
      }
      if (url.pathname === "/revoke-lease") {
        const parsed = z.strictObject({ lease: z.string().regex(/^lease:[0-9a-f-]{36}$/u) }).safeParse(data);
        return parsed.success ? result(authority.revokeLease(session.owner, parsed.data.lease))
          : reply(400, { error: "INVALID_CONTROL" });
      }
      return reply(404, { error: "UNAVAILABLE" });
    } catch {
      if (!response.headersSent) reply(400, { error: "INVALID_CONTROL" });
    }
  };
}
