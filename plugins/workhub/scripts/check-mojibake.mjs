#!/usr/bin/env node
// Report vault text files that look garbled by an encoding round trip.
// Read-only: it never rewrites a file.
//
//   node check-mojibake.mjs [--vault <dir>] [--json]
//
// Three signals, each reported by name:
//   INVALID_UTF8   the bytes are not valid UTF-8 (typically CP932 written back)
//   REPLACEMENT    the text holds U+FFFD
//   MOJIBAKE       halfwidth katakana, or the CP932-misread kanji (繧 繝 縺 ...),
//                  make up an implausible share of the characters
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const EXTS = new Set([".md", ".json", ".yml", ".yaml", ".txt", ".canvas", ".base"]);
// Snapshots and tool output that are not notes and garble on their own.
const EXCLUDED = [/^\.playwright-mcp\//, /^node_modules\//, /(^|\/)\.git\//];
// Halfwidth katakana (U+FF61-U+FF9F) and the kanji UTF-8 Japanese turns into
// when it is read as CP932 and saved again.
const HALFWIDTH = /[｡-ﾟ]/g;
const MISREAD = /[繧繝縺邵郢蜿莉]/g;
const MIN_HITS = 20; // fewer suspicious characters than this is never reported
const MAX_RATIO = 0.05; // suspicious share of all characters

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const vault = resolve(args[args.indexOf("--vault") + 1] ?? ".");
if (args.includes("--vault") && !args[args.indexOf("--vault") + 1]) {
  console.error("--vault needs a path");
  process.exit(2);
}

const files = execFileSync("git", ["-C", vault, "ls-files", "-z"], {
  maxBuffer: 1 << 28,
})
  .toString("utf8")
  .split("\0")
  .filter((f) => f && EXTS.has(extname(f).toLowerCase()))
  .filter((f) => !EXCLUDED.some((re) => re.test(f)));

const strict = new TextDecoder("utf-8", { fatal: true });
const findings = [];
for (const rel of files) {
  let buf;
  try {
    buf = readFileSync(join(vault, rel));
  } catch {
    continue; // listed by git but absent from the working tree
  }
  let text;
  try {
    text = strict.decode(buf);
  } catch {
    const asSjis = new TextDecoder("shift_jis").decode(buf);
    findings.push({ file: rel, kind: "INVALID_UTF8", detail: `${(asSjis.match(HALFWIDTH) ?? []).length} halfwidth katakana when read as Shift_JIS` });
    continue;
  }
  if (text.includes("�")) {
    findings.push({ file: rel, kind: "REPLACEMENT", detail: `${text.split("�").length - 1} U+FFFD` });
    continue;
  }
  const total = [...text].length || 1;
  const half = (text.match(HALFWIDTH) ?? []).length;
  const mis = (text.match(MISREAD) ?? []).length;
  const hits = Math.max(half, mis);
  if (hits >= MIN_HITS && hits / total > MAX_RATIO) {
    findings.push({
      file: rel,
      kind: "MOJIBAKE",
      detail: `${half} halfwidth katakana, ${mis} CP932-misread kanji of ${total} chars (${((hits / total) * 100).toFixed(1)}%)`,
    });
  }
}

if (flag("--json")) {
  console.log(JSON.stringify({ scanned: files.length, findings }, null, 2));
} else {
  console.log(`scanned ${files.length} files, ${findings.length} suspect`);
  for (const f of findings) console.log(`${f.kind}\t${f.file}\t${f.detail}`);
}
process.exit(findings.length ? 1 : 0);
