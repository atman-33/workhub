// persona-compress — pre-flight check for a file the model is about to compress.
//
// Derived from genshijin (MIT, InterfaceX-co-jp)
// https://github.com/InterfaceX-co-jp/genshijin
//
//   node detect.mjs <file>
//
// Exits non-zero and prints a reason when the file must not be compressed.
// Refusal is deterministic and lives here rather than in the skill prose so a
// secret cannot be talked past by a persuasive prompt.

import fs from 'node:fs';
import path from 'node:path';

const COMPRESSIBLE_EXTENSIONS = new Set(['.md', '.txt', '.markdown', '']);

// Never compress: compressing means reading the whole file into the model's
// context, so these must be refused before anything is read.
const SECRET_BASENAMES = [
  /^\.env(\..*)?$/i,
  /^\.netrc$/i,
  /^credentials(\..*)?$/i,
  /^secrets?(\..*)?$/i,
  /^passwords?(\..*)?$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
];
const SECRET_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx', '.crt', '.cer', '.jks']);
const SECRET_NAME_PARTS = /(secret|credential|password|passwd|apikey|api_key|token|privatekey|private_key)/i;
const SECRET_DIRECTORIES = new Set(['.ssh', '.aws', '.gnupg', '.kube', '.docker']);

function fail(message) {
  process.stdout.write(`REFUSE: ${message}\n`);
  process.exit(1);
}

const target = process.argv[2];
if (!target) fail('ファイルパスが指定されていません。');

const resolved = path.resolve(target);
const base = path.basename(resolved);
const ext = path.extname(resolved).toLowerCase();

for (const segment of resolved.split(/[\\/]/)) {
  if (SECRET_DIRECTORIES.has(segment.toLowerCase())) {
    fail(`機密ディレクトリ配下のファイルです (${segment})。圧縮しません。`);
  }
}
if (SECRET_BASENAMES.some((re) => re.test(base))) fail(`機密ファイル名です (${base})。圧縮しません。`);
if (SECRET_EXTENSIONS.has(ext)) fail(`証明書・鍵ファイルです (${ext})。圧縮しません。`);
if (SECRET_NAME_PARTS.test(base)) {
  fail(`ファイル名に機密を示す語が含まれます (${base})。圧縮しません。誤検知なら名前を変えてください。`);
}
if (base.endsWith('.original.md')) fail('バックアップファイルです。圧縮しません。');

let stat;
try {
  stat = fs.statSync(resolved);
} catch {
  fail(`ファイルが見つかりません: ${resolved}`);
}
if (!stat.isFile()) fail('通常ファイルではありません。');
if (stat.size === 0) fail('空ファイルです。');
if (stat.size > 1024 * 1024) fail('1MB を超えるファイルです。分割してください。');

if (!COMPRESSIBLE_EXTENSIONS.has(ext)) {
  fail(`自然言語ファイルではありません (${ext || '拡張子なし'})。対象は .md / .txt / 拡張子なしのみ。`);
}

const backup = resolved.replace(/\.md$/i, '') + '.original.md';
const text = fs.readFileSync(resolved, 'utf8');
const fenced = (text.match(/^```/gm) || []).length;

process.stdout.write(JSON.stringify({
  ok: true,
  file: resolved,
  backup,
  backupExists: fs.existsSync(backup),
  bytes: stat.size,
  lines: text.split('\n').length,
  fencedBlockDelimiters: fenced,
}, null, 2) + '\n');
