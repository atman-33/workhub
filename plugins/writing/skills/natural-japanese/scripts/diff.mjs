#!/usr/bin/env node
// diff — compare an original passage with its rewrite and list the places where
// meaning is most likely to have moved.
//
// It looks for four things:
//   1. a change in how many phrases of a given kind appear (request, duty,
//      evaluation, possibility, hedging, emphasis, intention, condition, ...)
//   2. content words the rewrite added, and ones it lost
//   3. a list turned into prose, merged paragraphs, a changed sentence count
//   4. places in the rewrite whose connection to its neighbours should be checked
//      (a sentence-initial connective, a topic "も", a bare announcement, a
//      sentence-initial demonstrative)
//
// It does not judge. Whether a candidate is a legitimate rewording or a drift
// is for whoever reads the output. Without Node the same four checks can be
// done by eye.
//
// Usage:
//   node diff.mjs <original> <rewrite> [--json]
//
// Derived from the diff idea in nanaism/yomiyasu (MIT), rewritten for this
// repository; see plugins/writing/NOTICE.md.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// What a sentence is doing. A count that rises or falls is a candidate.
const MARKERS = {
  依頼: /(?:て|で)ください/g,
  勧誘: /ましょう/g,
  義務: /なければ(?:なりません|ならない)|なくては(?:なりません|ならない)|ねばならない|必要があ(?:ります|る)|べき/g,
  評価: /大切|重要|大事|不可欠|欠かせ|肝心|肝要/g,
  可能:
    /でき(?:ます|る|ません|ない)|(?<![しさ])(?:ら|れ)(?:ます|ません)(?=[。、がけし]|$)|(?<=[作使書読言防守残伝送続進])(?:れ|え|け|め|せ)(?:ます|る)(?=[。、がけし]|$)/g,
  推量: /でしょう|だろう|かもしれ|はず|と思(?:います|う)|ようです|らしい|おそれ|たいところ/g,
  念押し: /のです|んです|こそ|まさに|必ず|絶対|常に/g,
  意志: /(?:に|ように|ことに)し(?:ます|ている|ています)/g,
  条件: /(?<!例)(?<!たと)(?:れ|え|け|せ|て|ね|め|べ)ば(?![かり])|なら(?=[、。]|$|\s)|たら(?=[、。]|$|\s)|場合/g,
  説明化: /ことが挙げられ|ということ|ことです|ことになります/g,
  つなぎ: /まず|また(?!は)|そして|さらに|次に|最後に|ただし|しかし|つまり|そのため|ので(?!す)|によって|ことで|ことにより/g,
};

const CONTENT = /[一-龥々〆ヵヶ]{2,}|[ァ-ヴー]{2,}|[A-Za-z][A-Za-z0-9_.+#/-]+/g;
const LIST_MARK = /^\s*(?:[*\-・]|\d+[.)])\s+/;

const LOGIC = [
  ["文頭のつなぎ", /^(?:ただし|しかし|一方|また|さらに|つまり|そのため|したがって|だから|それでも|なお|そこで|ところが)/],
  ["主題の「も」", /^(?!それで)[^、。]{0,17}[^、。てでり]も、/],
  ["予告だけの文", /^.{0,28}(?:が|も)あります。$|次の(?:点|こと|とおり|通り)です|以下の(?:点|こと|とおり|通り)/],
  ["文頭の指示語", /^(?:これ|それ(?!でも|から)|こう(?:した|して|する|いう)|そう(?:した|して|する|いう)|この|その)(?!して)/],
];

const normalize = (t) =>
  t
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^\s*(?:[*\-・]|\d+[.)])\s+/gm, "")
    .replace(/^#+\s*/gm, "")
    .replace(/[ \t]+/g, " ")
    .trim();

const hasList = (t) => /^\s*(?:[*\-・]|\d+[.)])\s+\S/m.test(t);
const sentences = (t) => t.split(/(?<=[。！？!?])|\n+/).filter((s) => s.trim());

