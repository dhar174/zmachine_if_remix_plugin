import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuth } from '../src/auth.js';
import { SignJWT } from 'jose';
import { setup, owner } from './helpers.js';

test('auth diagnostics classify rejection without exposing tokens, owners or claims',async t=>{
  const h=await setup(t),events=[],auth=createAuth(h.config,{onFailure:event=>events.push(event)});
  t.after(()=>auth.close());
  const cases=[
    [null,'BEARER_MISSING_OR_MALFORMED'], ['private-token-marker','JWT_FORMAT'],
    [await h.sign({}, {issuer:'https://private-issuer.invalid'}),'JWT_ISS'],
    [await h.sign({}, {audience:'private-audience-marker'}),'JWT_AUD'],
    [await h.sign({}, {ttl:-1}),'JWT_EXPIRED'],
    [await h.sign({}, {subject:'private-owner-marker'}),'OWNER_NOT_ALLOWED'],
    [await h.sign({scope:null}),'SCOPE_CLAIM_MISSING']
  ];
  for (const [token,reason] of cases) {
    await assert.rejects(auth.authenticateMcp({headers:token?{authorization:`Bearer ${token}`}:{}}),error=>error.code==='UNAUTHENTICATED' && error.status===401);
    assert.deepEqual(events.at(-1),{phase:'mcp',reason});
    if(token) assert.ok(!JSON.stringify(events).includes(token));
  }
  assert.ok(!JSON.stringify(events).includes('private-'));
  assert.equal(h.probe.store.state(owner).revision,0);
});

test('diagnostic observer failure cannot authorize a denial or reject valid MCP identity',async t=>{
  const h=await setup(t),auth=createAuth(h.config,{onFailure(){throw new Error('private-observer-message');}});
  t.after(()=>auth.close());
  await assert.rejects(auth.authenticateMcp({headers:{}}),error=>error.code==='UNAUTHENTICATED' && error.status===401);
  assert.equal((await auth.authenticateMcp({headers:{authorization:`Bearer ${await h.sign()}`}})).owner,owner);
});

test('five-second iat skew preserves exact expiry, not-before and 900-second age boundaries',async t=>{
  const h=await setup(t),now=Math.floor(Date.now()/1000),events=[];
  const auth=createAuth(h.config,{clock:()=>now*1000,onFailure:event=>events.push(event)});t.after(()=>auth.close());
  const sign=claims=>new SignJWT({scope:'probe:read',iat:now,exp:now+600,...claims})
    .setProtectedHeader({alg:'ES256',kid:'test-key'}).setIssuer(h.config.issuer)
    .setAudience(h.config.audience).setSubject('alice').sign(h.privateKey);
  for(const claims of [{iat:now+1},{iat:now+5},{iat:now-900}]) {
    assert.equal((await auth.authenticateMcp({headers:{authorization:`Bearer ${await sign(claims)}`}})).owner,owner);
  }
  for(const [claims,reason] of [[{iat:now+6},'JWT_IAT'],[{iat:now-901},'JWT_IAT'],[{iat:null},'JWT_IAT'],
    [{iat:now+1,exp:now},'JWT_EXPIRED'],[{iat:now+1,exp:now-1},'JWT_EXPIRED'],[{iat:now+1,nbf:now+1},'JWT_NBF']]) {
    await assert.rejects(auth.authenticateMcp({headers:{authorization:`Bearer ${await sign(claims)}`}}),error=>error.code==='UNAUTHENTICATED' && error.status===401);
    assert.deepEqual(events.at(-1),{phase:'mcp',reason});
  }
});

test('browser diagnostics distinguish callback, JWT and nonce rejection without approval',async t=>{
  const h=await setup(t),events=[];
  for (const mode of ['binding','issuer','nonce']) {
    const auth=createAuth(h.config,{onFailure:event=>events.push(event),fetcher:async()=>Response.json({id_token:await h.sign({nonce:'private-nonce-marker'},
      {issuer:mode==='issuer'?'https://private-issuer.invalid':h.config.issuer,audience:h.config.browser_client_id})})});
    t.after(()=>auth.close());
    let headers;auth.login({writeHead(_status,value){headers=value;},end(){}});
    const login=new URL(headers.location),state=login.searchParams.get('state');
    const req={headers:{cookie:headers['set-cookie'].split(';')[0]}};
    const url=new URL(`${h.config.public_origin}/oauth/callback`);
    url.search=new URLSearchParams({state:mode==='binding'?'private-state-marker':state,iss:h.config.issuer,code:'private-code-marker'});
    await assert.rejects(auth.callback(req,{},url),error=>error.code==='INVALID_LOGIN' && error.status===401);
    assert.deepEqual(events.at(-1),{phase:'browser',reason:{binding:'CALLBACK_BINDING',issuer:'JWT_ISS',nonce:'NONCE_OR_CLIENT_BINDING'}[mode]});
  }
  assert.ok(!JSON.stringify(events).includes('private-'));
  assert.equal(h.probe.store.state(owner).revision,0);
});
