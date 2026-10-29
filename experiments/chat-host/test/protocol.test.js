import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { setup, owner, other, proposal, commitArgs, approvalArgs, fixture } from './helpers.js';
import { id, FIXTURE_SHA } from '../src/model.js';

for(const mode of ['legacy','auto'])test(`actual official MCP HTTP client: ${mode} discovery and complete synthetic lifecycle`,async t=>{
  const h=await setup(t),token=await h.sign();
  const client=new Client({name:'g1c-local-protocol-client',version:'0.1.0'},{versionNegotiation:{mode}});
  let catalogWire;
  const transport=new StreamableHTTPClientTransport(new URL(`${h.probe.origin}/mcp`),{
    fetch:async(url,options)=>{const response=await fetch(url,options);if(String(options?.body).includes('"method":"tools/list"'))catalogWire=await response.clone().text();return response;},
    requestInit:{headers:{authorization:`Bearer ${token}`}}});
  t.after(()=>client.close());await client.connect(transport);
  const version=client.getNegotiatedProtocolVersion();
  assert.equal(version,mode==='auto'?'2026-07-28':'2025-11-25');
  const catalog=await client.listTools();assert.equal(catalog.tools.length,7);
  assert.ok(Buffer.byteLength(JSON.stringify(catalog))<32768);
  for(const tool of catalog.tools) {
    assert.equal(tool.inputSchema.additionalProperties,false);
    assert.ok(tool._meta.securitySchemes);
    assert.ok(tool.outputSchema);
  }
  const wireMessage=JSON.parse(catalogWire.startsWith('event:')?catalogWire.split('\n').find(line=>line.startsWith('data:')).slice(5):catalogWire);
  for(const tool of wireMessage.result.tools)assert.deepEqual(tool.securitySchemes,tool._meta.securitySchemes);
  assert.ok(!catalog.tools.some(x=>/approve|export|execute|shell/.test(x.name)));
  assert.equal(catalog.tools.find(x=>x.name==='probe_prepare_label').annotations.readOnlyHint,false);
  assert.equal(catalog.tools.find(x=>x.name==='probe_get_receipt').annotations.readOnlyHint,true);
  assert.deepEqual(catalog.tools.find(x=>x.name==='probe_import_fixture')._meta['openai/fileParams'],['file']);
  const trace=[];
  async function call(name,args,expected) {
    const result=await client.callTool({name,arguments:args});
    if(expected) {assert.equal(result.isError,true);assert.match(JSON.stringify(result),new RegExp(expected));}
    else assert.ok(!result.isError,JSON.stringify(result));
    trace.push({tool:name,input:args,result});return result.structuredContent;
  }
  const state=await call('probe_get_state',{});
  const candidate=await call('probe_prepare_label',proposal(state));
  assert.equal(h.probe.store.state(owner).revision,0);
  await call('probe_commit_label',commitArgs(candidate,{approval_ref:id()}),'NEEDS_APPROVAL');
  const browser=await h.login();
  const page=await fetch(`${h.probe.origin}/candidate?id=${candidate.candidate_id}`,{headers:{cookie:browser.cookie}});
  assert.equal(page.status,200);const html=await page.text();
  assert.ok(html.includes(candidate.digest)&&html.includes('Renamed Chamber')&&html.includes('Probe Chamber'));
  assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  // Automated synthetic interaction, NEVER real human approval evidence.
  const approved=await h.post('/approve',approvalArgs(candidate),browser);
  // session_id is server-resolved, so a caller cannot substitute it in this form.
  assert.equal(approved.status,400);
  const exact={candidate_id:candidate.candidate_id,digest:candidate.digest,expected_revision:String(candidate.base_revision)};
  const approvedExact=await h.post('/approve',exact,browser);
  assert.equal(approvedExact.status,200,await approvedExact.clone().text());
  assert.match(approvedExact.headers.get('content-type'),/^text\/html/);
  const confirmation=await approvedExact.text();
  const inspected=await call('probe_get_candidate',{session_id:state.session_id,candidate_id:candidate.candidate_id});
  const grant=inspected.approval;assert.ok(grant);assert.ok(!confirmation.includes(grant.approval_ref));
  const args=commitArgs(candidate,grant),receipt=await call('probe_commit_label',args);
  assert.equal(receipt.revision,1);assert.deepEqual(await call('probe_commit_label',args),receipt);
  assert.equal((await call('probe_get_candidate',{session_id:state.session_id,candidate_id:candidate.candidate_id})).approval,null);
  assert.deepEqual(await call('probe_get_receipt',{session_id:state.session_id,request_id:args.request_id}),receipt);
  const fresh=await call('probe_get_state',{});assert.equal(fresh.room_label,'Renamed Chamber');assert.equal(fresh.revision,1);
  await call('probe_prepare_label',proposal(state,'Stale'),'STALE_REVISION');
  const inverse=await call('probe_prepare_label',proposal(fresh,'Probe Chamber'));
  const inverseApproval=await h.post('/approve',{candidate_id:inverse.candidate_id,digest:inverse.digest,expected_revision:'1'},browser);
  assert.equal(inverseApproval.status,200);
  const inverseGrant=(await call('probe_get_candidate',{session_id:state.session_id,candidate_id:inverse.candidate_id})).approval;
  assert.ok(inverseGrant);assert.ok(!(await inverseApproval.text()).includes(inverseGrant.approval_ref));
  await call('probe_commit_label',commitArgs(inverse,inverseGrant));
  assert.equal((await call('probe_get_state',{})).revision,2);
  const upload=await fetch(`${h.probe.origin}/upload`,{method:'POST',headers:{cookie:browser.cookie,origin:h.probe.origin,'content-type':'application/octet-stream','x-csrf-token':browser.csrf},body:fixture});
  assert.equal(upload.status,200,await upload.clone().text());const metadata=await upload.json();
  assert.equal(metadata.sha256,FIXTURE_SHA);
  assert.deepEqual(await call('probe_inspect_import',{session_id:state.session_id,import_handle:metadata.import_handle}),metadata);
  const deleted=await h.post('/delete-import',{import_handle:metadata.import_handle},browser);assert.equal(deleted.status,200);
  await call('probe_inspect_import',{session_id:state.session_id,import_handle:metadata.import_handle},'NOT_FOUND');
  await call('probe_import_fixture',{session_id:state.session_id,file:{file_id:'file-synthetic',download_url:'https://files.invalid/test'}},'HOST_IMPORT_BLOCKED');
  assert.equal(h.probe.store.state(owner).revision,2);
  mkdirSync('results',{recursive:true});
  const path=`results/protocol-${mode}.json`;
  const record={evidence_layer:'local protocol with synthetic principals and automated browser POSTs',human_approval:false,chatgpt:false,protocol:version,catalog,wire_catalog:wireMessage.result,trace,import_metadata:metadata};
  writeFileSync(path,JSON.stringify(record,null,2)+'\n');
  const {readFileSync}=await import('node:fs');assert.deepEqual(JSON.parse(readFileSync(path,'utf8')),record);
});
test('official client receives denied authentication; HTTP metadata and schema errors are real protocol responses',async t=>{
  const h=await setup(t);
  const unauth=await fetch(`${h.probe.origin}/mcp`,{method:'POST',body:'{}'});assert.equal(unauth.status,401);assert.match(unauth.headers.get('www-authenticate'),/oauth-protected-resource/);
  const metadata=await fetch(`${h.probe.origin}/.well-known/oauth-protected-resource`);assert.equal(metadata.status,200);
  const token=await h.sign();const client=new Client({name:'negative-client',version:'1'});
  t.after(()=>client.close());await client.connect(new StreamableHTTPClientTransport(new URL(`${h.probe.origin}/mcp`),{requestInit:{headers:{authorization:`Bearer ${token}`}}}));
  const state=(await client.callTool({name:'probe_get_state',arguments:{}})).structuredContent;
  for(const extra of [{approved:true},{role:'user'},{source_message_id:'user-123'},{consent_text:'I approve'},{owner_id:owner},{operation:'eval'}]) {
    const result=await client.callTool({name:'probe_prepare_label',arguments:{...proposal(state),...extra}});assert.ok(result.isError);
  }
  await assert.rejects(client.callTool({name:'approve',arguments:{approved:true}}),/not found/);
  assert.equal(h.probe.store.state(owner).revision,0);
});

