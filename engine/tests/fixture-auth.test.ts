import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer, IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { z } from "zod";
import { createFixtureAuth } from "../src/mcp/auth.ts";
import { scopes } from "../src/mcp/tools.ts";

void test("signed Auth0-shaped bearer verification enforces issuer, audience, lifetime and owner", async () => {
  const timestamp = 1_800_000_000;
  const issuer = "https://issuer.test/";
  const audience = "https://fixture.test/resource";
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const jwk = await exportJWK(publicKey);
  const auth = createFixtureAuth({
    issuer, audience, public_origin: "https://fixture.test", authorization_endpoint: issuer + "authorize",
    token_endpoint: issuer + "oauth/token", browser_client_id: "fixture-browser",
    subjects: ["authorized-owner"], jwks: { keys: [{ ...jwk, kid: "fixture-test-key" }] },
  }, () => timestamp * 1000);
  const sign = (iss = issuer, aud = audience, subject = "authorized-owner", expires = timestamp + 60) =>
    new SignJWT({ scope: scopes.read }).setIssuer(iss).setAudience(aud).setSubject(subject)
      .setIssuedAt(timestamp).setExpirationTime(expires).setProtectedHeader({ alg: "ES256", kid: "fixture-test-key" }).sign(privateKey);
  const req = new IncomingMessage(new Socket());
  req.headers.authorization = "Bearer " + await sign();
  const verified = await auth.authenticate(req);
  assert.ok(verified);
  assert.match(verified.owner, /^owner:[0-9a-f]{64}$/u);
  assert.deepEqual([...verified.scopes], [scopes.read]);
  assert.equal(auth.browser(req), undefined);
  for (const denied of await Promise.all([
    sign("https://other.test/"), sign(issuer, "fixture-browser"), sign(issuer, audience, "unlisted"),
    sign(issuer, audience, "authorized-owner", timestamp - 1),
  ])) {
    req.headers.authorization = "Bearer " + denied;
    assert.equal(await auth.authenticate(req), undefined);
  }
  req.socket.destroy();
});

void test("browser code, PKCE and nonce bind a separate session to the verified MCP owner", async () => {
  const issuer = "https://issuer.test/";
  const origin = "https://fixture.test";
  const audience = origin + "/resource";
  const browserAudience = "fixture-browser";
  const now = 1_800_000_000;
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const jwk = await exportJWK(publicKey);
  let nonce: string | null = null;
  let challenge: string | null = null;
  const sign = (aud: string, claims: Record<string, unknown>) =>
    new SignJWT(claims).setIssuer(issuer).setAudience(aud).setSubject("fixture-owner")
      .setIssuedAt(now).setExpirationTime(now + 60).setProtectedHeader({ alg: "ES256", kid: "fixture-browser-key" }).sign(privateKey);
  const auth = createFixtureAuth({
    issuer, audience, public_origin: origin, authorization_endpoint: issuer + "authorize", token_endpoint: issuer + "oauth/token",
    browser_client_id: browserAudience, subjects: ["fixture-owner"], jwks: { keys: [{ ...jwk, kid: "fixture-browser-key" }] },
  }, () => now * 1000, async (url, options) => {
    assert.equal(url, issuer + "oauth/token");
    assert.equal(options?.redirect, "error");
    assert.ok(options.body instanceof URLSearchParams);
    const verifier = options.body.get("code_verifier");
    assert.ok(verifier);
    assert.equal(createHash("sha256").update(verifier).digest("base64url"), challenge);
    assert.equal(options.body.get("redirect_uri"), origin + "/oauth/callback");
    return Response.json({ id_token: await sign(browserAudience, { nonce }) });
  });
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", origin);
    if (url.pathname === "/login") return auth.login(res);
    if (url.pathname === "/oauth/callback") { void auth.callback(req, res, url); return; }
    const session = auth.browser(req);
    res.writeHead(session ? 200 : 401, { "content-type": "application/json" });
    res.end(JSON.stringify(session ? { owner: session.owner } : {}));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = "http://127.0.0.1:" + address.port;
    const login = await fetch(base + "/login", { redirect: "manual" });
    assert.equal(login.status, 302);
    const location = new URL(login.headers.get("location") ?? "");
    nonce = location.searchParams.get("nonce");
    challenge = location.searchParams.get("code_challenge");
    assert.ok(nonce && challenge);
    assert.equal(location.searchParams.get("code_challenge_method"), "S256");
    const flow = login.headers.get("set-cookie")?.split(";")[0];
    const state = location.searchParams.get("state");
    assert.ok(flow && state);
    const callback = base + "/oauth/callback?" + new URLSearchParams({ iss: issuer, state, code: "fixture-code" }).toString();
    assert.equal((await fetch(callback, { redirect: "manual" })).status, 401);
    const confirmed = await fetch(callback, { redirect: "manual", headers: { cookie: flow } });
    assert.equal(confirmed.status, 302);
    const cookie = confirmed.headers.getSetCookie().find((value) => value.startsWith("fixture_session="));
    assert.ok(cookie?.includes("HttpOnly") && cookie.includes("Secure"));
    assert.equal((await fetch(callback, { redirect: "manual", headers: { cookie: flow } })).status, 401);
    const session = await fetch(base + "/session", { headers: { cookie: cookie?.split(";")[0] ?? "" } });
    assert.equal(session.status, 200);
    const req = new IncomingMessage(new Socket());
    req.headers.authorization = "Bearer " + await sign(audience, { scope: scopes.read });
    const mcp = await auth.authenticate(req);
    assert.ok(mcp);
    assert.equal(z.object({ owner: z.string() }).parse(await session.json()).owner, mcp.owner);
    req.socket.destroy();
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
