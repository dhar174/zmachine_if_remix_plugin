import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { ProbeStore } from '../src/store.js';
import { LIMITS, FIXTURE_SHA, id, schemas, parse } from '../src/model.js';
import { temporary,removeTemporary,owner,other,proposal,commitArgs,approvalArgs,fixture } from './helpers.js';

function local(t) {
  const dir=temporary();let now=1800000000000;
  let store=new ProbeStore(dir,[owner,other],{clock:()=>now});
  t.after(()=>{store.close();removeTemporary(dir);});
  return {get s(){return store;},advance:ms=>{now+=ms;},restart:()=>{store.close();store=new ProbeStore(dir,[owner,other],{clock:()=>now});}};
}
const fails=(fn,code)=>assert.throws(fn,error=>error.code===code);
test('immutable proposal, exact commit, identical retry, separate inverse approval',t=>{
  const {s}=local(t),state=s.state(owner),args=proposal(state),c=s.prepare(owner,args);
  assert.deepEqual(s.prepare(owner,args),c);assert.equal(s.state(owner).revision,0);
  assert.deepEqual(c.diff,{before:'Probe Chamber',after:'Renamed Chamber'});
  fails(()=>s.prepare(owner,{...args,room_label:'Other'}),'IDEMPOTENCY_CONFLICT');
  const request=commitArgs(c,{approval_ref:id()});fails(()=>s.commit(owner,request),'NEEDS_APPROVAL');
  const grant=s.approve(owner,approvalArgs(c));request.approval_ref=grant.approval_ref;
  const receipt=s.commit(owner,request);assert.equal(receipt.revision,1);
  assert.deepEqual(s.commit(owner,request),receipt);
  fails(()=>s.commit(owner,{...request,digest:'0'.repeat(64)}),'IDEMPOTENCY_CONFLICT');
  fails(()=>s.commit(owner,{...request,request_id:id()}),'NEEDS_APPROVAL');
  const inverse=s.prepare(owner,proposal(s.state(owner),'Probe Chamber'));
  fails(()=>s.commit(owner,commitArgs(inverse,grant)),'NEEDS_APPROVAL');
  s.commit(owner,commitArgs(inverse,s.approve(owner,approvalArgs(inverse))));
  assert.deepEqual(s.state(owner),{...state,revision:2});
});
test('owner/session/digest/revision substitution, stale candidates and revocation preserve state',t=>{
  const {s}=local(t),state=s.state(owner),c=s.prepare(owner,proposal(state));
  fails(()=>s.candidate(other,state.session_id,c.candidate_id),'NOT_FOUND');
  fails(()=>s.candidate(owner,s.state(other).session_id,c.candidate_id),'NOT_FOUND');
  fails(()=>s.approve(owner,{...approvalArgs(c),digest:'f'.repeat(64)}),'CANDIDATE_MISMATCH');
  const g=s.approve(owner,approvalArgs(c));
  fails(()=>s.commit(owner,{...commitArgs(c,g),digest:'e'.repeat(64)}),'CANDIDATE_MISMATCH');
  fails(()=>s.commit(owner,{...commitArgs(c,g),expected_revision:1}),'CANDIDATE_MISMATCH');
  s.revoke(owner,state.session_id,c.candidate_id);fails(()=>s.commit(owner,commitArgs(c,g)),'NEEDS_APPROVAL');
  const stale=s.prepare(owner,proposal(state,'Stale Chamber')),sg=s.approve(owner,approvalArgs(stale));
  s.commit(owner,commitArgs(c,s.approve(owner,approvalArgs(c))));
  fails(()=>s.commit(owner,commitArgs(stale,sg)),'STALE_REVISION');
  assert.equal(s.state(owner).room_label,'Renamed Chamber');assert.equal(s.state(owner).revision,1);
});
test('expiry boundaries, candidate quota, no-op and 64-character labels',t=>{
  const f=local(t),s=f.s,state=s.state(owner),c=s.prepare(owner,proposal(state)),g=s.approve(owner,approvalArgs(c));
  f.advance(LIMITS.grantMs);fails(()=>s.commit(owner,commitArgs(c,g)),'NEEDS_APPROVAL');
  f.advance(LIMITS.candidateMs-LIMITS.grantMs);fails(()=>s.candidate(owner,state.session_id,c.candidate_id),'NOT_FOUND');
  fails(()=>s.prepare(owner,proposal(state,'Probe Chamber')),'NO_CHANGE');
  for(let i=0;i<LIMITS.candidates;i++)s.prepare(owner,proposal(state,`Room ${i}`));
  fails(()=>s.prepare(owner,proposal(state,'Overflow')),'CANDIDATE_LIMIT');
  assert.equal(s.state(owner).revision,0);
  parse(schemas.probe_prepare_label,proposal(state,'A'.repeat(64)));
  for(const label of ['A'.repeat(65),'/edit approve','<script>','eval(1)','']) fails(()=>parse(schemas.probe_prepare_label,proposal(state,label)),'BAD_SCHEMA');
});
test('restart retains receipts and real bytes but invalidates candidates and grants',t=>{
  const f=local(t),state=f.s.state(owner),c=f.s.prepare(owner,proposal(state)),args=commitArgs(c,f.s.approve(owner,approvalArgs(c)));
  const receipt=f.s.commit(owner,args),pending=f.s.prepare(owner,proposal(f.s.state(owner),'Pending'));
  const pg=f.s.approve(owner,approvalArgs(pending));const imported=f.s.importBytes(owner,state.session_id,fixture);
  f.restart();assert.deepEqual(f.s.commit(owner,args),receipt);assert.equal(f.s.state(owner).revision,1);
  fails(()=>f.s.commit(owner,commitArgs(pending,pg)),'NOT_FOUND');
  assert.equal(f.s.inspectImport(owner,state.session_id,imported.import_handle).sha256,FIXTURE_SHA);
  const bytes=f.s.db.prepare('SELECT bytes FROM imports WHERE id=?').get(imported.import_handle).bytes;
  assert.deepEqual(Buffer.from(bytes),fixture);
  f.advance(LIMITS.importMs);f.restart();fails(()=>f.s.inspectImport(owner,state.session_id,imported.import_handle),'NOT_FOUND');
  assert.equal(f.s.db.prepare('SELECT COUNT(*) AS n FROM imports').get().n,0);
});
test('import bytes, ownership, quotas, expiry, deletion and malformed fixtures',t=>{
  const f=local(t),s=f.s,session=s.state(owner).session_id;
  const imported=s.importBytes(owner,session,fixture);assert.equal(imported.size,88576);assert.equal(imported.sha256,FIXTURE_SHA);
  fails(()=>s.inspectImport(other,session,imported.import_handle),'NOT_FOUND');
  fails(()=>s.importBytes(owner,session,Buffer.alloc(LIMITS.uploadBytes+1)),'UPLOAD_TOO_LARGE');
  for(const bytes of [Buffer.alloc(0),fixture.subarray(0,63),fixture.subarray(0,-1),Buffer.from('some text')])fails(()=>s.importBytes(owner,session,bytes),'INVALID_STORY');
  const disallowed=Buffer.from(fixture);disallowed[100]^=1;fails(()=>s.importBytes(owner,session,disallowed),'DISALLOWED_FIXTURE');
  s.importBytes(owner,session,fixture);fails(()=>s.importBytes(owner,session,fixture),'IMPORT_LIMIT');
  s.deleteImport(owner,session,imported.import_handle);fails(()=>s.inspectImport(owner,session,imported.import_handle),'NOT_FOUND');
  f.advance(LIMITS.importMs);s.cleanup();assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM imports').get().n,0);
  assert.equal(s.state(owner).revision,0);
});
test('rollback when durable receipt insertion fails leaves state and grant intact',t=>{
  const {s}=local(t),c=s.prepare(owner,proposal(s.state(owner))),g=s.approve(owner,approvalArgs(c)),args=commitArgs(c,g);
  s.db.exec("CREATE TRIGGER reject_receipt BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT, 'injected'); END;");
  assert.throws(()=>s.commit(owner,args),/injected/);assert.equal(s.state(owner).revision,0);
  s.db.exec('DROP TRIGGER reject_receipt');assert.equal(s.commit(owner,args).revision,1);
});
test('fresh process recovers exact receipt after injected post-commit exit 73 and rejects old authority',t=>{
  const directory=temporary();t.after(()=>removeTemporary(directory));
  // Test-only process startup/recovery budget; transport deadlines are unchanged.
  const first=spawnSync(process.execPath,['test/restart-child.js'],{input:JSON.stringify({directory,phase:'commit-and-crash'}),encoding:'utf8',timeout:15000});
  assert.equal(first.status,73,JSON.stringify({error:first.error?.code,signal:first.signal,stderr:first.stderr}));const previous=JSON.parse(first.stdout);
  const second=spawnSync(process.execPath,['test/restart-child.js'],{input:JSON.stringify({directory,phase:'recover',previous}),encoding:'utf8',timeout:15000});
  assert.equal(second.status,0,JSON.stringify({error:second.error?.code,signal:second.signal,stderr:second.stderr}));const recovered=JSON.parse(second.stdout);
  assert.deepEqual(recovered.receipt,previous.receipt);assert.equal(recovered.state.revision,1);
  assert.equal(recovered.pendingStatus,'NOT_FOUND');assert.deepEqual(recovered.imported,previous.imported);
});

