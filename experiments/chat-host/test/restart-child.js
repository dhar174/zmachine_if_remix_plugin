// Test-only subprocess: no network listener, external identity or live-mode import.
import { readFileSync,writeSync } from 'node:fs';
import { ProbeStore } from '../src/store.js';
import { owner,other,proposal,approvalArgs,commitArgs,fixture } from './probe-data.js';
const input=JSON.parse(readFileSync(0,'utf8'));
const store=new ProbeStore(input.directory,[owner,other]);
if(input.phase==='commit-and-crash') {
  const c=store.prepare(owner,proposal(store.state(owner)));
  const args=commitArgs(c,store.approve(owner,approvalArgs(c))),receipt=store.commit(owner,args);
  const pending=store.prepare(owner,proposal(store.state(owner),'Pending'));
  const grant=store.approve(owner,approvalArgs(pending));
  const imported=store.importBytes(owner,c.session_id,fixture);
  writeSync(1,JSON.stringify({args,receipt,pending,grant,imported}));
  // Inject termination without close(), after durable publication and before an
  // imagined tool response. Parent classifies this exact exit as an injected crash.
  process.exit(73);
}
const receipt=store.commit(owner,input.previous.args);
let pendingStatus;
try {store.commit(owner,commitArgs(input.previous.pending,input.previous.grant));pendingStatus='UNEXPECTED_COMMIT';}
catch(error){pendingStatus=error.code;}
const imported=store.inspectImport(owner,receipt.session_id,input.previous.imported.import_handle);
writeSync(1,JSON.stringify({receipt,pendingStatus,imported,state:store.state(owner)}));store.close();
