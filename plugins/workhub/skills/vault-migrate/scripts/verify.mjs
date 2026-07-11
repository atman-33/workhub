// Verify a copy-only Obsidian vault migration.
//
// Checks, given a source vault, a destination vault, and the mapping used to
// copy between them:
//
//   1. missing    - mapped source files with no file at the destination path
//   2. mismatch   - destination file exists but differs in size (cp -n collision)
//   3. link delta - wikilink targets broken in the destination that were not
//                   already broken in the source
//
// Exit code 0 iff all three counters are zero.
//
// Usage:
//   node verify.mjs --mapping mapping.json SOURCE_VAULT DEST_VAULT
//
// mapping.json is a list of {"src": <dir relative to source vault>,
// "dst": <dir relative to dest vault>} entries, in the order they were copied.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, basename, extname } from "node:path";

const EXCLUDED_DIRS = new Set([".obsidian", ".claude", ".opencode", ".git", "node_modules"]);
const WIKILINK = /\[\[([^\]|#^]+?)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g;

function* walk(root) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) yield* walk(path);
    } else if (entry.isFile()) {
      yield path;
    }
  }
}

/** All basenames a wikilink can resolve to in this vault. */
function linkNames(root) {
  const names = new Set();
  for (const path of walk(root)) {
    const f = basename(path);
    names.add(f.toLowerCase());
    const ext = extname(f);
    if (ext === ".md" || ext === ".canvas") {
      names.add(f.slice(0, -ext.length).toLowerCase());
    }
  }
  return names;
}

function brokenTargets(root) {
  const names = linkNames(root);
  const broken = new Map();
  for (const path of walk(root)) {
    if (!path.endsWith(".md")) continue;
    let text;
    try {
      text = readFileSync(path, "utf-8");
    } catch {
      continue;
    }
    for (const m of text.matchAll(WIKILINK)) {
      const target = m[1].trim();
      const base = target.split("/").pop().toLowerCase();
      if (base && !names.has(base) && !names.has(base + ".md")) {
        if (!broken.has(target)) broken.set(target, []);
        broken.get(target).push(relative(root, path));
      }
    }
  }
  return broken;
}

// --- argument parsing ---
const args = process.argv.slice(2);
const mi = args.indexOf("--mapping");
if (mi === -1 || args.length !== 4) {
  console.error("usage: node verify.mjs --mapping mapping.json SOURCE_VAULT DEST_VAULT");
  process.exit(2);
}
const mappingPath = args[mi + 1];
const [source, dest] = args.filter((_, i) => i !== mi && i !== mi + 1);

const mapping = JSON.parse(readFileSync(mappingPath, "utf-8"));

const missing = [];
const mismatch = [];
for (const { src, dst } of mapping) {
  const srcPath = join(source, src);
  const dstPath = join(dest, dst);
  const pairs = statSync(srcPath).isFile()
    ? [[srcPath, dstPath]]
    : [...walk(srcPath)].map((s) => [s, join(dstPath, relative(srcPath, s))]);
  for (const [s, d] of pairs) {
    if (!existsSync(d)) missing.push(d);
    else if (statSync(s).size !== statSync(d).size) mismatch.push([s, d]);
  }
}

const srcBroken = brokenTargets(source);
const dstBroken = brokenTargets(dest);
const delta = new Map([...dstBroken].filter(([t]) => !srcBroken.has(t)));
const carried = [...dstBroken.keys()].filter((t) => srcBroken.has(t));

console.log(`missing: ${missing.length}`);
for (const m of missing.slice(0, 20)) console.log(`  ${m}`);
console.log(`mismatch (collision, source not copied): ${mismatch.length}`);
for (const [s, d] of mismatch.slice(0, 20)) console.log(`  ${s} -> ${d}`);
console.log(`link delta (broken in dest, not in source): ${delta.size}`);
for (const [t, srcs] of [...delta].sort().slice(0, 20)) console.log(`  [[${t}]]  <- ${srcs[0]}`);
console.log(`pre-existing broken links carried over: ${carried.length}`);

const ok = missing.length === 0 && mismatch.length === 0 && delta.size === 0;
console.log("RESULT:", ok ? "OK (delta-zero)" : "FAILED");
process.exit(ok ? 0 : 1);
