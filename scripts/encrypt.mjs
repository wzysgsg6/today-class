import { webcrypto as crypto } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const input = process.argv[2];
const output = process.argv[3] || 'data.json';

if (!input) {
  console.error('用法: node scripts/encrypt.mjs <schedule.json> [data.json]');
  process.exit(1);
}

const schedule = readFileSync(resolve(input), 'utf8');
const key = crypto.getRandomValues(new Uint8Array(32));
const iv = crypto.getRandomValues(new Uint8Array(12));
const imported = await crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['encrypt']);
const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, imported, new TextEncoder().encode(schedule)));
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');

writeFileSync(resolve(output), JSON.stringify({
  v: 1,
  alg: 'A256GCM',
  iv: b64url(iv),
  data: b64url(encrypted)
}, null, 2));

console.log(`key=${b64url(key)}`);