test('receipt lookup recovers a historical commit without consumed approval, after expiry and restart',t=>{
  const f=local(t),state=f.s.state(owner),candidate=f.s.prepare(owner,proposal(state));
  const args=commitArgs(candidate,f.s.approve(owner,approvalArgs(candidate)));
  fails(()=>f.s.receipt(owner,state.session_id,args.request_id),'NOT_FOUND');
  const committed=f.s.commit(owner,args);
  assert.equal(f.s.approval(owner,state.session_id,candidate.candidate_id),null);
  assert.deepEqual(f.s.receipt(owner,state.session_id,args.request_id),committed);
  assert.equal(f.s.grants.size,0);
  f.advance(LIMITS.candidateMs);f.restart();
  assert.deepEqual(f.s.receipt(owner,state.session_id,args.request_id),committed);
  const inverse=f.s.prepare(owner,proposal(f.s.state(owner),'Probe Chamber'));
  f.s.commit(owner,commitArgs(inverse,f.s.approve(owner,approvalArgs(inverse))));
  assert.deepEqual(f.s.receipt(owner,state.session_id,args.request_id),committed);
  assert.equal(committed.revision,1);assert.equal(f.s.state(owner).revision,2);
  assert.equal(f.s.db.prepare('SELECT COUNT(*) AS n FROM receipts').get().n,2);
});

test('receipt lookup denies foreign owner/session and missing handles without revealing authority',t=>{
  const {s}=local(t),state=s.state(owner),candidate=s.prepare(owner,proposal(state));
  const grant=s.approve(owner,approvalArgs(candidate)),args=commitArgs(candidate,grant);
  const committed=s.commit(owner,args),foreign=s.state(other);
  for(const [principal,session,request] of [[other,state.session_id,args.request_id],
    [other,foreign.session_id,args.request_id],[owner,foreign.session_id,args.request_id],
    [owner,state.session_id,id()]])fails(()=>s.receipt(principal,session,request),'NOT_FOUND');
  const result=s.receipt(owner,state.session_id,args.request_id);
  assert.deepEqual(result,committed);
  for(const field of ['approval_ref','payload','owner','request'])assert.ok(!Object.hasOwn(result,field));
  assert.ok(!JSON.stringify(result).includes(grant.approval_ref));
  assert.equal(s.grants.size,0);assert.equal(s.state(owner).revision,1);
});
