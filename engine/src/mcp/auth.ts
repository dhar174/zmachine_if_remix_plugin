import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createLocalJWKSet, jwtVerify } from "jose";
import type { JSONWebKeySet } from "jose";
import { z } from "zod";
import { OwnerId, canonicalDigest } from "../contracts.ts";
import type { BrowserSession } from "../auth/browser-control.ts";
import { scopes } from "./tools.ts";

const https = z.url().refine((s) => {
  const url = new URL(s);
  return url.protocol === "https:" && !url.username && !url.password && !url.hash;
});
const scopeList = Object.values(scopes);
export const authConfig = z.strictObject({
  issuer: https, audience: https, public_origin: z.url(),
  authorization_endpoint: https, token_endpoint: https,
  browser_client_id: z.string().min(1).max(256),
  client_secret_env: z.string().regex(/^[A-Z][A-Z0-9_]*$/u).optional(),
  subjects: z.array(z.string().min(1).max(256)).min(1).max(10),
  jwks: z.strictObject({ keys: z.array(z.record(z.string(), z.unknown())).min(1).max(10) }),
});

export interface FixtureAuth {
  authenticate(request: IncomingMessage): Promise<import("./tools.ts").Principal | undefined>;
  browser(request: IncomingMessage): BrowserSession | undefined;
  login(response: ServerResponse): void;
  callback(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void>;
  metadata: { resource: string; authorization_servers: string[]; scopes_supported: string[] };
}

const random = () => randomBytes(32).toString("base64url");
const ownerOf = (issuer: string, subject: string) => OwnerId.parse("owner:" + canonicalDigest([issuer, subject]));
function cookie(request: IncomingMessage, name: string) {
  const matching = (request.headers.cookie ?? "").split(";").map((item) => item.trim()).filter((item) => item.startsWith(name + "="));
  return matching.length === 1 ? matching[0]?.slice(name.length + 1) : undefined;
}

async function responseJson(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) throw new Error("OIDC token response unavailable.");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.length;
      if (length > 16_384) throw new Error("OIDC token response exceeds its limit.");
      chunks.push(Buffer.from(item.value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export function createFixtureAuth(input: unknown, clock = Date.now, fetcher = fetch): FixtureAuth {
  const config = authConfig.parse(input);
  const origin = new URL(config.public_origin);
  if (origin.origin !== config.public_origin ||
      !(origin.protocol === "https:" || origin.protocol === "http:" && origin.hostname === "127.0.0.1") ||
      new URL(config.authorization_endpoint).origin !== new URL(config.issuer).origin ||
      new URL(config.token_endpoint).origin !== new URL(config.issuer).origin) {
    throw new Error("Invalid fixture authentication origin or issuer endpoints.");
  }
  if (config.jwks.keys.some((key) => ["d", "k", "p", "q", "dp", "dq", "qi", "oth"].some((name) => name in key))) {
    throw new Error("Fixture authentication requires public verification keys.");
  }
  if (config.client_secret_env && !process.env[config.client_secret_env]) throw new Error("Browser client secret is unavailable.");
  const keys = createLocalJWKSet(config.jwks as JSONWebKeySet);
  const flows = new Map<string, { nonce: string; verifier: string; until: number }>();
  const sessions = new Map<string, BrowserSession & { until: number }>();
  const callback = new URL("/oauth/callback", origin).href;
  const flags = "Path=/; HttpOnly; SameSite=Lax" + (origin.protocol === "https:" ? "; Secure" : "");
  const token = z.object({ id_token: z.string().min(1).max(12_000) });
  const clean = () => {
    const now = clock();
    for (const table of [flows, sessions]) for (const [id, record] of table) if (record.until <= now) table.delete(id);
  };
  const verify = async (raw: string, audience: string) => {
    const now = clock();
    const { payload } = await jwtVerify(raw, keys, { issuer: config.issuer, audience, currentDate: new Date(now),
      algorithms: ["RS256", "ES256"], requiredClaims: ["sub", "exp", "iat"] });
    if (!payload.sub || !config.subjects.includes(payload.sub) || payload.iat === undefined || payload.exp === undefined ||
        payload.iat < now / 1000 - 900 || payload.iat > now / 1000 + 5) throw new Error("Invalid fixture principal.");
    return { sub: payload.sub, exp: payload.exp, scope: payload.scope, nonce: payload.nonce, azp: payload.azp };
  };
  const reply = (response: ServerResponse, status: number) => {
    response.writeHead(status);
    response.end();
  };

  return {
    metadata: { resource: config.audience, authorization_servers: [config.issuer], scopes_supported: scopeList },
    async authenticate(request) {
      const raw = request.headers.authorization;
      if (!raw || !/^Bearer [^ ]+$/u.test(raw)) return undefined;
      try {
        const claims = await verify(raw.slice(7), config.audience);
        if (typeof claims.scope !== "string") return undefined;
        return { owner: ownerOf(config.issuer, claims.sub), scopes: new Set(claims.scope.split(" ")) };
      } catch {
        return undefined;
      }
    },
    browser(request) {
      clean();
      const handle = cookie(request, "fixture_session");
      return handle ? sessions.get(handle) : undefined;
    },
    login(response) {
      clean();
      if (flows.size >= 20 || sessions.size >= 20) return reply(response, 429);
      const state = random(), nonce = random(), verifier = random();
      flows.set(state, { nonce, verifier, until: clock() + 300_000 });
      const location = new URL(config.authorization_endpoint);
      location.search = new URLSearchParams({ response_type: "code", scope: "openid", client_id: config.browser_client_id,
        redirect_uri: callback, state, nonce, code_challenge_method: "S256",
        code_challenge: createHash("sha256").update(verifier).digest("base64url") }).toString();
      response.writeHead(302, { location: location.href, "set-cookie": "fixture_flow=" + state + "; Max-Age=300; " + flags });
      response.end();
    },
    async callback(request, response, url) {
      clean();
      const state = url.searchParams.get("state"), code = url.searchParams.get("code");
      const flow = state ? flows.get(state) : undefined;
      if (!state || !flow || cookie(request, "fixture_flow") !== state || url.searchParams.get("iss") !== config.issuer ||
          !code || code.length > 4096 || url.searchParams.getAll("code").length !== 1 || url.searchParams.getAll("state").length !== 1) {
        return reply(response, 401);
      }
      flows.delete(state);
      try {
        const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: callback,
          client_id: config.browser_client_id, code_verifier: flow.verifier });
        if (config.client_secret_env) {
          const secret = process.env[config.client_secret_env];
          if (!secret) return reply(response, 503);
          body.set("client_secret", secret);
        }
        const upstream = await fetcher(config.token_endpoint, { method: "POST", body, redirect: "error", signal: AbortSignal.timeout(5000) });
        const claims = await verify(token.parse(await responseJson(upstream)).id_token, config.browser_client_id);
        if (claims.nonce !== flow.nonce || (claims.azp !== undefined && claims.azp !== config.browser_client_id)) return reply(response, 401);
        if (sessions.size >= 20) return reply(response, 429);
        const handle = random();
        sessions.set(handle, { owner: ownerOf(config.issuer, claims.sub), csrf: random(), until: Math.min(clock() + 900_000, claims.exp * 1000) });
        response.writeHead(302, { location: "/session", "set-cookie": [
          "fixture_session=" + handle + "; Max-Age=900; " + flags, "fixture_flow=; Max-Age=0; " + flags,
        ] });
        response.end();
      } catch {
        reply(response, 401);
      }
    },
  };
}
