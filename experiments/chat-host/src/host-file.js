import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { requireThat, ProbeError } from './model.js';

// Opt-in only. Configuration is not sufficient proof of host file ownership:
// each live file must additionally have a browser-confirmed import intent.
export function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a,b] = address.split('.').map(Number);
    return a !== 0 && a !== 10 && a !== 127 && a < 224 && !(a === 169 && b === 254)
      && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && (b === 168 || b === 0))
      && !(a === 100 && b >= 64 && b <= 127) && a !== 198 && a !== 203;
  }
  // Probe deliberately refuses IPv6 instead of implementing a partial classifier.
  return false;
}
export async function fetchHostFile(file, origins, limits, { resolve = lookup } = {}) {
  const url = new URL(file.download_url);
  requireThat(url.protocol === 'https:' && !url.username && !url.password && !url.hash
    && origins.includes(url.origin) && !isIP(url.hostname), 'FILE_ORIGIN_DENIED', 403);
  let dnsTimer, addresses;
  try {
    addresses = await Promise.race([resolve(url.hostname, { all: true, family: 4 }),
      new Promise((_, reject) => { dnsTimer = setTimeout(() => reject(new ProbeError('FILE_TIMEOUT', 408)), limits.uploadMs); })]);
  } finally { clearTimeout(dnsTimer); }
  requireThat(addresses.length > 0 && addresses.every(x => publicAddress(x.address)), 'FILE_ORIGIN_DENIED', 403);
  // Pin the vetted address to this connection to prevent DNS rebinding.
  return new Promise((resolveBytes, reject) => {
    const req = request(url, { method: 'GET', family: 4,
      lookup: (_host, options, done) => options.all ? done(null, [addresses[0]]) : done(null, addresses[0].address, 4) }, res => {
      if (res.statusCode !== 200) { res.resume(); reject(new ProbeError('FILE_FETCH_REJECTED', 502)); return; }
      const chunks = []; let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > limits.uploadBytes) { req.destroy(new ProbeError('UPLOAD_TOO_LARGE', 413)); return; }
        chunks.push(chunk);
      });
      res.on('end', () => resolveBytes(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    const timer = setTimeout(() => req.destroy(new ProbeError('FILE_TIMEOUT', 408)), limits.uploadMs);
    req.on('close', () => clearTimeout(timer)); req.on('error', reject); req.end();
  });
}
