import { readFileSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createAuth } from './auth.js';
import { createProbe } from './service.js';
import { requireThat } from './model.js';

try {
  requireThat(/^24\.13\./.test(process.versions.node), 'NODE_24_13_REQUIRED');
  requireThat(process.env.PROBE_AUTH_CONFIG && process.env.PROBE_DATA_DIR, 'EXPLICIT_AUTH_CONFIG_AND_DATA_DIR_REQUIRED');
  requireThat(!Object.keys(process.env).some(k => /^PROBE_(TEST|MOCK|BYPASS)/.test(k)), 'TEST_FACILITIES_FORBIDDEN');
  const directory = resolve(process.env.PROBE_DATA_DIR);
  const root = realpathSync(fileURLToPath(new URL('../../../',import.meta.url)));
  mkdirSync(directory,{recursive:true,mode:0o700});
  const actual = realpathSync(directory), rel = relative(root,actual);
  requireThat(rel.startsWith('..') || isAbsolute(rel), 'DATA_DIR_MUST_BE_OUTSIDE_REPOSITORY');
  if(process.platform !== 'win32') requireThat((statSync(actual).mode & 0o077) === 0,'PRIVATE_DATA_DIR_REQUIRED');
  else {
    // Inspect only the explicitly selected storage directory. Never alter ACLs.
    const acl=execFileSync('icacls.exe',[actual],{encoding:'utf8',timeout:5000});
    requireThat(!/(Everyone|Authenticated Users|BUILTIN\\Users|S-1-1-0|S-1-5-11|S-1-5-32-545):/i.test(acl),'PRIVATE_DATA_DIR_REQUIRED');
    // The CLI is a local experiment, not a multi-user Windows storage service.
  }
  const config = JSON.parse(readFileSync(process.env.PROBE_AUTH_CONFIG,'utf8'));
  const auth = createAuth(config);
  const port = Number(process.env.PROBE_PORT || 3213);
  requireThat(Number.isInteger(port) && port >= 1024 && port <= 65535,'INVALID_PORT');
  const probe = await createProbe({ directory:actual,auth,port,publicOrigin:auth.origin });
  // Local binding only; no tunneling, proxy setup, or integration installation.
  console.log(JSON.stringify({status:'LISTENING_LOCAL_ONLY',port,version:'0.1.0',host_import:'BLOCKED'}));
  let stopping=false;
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{if(stopping)return;stopping=true;await probe.close();process.exitCode=0;});
} catch(error) {
  console.error(JSON.stringify({status:error.code || 'STARTUP_FAILED'})); process.exitCode=2;
}