/** Paragraph count, with a run of list items counted as one block. */
function paragraphs(t) {
  let blocks = 0;
  let prevList = false;
  for (const line of t.split("\n")) {
    if (!line.trim()) {
      prevList = false;
      continue;
    }
    const isList = LIST_MARK.test(line);
    if (isList && prevList) continue;
    blocks++;
    prevList = isList;
  }
  return blocks;
}

function logicPoints(t) {
  const out = [];
  for (const s of sentences(normalize(t))) {
    const sent = s.trim();
    for (const [kind, re] of LOGIC) if (re.test(sent)) out.push({ kind, sentence: sent });
  }
  return out;
}

const matches = (re, t) => [...t.matchAll(re)].map((m) => m[0]);

export function diffTexts(origRaw, rewriteRaw) {
  const o = normalize(origRaw);
  const r = normalize(rewriteRaw);
  const out = { markers: [], newWords: [], lostWords: [], structure: [], logic: logicPoints(rewriteRaw) };

  for (const [kind, re] of Object.entries(MARKERS)) {
    const a = matches(re, o);
    const b = matches(re, r);
    if (a.length !== b.length) out.markers.push({ kind, orig: a.length, rewrite: b.length, origHits: a, rewriteHits: b });
  }

  const ow = new Set(o.match(CONTENT) ?? []);
  const rw = new Set(r.match(CONTENT) ?? []);
  out.newWords = [...rw].filter((w) => !o.includes(w)).sort();
  out.lostWords = [...ow].filter((w) => !r.includes(w)).sort();

  if (hasList(origRaw) && !hasList(rewriteRaw)) {
    out.structure.push("箇条書きを地の文にした。各項目の文末（指示・説明・評価）が元と同じか見る");
  }
  const po = paragraphs(origRaw);
  const pr = paragraphs(rewriteRaw);
  if (pr < po) out.structure.push(`段落をまとめた（${po} → ${pr}）。まとめた段落の話題が1つか見る`);
  const so = sentences(o).length;
  const sr = sentences(r).length;
  if (so !== sr) out.structure.push(`文の数が変わった（${so} → ${sr}）`);

  return out;
}

function formatReport(d) {
  const lines = [];
  if (d.markers.length) {
    lines.push("■ 言い回しの種類の増減（意味が動きやすいところ）");
    for (const m of d.markers) {
      lines.push(`- ${m.kind}: ${m.orig} → ${m.rewrite}（元: ${m.origHits.join("、") || "なし"} / 後: ${m.rewriteHits.join("、") || "なし"}）`);
    }
  }
  if (d.newWords.length) lines.push(`■ 元の文にない語: ${d.newWords.join("、")}`);
  if (d.lostWords.length) lines.push(`■ 消えた語: ${d.lostWords.join("、")}`);
  for (const s of d.structure) lines.push(`■ ${s}`);
  if (d.logic.length) {
    lines.push("■ つながりを確かめる場所（何と何をつないでいるか言えるか）");
    for (const p of d.logic) {
      const s = p.sentence.length <= 44 ? p.sentence : `${p.sentence.slice(0, 44)}…`;
      lines.push(`- ${p.kind}: ${s}`);
    }
  }
  return lines.length ? lines.join("\n") : "（候補なし）";
}

function main(argv) {
  const args = argv.filter((a) => !a.startsWith("--"));
  if (args.length < 2) {
    console.error("usage: node diff.mjs <original> <rewrite> [--json]");
    return 1;
  }
  let orig;
  let rewrite;
  try {
    orig = readFileSync(args[0], "utf8");
    rewrite = readFileSync(args[1], "utf8");
  } catch (e) {
    console.error(`cannot read input: ${e.message}`);
    return 2;
  }
  const d = diffTexts(orig, rewrite);
  console.log(argv.includes("--json") ? JSON.stringify(d, null, 2) : formatReport(d));
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = main(process.argv.slice(2));