test('official client receipt recovery requires read scope and exact owner/session, rejects extra fields',async t=>{
  const h=await setup(t),state=h.probe.store.state(owner),c=h.probe.store.prepare(owner,proposal(state));
  const args=commitArgs(c,h.probe.store.approve(owner,approvalArgs(c)));
  const receipt=h.probe.store.commit(owner,args);
  async function connect(claims,options) {
    const client=new Client({name:'receipt-recovery-client',version:'1'});t.after(()=>client.close());
    const token=await h.sign(claims,options);
    await client.connect(new StreamableHTTPClientTransport(new URL(`${h.probe.origin}/mcp`),{requestInit:{headers:{authorization:`Bearer ${token}`}}}));
    return client;
  }
  const reader=await connect({scope:'probe:read'}),lookup={session_id:state.session_id,request_id:args.request_id};
  const recovered=await reader.callTool({name:'probe_get_receipt',arguments:lookup});
  assert.ok(!recovered.isError);assert.deepEqual(recovered.structuredContent,receipt);
  assert.ok(!JSON.stringify(recovered).includes(args.approval_ref));
  for(const extra of [{owner_id:owner},{approved:true},{approval_ref:args.approval_ref},{operation:'commit'}]) {
    const denied=await reader.callTool({name:'probe_get_receipt',arguments:{...lookup,...extra}});assert.ok(denied.isError);
  }
  const noScope=await connect({scope:''}),bob=await connect({scope:'probe:read'},{subject:'bob'});
  const denied=await noScope.callTool({name:'probe_get_receipt',arguments:lookup});
  assert.ok(denied.isError);assert.match(JSON.stringify(denied),/INSUFFICIENT_SCOPE/);
  for(const foreign of [lookup,{...lookup,session_id:h.probe.store.state(other).session_id}]) {
    const result=await bob.callTool({name:'probe_get_receipt',arguments:foreign});
    assert.ok(result.isError);assert.match(JSON.stringify(result),/NOT_FOUND/);
  }
  const absent=await reader.callTool({name:'probe_get_receipt',arguments:{...lookup,request_id:id()}});
  assert.ok(absent.isError);assert.match(JSON.stringify(absent),/NOT_FOUND/);
  assert.equal(h.probe.store.state(owner).revision,1);assert.equal(h.probe.store.grants.size,0);
});
