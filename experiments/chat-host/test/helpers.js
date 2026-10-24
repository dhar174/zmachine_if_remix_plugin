import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createAuth } from '../src/auth.js';
import { createProbe } from '../src/service.js';
import { id, LIMITS } from '../src/model.js';
import { issuer,audience,owner,other,allScopes } from './probe-data.js';
export { fixture,issuer,audience,owner,other,allScopes,proposal,commitArgs,approvalArgs } from './probe-data.js';
import assert from 'node:assert/strict';

export const temporary = () => mkdtempSync(join(tmpdir(),'zirp-g1c-'));
export function removeTemporary(directory) {
  const target=resolve(directory),base=resolve(tmpdir())+sep;
  assert.ok(target.startsWith(base) && target.slice(base.length).startsWith('zirp-g1c-'));
  rmSync(target,{recursive:true,force:true});
}
export const rejectsCode = (promise,code) => assert.rejects(promise,error=>error.code===code);

// Entirely synthetic identity provider. Not imported or reachable by src/cli.js.
export async function setup(t,{limits=LIMITS,clock=Date.now,directory,fetcher}={}) {
  const dir=directory||temporary();
  const {privateKey,publicKey}=await generateKeyPair('ES256');
  const jwk={...await exportJWK(publicKey),alg:'ES256',kid:'test-key'};
  const codes=new Map();
  const config={issuer,audience,public_origin:'http://127.0.0.1:3213',
    authorization_endpoint:`${issuer}/authorize`,token_endpoint:`${issuer}/token`,
    browser_client_id:'browser-test-client',subjects:['alice','bob'],jwks:{keys:[jwk]}};
  async function sign(claims={},options={}) {
    return new SignJWT({scope:allScopes,...claims}).setProtectedHeader({alg:'ES256',kid:'test-key'})
      .setIssuer(options.issuer||issuer).setSubject(options.subject||'alice').setAudience(options.audience||audience)
      .setIssuedAt(Math.floor(clock()/1000)).setExpirationTime(Math.floor(clock()/1000)+(options.ttl??600)).sign(privateKey);
  }
  const provider=async(_url,options)=>{
    const body=options.body,entry=codes.get(body.get('code'));
    assert.ok(entry); codes.delete(body.get('code'));
    const {createHash}=await import('node:crypto');
    assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'),entry.challenge);
    assert.equal(body.get('redirect_uri'),`${config.public_origin}/oauth/callback`);
    const token=await sign({nonce:entry.nonce},{subject:entry.subject,audience:config.browser_client_id});
    return Response.json({id_token:token});
  };
  const auth=createAuth(config,{clock,fetcher:fetcher||provider});
  const probe=await createProbe({directory:dir,auth,clock,limits});
  // External public origin is only used by the synthetic OIDC provider callback.
  // Service origin uses its actual ephemeral loopback listener for CSRF checks.
  async function login(subject='alice') {
    const response=await fetch(`${probe.origin}/login`,{redirect:'manual'});
    assert.equal(response.status,302);
    const redirect=new URL(response.headers.get('location'));
    const code=id();codes.set(code,{nonce:redirect.searchParams.get('nonce'),challenge:redirect.searchParams.get('code_challenge'),subject});
    const callbackUrl=`${probe.origin}/oauth/callback?${new URLSearchParams({code,state:redirect.searchParams.get('state'),iss:issuer})}`;
    const flowCookie=response.headers.get('set-cookie').split(';')[0];
    const callback=await fetch(callbackUrl,{redirect:'manual',headers:{cookie:flowCookie}});
    assert.equal(callback.status,302,await callback.text());
    const cookie=callback.headers.getSetCookie().find(x=>x.startsWith('probe_session=')).split(';')[0];
    const page=await fetch(`${probe.origin}/session`,{headers:{cookie}});
    assert.equal(page.status,200); const html=await page.text();
    return {cookie,csrf:html.match(/name="csrf" value="([^"]+)"/)[1],callbackUrl,flowCookie};
  }
  async function post(path,fields,browser,extra={}) {
    return fetch(`${probe.origin}${path}`,{method:'POST',headers:{cookie:browser.cookie,origin:probe.origin,
      'content-type':'application/x-www-form-urlencoded',...extra},body:new URLSearchParams({csrf:browser.csrf,...fields})});
  }
  t.after(async()=>{await probe.close();if(!directory)removeTemporary(dir);});
  return {probe,auth,sign,login,post,dir,config,privateKey};
}
