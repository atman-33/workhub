// persona-compress — verifies a compressed file against its backup.
//
// Derived from genshijin (MIT, InterfaceX-co-jp)
// https://github.com/InterfaceX-co-jp/genshijin
//
//   node validate.mjs <original.md> <compressed.md>
//
// Compression is done by the model; this script is the deterministic guard on
// the result. It never rewrites anything — it reports what was lost so the
// caller can restore the backup or fix the specific spot.
//
// Exit codes: 0 = clean, 1 = protected content lost, 2 = usage error.

import fs from 'node:fs';

function read(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    process.stdout.write(`ERROR: 読み込めません: ${file}\n`);
    process.exit(2);
  }
}

const [originalPath, compressedPath] = process.argv.slice(2);
if (!originalPath || !compressedPath) {
  process.stdout.write('usage: node validate.mjs <original.md> <compressed.md>\n');
  process.exit(2);
}

const original = read(originalPath);
const compressed = read(compressedPath);

// Every one of these must survive compression byte-for-byte. Multiset
// comparison, so reordering is caught as well as deletion.
const EXTRACTORS = [
  ['コードブロック', /```[\s\S]*?```/g],
  ['インラインコード', /`[^`\n]+`/g],
  ['URL', /https?:\/\/[^\s)>\]]+/g],
  ['見出し', /^#{1,6}\s+.*$/gm],
  ['数値・バージョン', /\b\d+(?:\.\d+)+\b/g],
  ['環境変数', /\$\{?[A-Z][A-Z0-9_]*\}?/g],
];

function multiset(text, pattern) {
  const counts = new Map();
  for (const match of text.match(pattern) || []) {
    counts.set(match, (counts.get(match) || 0) + 1);
  }
  return counts;
}

const problems = [];
for (const [label, pattern] of EXTRACTORS) {
  const before = multiset(original, pattern);
  const after = multiset(compressed, pattern);
  for (const [value, count] of before) {
    const remaining = after.get(value) || 0;
    if (remaining < count) {
      const preview = value.length > 70 ? `${value.slice(0, 67)}...` : value;
      problems.push(`${label}: 欠落または改変 (${count}→${remaining})  ${preview.replace(/\n/g, ' ')}`);
    }
  }
}

// A compressed file that got longer means the pass did not do its job.
const beforeBytes = Buffer.byteLength(original, 'utf8');
const afterBytes = Buffer.byteLength(compressed, 'utf8');

const summary = [
  `original   ${beforeBytes} bytes`,
  `compressed ${afterBytes} bytes`,
  `削減       ${beforeBytes > 0 ? Math.round((1 - afterBytes / beforeBytes) * 1000) / 10 : 0}%`,
];

if (problems.length) {
  process.stdout.write(
    `FAIL: 保護対象が失われています (${problems.length} 件)\n\n` +
    problems.slice(0, 40).map((p) => `  - ${p}`).join('\n') +
    (problems.length > 40 ? `\n  ... 他 ${problems.length - 40} 件` : '') +
    `\n\n${summary.join('\n')}\n`
  );
  process.exit(1);
}

if (afterBytes >= beforeBytes) {
  process.stdout.write(`WARN: 圧縮されていません。\n\n${summary.join('\n')}\n`);
  process.exit(0);
}

process.stdout.write(`OK: 保護対象はすべて維持されています。\n\n${summary.join('\n')}\n`);
