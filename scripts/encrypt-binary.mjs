import { webcrypto as crypto } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const input = process.argv[2];
const output = process.argv[3] || 'file.enc.json';
const keyIndex = process.argv.indexOf('--key');
const keyArg = keyIndex >= 0 ? process.argv[keyIndex + 1] : null;

if (!input || !keyArg) {
  console.error('用法: node scripts/encrypt-binary.mjs <文件> <输出.json> --key <base64url>');
  process.exit(1);
}

const key = Buffer.from(keyArg.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((keyArg.length + 3) % 4), 'base64');
if (key.length !== 32) {
  console.error('密钥必须是 32 字节的 base64url 字符串');
  process.exit(1);
}

const data = readFileSync(resolve(input));
const iv = crypto.getRandomValues(new Uint8Array(12));
const imported = await crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['encrypt']);
const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, imported, data));
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');

writeFileSync(resolve(output), JSON.stringify({
  v: 1,
  alg: 'A256GCM',
  iv: b64url(iv),
  data: b64url(encrypted)
}, null, 2));

console.log(`encrypted=${input} bytes=${data.length}`);
