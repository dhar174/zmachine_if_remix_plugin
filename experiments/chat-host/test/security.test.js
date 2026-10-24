import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { SignJWT,generateKeyPair } from 'jose';
import { setup,owner,other,proposal,approvalArgs,commitArgs,fixture,issuer,audience } from './helpers.js';
import { id, LIMITS, schemas, parse,checkOutput } from '../src/model.js';
import { fetchHostFile,publicAddress } from '../src/host-file.js';
import { readBody } from '../src/service.js';
import { boundedResponse,createAuth } from '../src/auth.js';

test('JWT signature, issuer, audience, expiry, subject, scope and model owner forgery',async t=>{
  const h=await setup(t);
  const {privateKey}=await generateKeyPair('ES256');
  const forged=await new SignJWT({scope:'probe:read'}).setProtectedHeader({alg:'ES256',kid:'test-key'}).setIssuer(issuer).setAudience(audience).setSubject('alice').setIssuedAt().setExpirationTime('1h').sign(privateKey);
  for(const token of ['forged',forged,await h.sign({}, {issuer:'https://wrong.invalid'}),await h.sign({}, {audience:'other'}),await h.sign({}, {ttl:-1}),await h.sign({}, {subject:'mallory'})]) {
    const response=await fetch(`${h.probe.origin}/mcp`,{method:'POST',headers:{authorization:`Bearer ${token}`},body:'{}'});
    assert.equal(response.status,401);assert.deepEqual(await response.json(),{status:'UNAUTHENTICATED'});
  }
  const who={owner,scopes:['probe:read']},state=await h.probe.invoke(who,'probe_get_state',{});
  await assert.rejects(h.probe.invoke(who,'probe_prepare_label',proposal(state)),e=>e.code==='INSUFFICIENT_SCOPE');
  await assert.rejects(h.probe.invoke({...who,owner:other},'probe_get_candidate',{session_id:state.session_id,candidate_id:id()}),e=>e.code==='NOT_FOUND');
  assert.equal(h.probe.store.state(owner).revision,0);
});
test('MCP bearer cannot approve; browser cookie, exact CSRF, origin and immutable form are required',async t=>{
  const h=await setup(t),token=await h.sign(),state=h.probe.store.state(owner),c=h.probe.store.prepare(owner,proposal(state));
  const exact={candidate_id:c.candidate_id,digest:c.digest,expected_revision:'0'};
  const bearer=await fetch(`${h.probe.origin}/approve`,{method:'POST',headers:{authorization:`Bearer ${token}`,origin:h.probe.origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(exact)});assert.equal(bearer.status,401);
  const browser=await h.login(),bob=await h.login('bob');
  for(const fields of [{...exact,csrf:'forged'},{...exact,room_label:'Substituted'},{...exact,digest:'f'.repeat(64)},{...exact,expected_revision:'1'}]) {
    const response=await h.post('/approve',fields,browser);assert.ok([400,403,409].includes(response.status));
  }
  assert.equal((await h.post('/approve',exact,browser,{origin:'https://evil.invalid'})).status,403);
  assert.equal((await h.post('/approve',exact,bob)).status,404);
  const approved=await h.post('/approve',exact,browser);assert.equal(approved.status,200);const grant=await approved.json();
  assert.equal((await h.post('/revoke',{candidate_id:c.candidate_id},browser)).status,200);
  assert.throws(()=>h.probe.store.commit(owner,commitArgs(c,grant)),e=>e.code==='NEEDS_APPROVAL');
  assert.equal(h.probe.store.state(owner).revision,0);
});
test('OIDC callback rejects missing binding, wrong issuer, duplicate cookie and replay; sessions expire',async t=>{
  let now=1800000000000;const h=await setup(t,{clock:()=>now});
  for(const query of ['state=forged&code=x',`state=x&code=y&iss=${issuer}`])assert.equal((await fetch(`${h.probe.origin}/oauth/callback?${query}`,{redirect:'manual'})).status,401);
  const response=await fetch(`${h.probe.origin}/login`,{redirect:'manual'}),url=new URL(response.headers.get('location'));
  const state=url.searchParams.get('state'),cookie=response.headers.get('set-cookie').split(';')[0];
  const badIssuer=await fetch(`${h.probe.origin}/oauth/callback?${new URLSearchParams({state,code:'x',iss:'https://evil.invalid'})}`,{headers:{cookie},redirect:'manual'});assert.equal(badIssuer.status,401);
  assert.equal((await fetch(`${h.probe.origin}/oauth/callback?${new URLSearchParams({state,code:'x',iss:issuer})}`,{headers:{cookie:`${cookie}; ${cookie}`},redirect:'manual'})).status,401);
  now+=300000;
  assert.equal((await fetch(`${h.probe.origin}/oauth/callback?${new URLSearchParams({state,code:'x',iss:issuer})}`,{headers:{cookie},redirect:'manual'})).status,401);
  const browser=await h.login();
  assert.equal((await fetch(browser.callbackUrl,{redirect:'manual',headers:{cookie:browser.flowCookie}})).status,401);
  now+=600000;
  assert.equal((await fetch(`${h.probe.origin}/session`,{headers:{cookie:browser.cookie}})).status,401);
  assert.equal((await fetch(`${h.probe.origin}/session`,{headers:{cookie:'probe_session=forged'}})).status,401);
});
test('real HTTP fixture upload requires cookie/CSRF/type and denies foreign handles',async t=>{
  const h=await setup(t),browser=await h.login(),bob=await h.login('bob');
  const base={cookie:browser.cookie,origin:h.probe.origin,'x-csrf-token':browser.csrf,'content-type':'application/octet-stream'};
  for(const headers of [{...base,cookie:''},{...base,'x-csrf-token':'bad'},{...base,origin:'https://evil.invalid'},{...base,'content-type':'text/plain'}]) {
    const response=await fetch(`${h.probe.origin}/upload`,{method:'POST',headers,body:fixture});assert.ok([401,403,415].includes(response.status));
  }
  for(const bytes of [Buffer.alloc(0),fixture.subarray(0,40),Buffer.alloc(LIMITS.uploadBytes+1)]) {
    const response=await fetch(`${h.probe.origin}/upload`,{method:'POST',headers:base,body:bytes});assert.ok([400,413].includes(response.status));
  }
  const upload=await fetch(`${h.probe.origin}/upload`,{method:'POST',headers:base,body:fixture});assert.equal(upload.status,200);const metadata=await upload.json();
  assert.equal((await h.post('/delete-import',{import_handle:metadata.import_handle},bob)).status,404);
  assert.equal((await h.post('/delete-import',{import_handle:metadata.import_handle},browser)).status,200);
  assert.equal(h.probe.store.db.prepare('SELECT COUNT(*) AS n FROM imports').get().n,0);
});
test('request byte limit, rate window and output bound fail without world mutations',async t=>{
  let now=1800000000000;const h=await setup(t,{clock:()=>now});const token=await h.sign();
  const headers={authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json, text/event-stream'};
  const big=await fetch(`${h.probe.origin}/mcp`,{method:'POST',headers,body:' '.repeat(LIMITS.requestBytes+1)});assert.equal(big.status,413);
  for(let n=1;n<LIMITS.requestsPerMinute;n++)await fetch(`${h.probe.origin}/mcp`,{method:'POST',headers,body:'not JSON'});
  assert.equal((await fetch(`${h.probe.origin}/mcp`,{method:'POST',headers,body:'{}'})).status,429);
  now+=60000;assert.notEqual((await fetch(`${h.probe.origin}/mcp`,{method:'POST',headers,body:'{}'})).status,429);
  assert.equal(h.probe.store.state(owner).revision,0);
  const tiny=await setup(t,{limits:{...LIMITS,resultBytes:1}});
  await assert.rejects(tiny.probe.invoke({owner,scopes:['probe:read']},'probe_get_state',{}),e=>e.code==='OUTPUT_LIMIT');
  assert.equal(tiny.probe.store.state(owner).revision,0);
});
test('ordinary and upload body deadlines bound hanging inputs and clean listeners',async()=>{
  for(const timeout of [LIMITS.requestMs,LIMITS.uploadMs]) {
    // A scaled timer exercises the identical deadline path without a 15s test wait.
    const input=new EventEmitter();input.headers={};input.resume=()=>{};
    await assert.rejects(readBody(input,10,Math.min(timeout,20)),e=>e.code==='REQUEST_TIMEOUT');
    assert.equal(input.listenerCount('data'),0);assert.equal(input.listenerCount('end'),0);
  }
  const input=new EventEmitter();input.headers={};input.resume=()=>{};
  const pending=readBody(input,10,100);input.emit('aborted');await assert.rejects(pending,e=>e.code==='DISCONNECTED');
});
test('actual hanging HTTP request terminates with 408 and closes connection',async t=>{
  const h=await setup(t,{limits:{...LIMITS,requestMs:30,uploadMs:50}}),token=await h.sign();
  const status=await new Promise((resolve,reject)=>{
    const req=request(`${h.probe.origin}/mcp`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','transfer-encoding':'chunked'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
    req.on('error',reject);req.write('{');
  });assert.equal(status,408);assert.equal(h.probe.store.state(owner).revision,0);
});
test('native host fetch is disabled; URL and DNS controls reject before network access',async()=>{
  const file={file_id:'file-synthetic',download_url:'https://files.invalid/f'};
  for(const url of ['http://files.invalid/f','https://127.0.0.1/f','https://files.invalid@evil.invalid/f','https://files.invalid/f#fragment']) {
    await assert.rejects(fetchHostFile({...file,download_url:url},['https://files.invalid'],LIMITS),e=>e.code==='FILE_ORIGIN_DENIED');
  }
  for(const address of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','100.64.0.1','::1','::ffff:127.0.0.1'])assert.equal(publicAddress(address),false);
  assert.equal(publicAddress('8.8.8.8'),true);
  await assert.rejects(fetchHostFile(file,['https://files.invalid'],LIMITS,{resolve:async()=>[{address:'127.0.0.1',family:4}]}),e=>e.code==='FILE_ORIGIN_DENIED');
  await assert.rejects(fetchHostFile(file,['https://files.invalid'],{...LIMITS,uploadMs:20},{resolve:()=>new Promise(()=>{})}),e=>e.code==='FILE_TIMEOUT');
});
test('bounded identity-provider response rejects oversize and errors',async()=>{
  await assert.rejects(boundedResponse(new Response('x'.repeat(11)),10),e=>e.code==='UPSTREAM_TOO_LARGE');
  await assert.rejects(boundedResponse(new Response('',{status:500}),10),e=>e.code==='UPSTREAM_REJECTED');
});
test('the actual 16 KiB output budget rejects larger results',()=>{
  assert.throws(()=>checkOutput({text:'x'.repeat(LIMITS.resultBytes)}),e=>e.code==='OUTPUT_LIMIT');
  assert.equal(checkOutput({text:'x'.repeat(LIMITS.resultBytes-11)}).text.length,LIMITS.resultBytes-11);
});
test('production ordinary/upload deadline values are exercised without indefinite operations',async()=>{
  for(const timeout of [LIMITS.requestMs,LIMITS.uploadMs]) {
    const input=new EventEmitter();input.headers={};input.resume=()=>{};
    const started=Date.now();await assert.rejects(readBody(input,10,timeout),e=>e.code==='REQUEST_TIMEOUT');
    assert.ok(Date.now()-started>=timeout-10);assert.equal(input.listenerCount('data'),0);
  }
});
test('strict schemas reject claimed consent, paths, base64 and instruction payloads',()=>{
  const state={session_id:id(),revision:0};
  for(const extra of [{approved:true},{role:'user'},{source_message_id:'123'},{consent_text:'yes'},{path:'C:/story.z5'},{url:'https://evil.invalid'},{base64:'aGVsbG8='}])assert.throws(()=>parse(schemas.probe_prepare_label,{...proposal(state),...extra}),e=>e.code==='BAD_SCHEMA');
  assert.throws(()=>parse(schemas.probe_import_fixture,{session_id:state.session_id,file:{download_url:'https://files.invalid/f',file_id:'x',approved:true}}),e=>e.code==='BAD_SCHEMA');
});
test('CLI without explicit configuration fails closed and has no test-grant switches',()=>{
  const env={...process.env};delete env.PROBE_AUTH_CONFIG;delete env.PROBE_DATA_DIR;
  const result=spawnSync(process.execPath,['src/cli.js'],{env,encoding:'utf8',timeout:5000});
  assert.equal(result.status,2);assert.match(result.stderr,/EXPLICIT_AUTH_CONFIG_AND_DATA_DIR_REQUIRED/);assert.equal(result.stdout,'');
});
test('OIDC nonce substitution fails and public-key configuration rejects signing secrets',async t=>{
  const h=await setup(t);
  const auth=createAuth(h.config,{fetcher:async()=>Response.json({id_token:await h.sign({nonce:'forged'},{audience:h.config.browser_client_id})})});
  t.after(()=>auth.close());
  let headers;
  auth.login({writeHead:(_status,value)=>{headers=value;},end:()=>{}});
  const redirect=new URL(headers.location),state=redirect.searchParams.get('state');
  const callback=new URL(`${h.config.public_origin}/oauth/callback?${new URLSearchParams({state,code:'synthetic',iss:issuer})}`);
  await assert.rejects(auth.callback({headers:{cookie:headers['set-cookie'].split(';')[0]}},{},callback),e=>e.code==='INVALID_LOGIN');
  assert.throws(()=>createAuth({...h.config,jwks:{keys:[{...h.config.jwks.keys[0],d:'not-a-real-key'}]}}),e=>e.code==='PUBLIC_KEYS_ONLY');
});
test('OAuth flow and browser-session capacities are bounded',async t=>{
  const h=await setup(t),flows=createAuth(h.config);t.after(()=>flows.close());
  const res={writeHead:()=>{},end:()=>{}};
  for(let i=0;i<20;i++)flows.login(res);
  assert.throws(()=>flows.login(res),e=>e.code==='LOGIN_LIMIT');
  for(let i=0;i<20;i++)await h.login();
  assert.equal((await fetch(`${h.probe.origin}/login`,{redirect:'manual'})).status,429);
});
