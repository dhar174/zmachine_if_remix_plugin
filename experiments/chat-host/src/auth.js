import { createLocalJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import { hash, id, parse, principal, requireThat, ProbeError } from './model.js';

const https = z.string().url().refine(s => { const u = new URL(s); return u.protocol === 'https:' && !u.username && !u.password && !u.hash; });
export const authConfigSchema = z.strictObject({
  issuer: https, audience: https, public_origin: z.string().url(),
  authorization_endpoint: https, token_endpoint: https,
  browser_client_id: z.string().min(1), client_secret_env: z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional(),
  subjects: z.array(z.string().min(1)).min(1).max(10),
  jwks: z.strictObject({ keys: z.array(z.record(z.string(), z.unknown())).min(1) })
});
export function cookie(req, name) {
  const values = (req.headers.cookie || '').split(';').map(s => s.trim()).filter(s => s.startsWith(`${name}=`));
  requireThat(values.length <= 1, 'UNAUTHENTICATED', 401);
  return values[0]?.slice(name.length + 1);
}
export async function boundedResponse(response, max, signal) {
  requireThat(response.ok, 'UPSTREAM_REJECTED', 502);
  const chunks = []; let length = 0;
  const reader = response.body?.getReader();
  requireThat(reader, 'UPSTREAM_EMPTY', 502);
  try {
    while (true) {
      signal?.throwIfAborted();
      const item = await reader.read();
      if (item.done) break;
      length += item.value.length;
      requireThat(length <= max, 'UPSTREAM_TOO_LARGE', 413);
      chunks.push(item.value);
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

// Configuration comes from one explicitly supplied file, never credential discovery.
// Public keys are pinned for this short probe; provider key rotation is manual.
export function createAuth(input, { clock = Date.now, fetcher = fetch, onFailure } = {}) {
  const config = parse(authConfigSchema, input), origin = new URL(config.public_origin);
  requireThat(origin.origin === config.public_origin && !origin.username && !origin.password
    && (origin.protocol === 'https:' || (origin.protocol === 'http:' && origin.hostname === '127.0.0.1')), 'INVALID_PUBLIC_ORIGIN');
  requireThat(config.jwks.keys.every(key => !['d','k','p','q','dp','dq','qi'].some(field => field in key)), 'PUBLIC_KEYS_ONLY');
  const keys = createLocalJWKSet(config.jwks), sessions = new Map(), flows = new Map();
  const owners = config.subjects.map(s => principal(config.issuer, s));
  const cookieFlags = `Path=/; HttpOnly; SameSite=Lax${origin.protocol === 'https:' ? '; Secure' : ''}`;
  // Local diagnostics contain fixed categories only, never exceptions or claims.
  const report = (phase, reason) => { try { onFailure?.({phase, reason}); } catch {} };
  const jwtReason = error => {
    if (error?.code === 'OWNER_NOT_ALLOWED') return 'OWNER_NOT_ALLOWED';
    if (error?.code === 'JWT_IAT_REJECTED') return 'JWT_IAT';
    if (error?.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') return ['iss','aud','iat','exp','sub','nbf'].includes(error.claim)
      ? `JWT_${error.claim.toUpperCase()}` : 'JWT_CLAIMS';
    return ({ERR_JWT_EXPIRED:'JWT_EXPIRED', ERR_JOSE_ALG_NOT_ALLOWED:'JWT_ALGORITHM',
      ERR_JWS_SIGNATURE_VERIFICATION_FAILED:'JWT_SIGNATURE', ERR_JWKS_NO_MATCHING_KEY:'JWT_KEY',
      ERR_JWS_INVALID:'JWT_FORMAT', ERR_JWT_INVALID:'JWT_FORMAT'})[error?.code] || 'JWT_REJECTED';
  };
  const cleanup = () => {
    for (const map of [sessions, flows]) for (const [key, value] of map) if (value.expires <= clock()) map.delete(key);
  };
  async function verify(token, audience) {
    const currentDate = new Date(clock()), now = Math.floor(currentDate.getTime()/1000);
    const { payload } = await jwtVerify(token, keys, { issuer: config.issuer, audience,
      algorithms: ['RS256', 'ES256'], requiredClaims: ['sub', 'exp', 'iat'], currentDate });
    // Only iat permits five seconds of issuer skew. exp/nbf keep JOSE's zero
    // tolerance, and tokens older than 900 seconds are still rejected exactly.
    requireThat(Number.isFinite(payload.iat) && payload.iat <= now+5 && now-payload.iat <= 900, 'JWT_IAT_REJECTED', 401);
    requireThat(typeof payload.sub === 'string' && config.subjects.includes(payload.sub), 'OWNER_NOT_ALLOWED', 401);
    return payload;
  }
  return {
    owners, origin: config.public_origin,
    resourceMetadata: { resource: config.audience, authorization_servers: [config.issuer],
      scopes_supported: ['probe:read', 'probe:stage', 'probe:commit', 'probe:import'] },
    async authenticateMcp(req) {
      let reason = 'BEARER_MISSING_OR_MALFORMED';
      try {
        requireThat(/^Bearer [^ ]+$/.test(req.headers.authorization || ''), 'UNAUTHENTICATED', 401);
        reason = 'JWT';
        const payload = await verify(req.headers.authorization.slice(7), config.audience);
        reason = 'SCOPE_CLAIM_MISSING';
        requireThat(typeof payload.scope === 'string', 'UNAUTHENTICATED', 401);
        return { owner: principal(config.issuer, payload.sub), scopes: payload.scope.split(' ') };
      } catch (error) { report('mcp', reason === 'JWT' ? jwtReason(error) : reason); throw new ProbeError('UNAUTHENTICATED', 401); }
    },
    browser(req) {
      cleanup(); const session = sessions.get(cookie(req, 'probe_session'));
      requireThat(session, 'BROWSER_LOGIN_REQUIRED', 401); return session;
    },
    login(res) {
      cleanup(); requireThat(flows.size < 20 && sessions.size < 20, 'LOGIN_LIMIT', 429);
      const state = id(), nonce = id(), verifier = id() + id();
      flows.set(state, { nonce, verifier, expires: clock() + 300000 });
      const url = new URL(config.authorization_endpoint);
      for (const [key, value] of Object.entries({ response_type: 'code', client_id: config.browser_client_id,
        redirect_uri: `${config.public_origin}/oauth/callback`, scope: 'openid', state, nonce,
        code_challenge: Buffer.from(hash(verifier), 'hex').toString('base64url'), code_challenge_method: 'S256' })) url.searchParams.set(key, value);
      res.writeHead(302, { location: url.href, 'set-cookie': `probe_flow=${state}; Max-Age=300; ${cookieFlags}` }); res.end();
    },
    async callback(req, res, url) {
      cleanup(); const state = url.searchParams.get('state'), flow = flows.get(state);
      try { requireThat(flow && cookie(req, 'probe_flow') === state && url.searchParams.get('iss') === config.issuer, 'INVALID_LOGIN', 401); }
      catch (error) { report('browser','CALLBACK_BINDING'); throw error; }
      flows.delete(state);
      const code = url.searchParams.get('code'); requireThat(code && code.length < 4096, 'INVALID_LOGIN', 401);
      const body = new URLSearchParams({ grant_type: 'authorization_code', code,
        redirect_uri: `${config.public_origin}/oauth/callback`, client_id: config.browser_client_id,
        code_verifier: flow.verifier });
      if (config.client_secret_env) {
        const secret = process.env[config.client_secret_env]; requireThat(secret, 'BROWSER_AUTH_NOT_CONFIGURED', 503);
        body.set('client_secret', secret);
      }
      const signal = AbortSignal.timeout(5000);
      const response = await fetcher(config.token_endpoint, { method: 'POST', body, redirect: 'error', signal });
      const tokens = JSON.parse((await boundedResponse(response, 16384, signal)).toString('utf8'));
      let claims;
      try { claims = await verify(tokens.id_token, config.browser_client_id); }
      catch (error) { report('browser',jwtReason(error)); throw new ProbeError('INVALID_LOGIN',401); }
      if (claims.nonce !== flow.nonce || (claims.azp && claims.azp !== config.browser_client_id)) report('browser','NONCE_OR_CLIENT_BINDING');
      requireThat(claims.nonce === flow.nonce && (!claims.azp || claims.azp === config.browser_client_id), 'INVALID_LOGIN', 401);
      requireThat(sessions.size < 20, 'LOGIN_LIMIT', 429);
      const handle = id();
      sessions.set(handle, { owner: principal(config.issuer, claims.sub), csrf: id(), expires: Math.min(clock() + 900000, claims.exp * 1000) });
      res.writeHead(302, { location: '/session', 'set-cookie': [`probe_session=${handle}; Max-Age=900; ${cookieFlags}`, `probe_flow=; Max-Age=0; ${cookieFlags}`] }); res.end();
    },
    close() { sessions.clear(); flows.clear(); }
  };
}
