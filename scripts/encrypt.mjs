import { webcrypto as crypto } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
const keyIndex = argv.indexOf('--key');
const keyArg = keyIndex >= 0 ? argv[keyIndex + 1] : null;
const positional = argv.filter((arg, index) => !arg.startsWith('--') && index !== keyIndex + 1);
const input = positional[0];
const output = positional[1] || 'data.json';

if (!input) {
  console.error('用法: node scripts/encrypt.mjs <schedule.json> [data.json] [--key <base64url>]');
  process.exit(1);
}

const schedule = readFileSync(resolve(input), 'utf8');
const key = keyArg
  ? Buffer.from(keyArg.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((keyArg.length + 3) % 4), 'base64')
  : crypto.getRandomValues(new Uint8Array(32));

if (key.length !== 32) {
  console.error('密钥必须是 32 字节的 base64url 字符串');
  process.exit(1);
}

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
