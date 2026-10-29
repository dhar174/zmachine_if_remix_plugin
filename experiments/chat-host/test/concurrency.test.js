import test from 'node:test';
import assert from 'node:assert/strict';
import { Client,StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { setup,owner,proposal,approvalArgs,commitArgs } from './helpers.js';

test('concurrent identical HTTP commits and a reconnected client observe one logical edit',async t=>{
  const h=await setup(t),token=await h.sign(),browser=await h.login();
  const clients=[];
  async function connect() {
    const client=new Client({name:'retry-client',version:'1'},{versionNegotiation:{mode:'auto'}});
    await client.connect(new StreamableHTTPClientTransport(new URL(`${h.probe.origin}/mcp`),{requestInit:{headers:{authorization:`Bearer ${token}`}}}));
    clients.push(client);return client;
  }
  t.after(async()=>{for(const client of clients)await client.close();});
  const a=await connect(),b=await connect();
  const state=(await a.callTool({name:'probe_get_state',arguments:{}})).structuredContent;
  const c=(await a.callTool({name:'probe_prepare_label',arguments:proposal(state)})).structuredContent;
  const {session_id,...exact}=approvalArgs(c);
  const approved=await h.post('/approve',exact,browser);assert.equal(approved.status,200);
  const grant=(await a.callTool({name:'probe_get_candidate',arguments:{session_id:state.session_id,candidate_id:c.candidate_id}})).structuredContent.approval;
  assert.ok(grant);assert.ok(!(await approved.text()).includes(grant.approval_ref));
  const args=commitArgs(c,grant),[one,two]=await Promise.all([a.callTool({name:'probe_commit_label',arguments:args}),b.callTool({name:'probe_commit_label',arguments:args})]);
  assert.ok(!one.isError&&!two.isError);assert.deepEqual(one.structuredContent,two.structuredContent);
  await a.close();const fresh=await connect();
  assert.deepEqual((await fresh.callTool({name:'probe_commit_label',arguments:args})).structuredContent,one.structuredContent);
  assert.equal((await fresh.callTool({name:'probe_get_state',arguments:{}})).structuredContent.revision,1);
  assert.equal(h.probe.store.state(owner).revision,1);
});
