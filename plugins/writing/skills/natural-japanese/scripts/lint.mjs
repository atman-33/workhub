#!/usr/bin/env node
// lint — a deterministic first pass over Japanese prose for the surface marks
// of machine-written text.
//
// It only points at candidates. Whether a hit is a real defect is the
// rewriter's call: a word that carries the literal meaning, an evaluation that
// the sentence exists to make, or a negation that carries the claim all stay.
// There is deliberately no score — a number invites rewriting until it reads
// 100, which is the over-rewrite loop SKILL.md tells you to avoid.
//
// Usage:
//   node lint.mjs [file] [--json] [--strict]     (reads stdin without a file)
//
// Exit code: 0 normally, 2 when the file cannot be read, 1 under --strict when
// any warn-level finding exists.
//
// Derived from the lint idea in nanaism/yomiyasu (MIT), rewritten for this
// repository; see plugins/writing/NOTICE.md.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const EMOJI =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}-\u{2B55}]/gu;

// Words that read as decoration when they are not carrying a literal meaning.
const SLOP_WORDS = [
  // pseudo-texture
  "手触り", "肌感", "肌感覚", "体温", "温度感", "熱量", "血の通った", "泥臭い", "泥臭さ",
  // pseudo-cognition / pseudo-evaluation
  "解像度", "腹落ち", "メンタルモデル", "本質的", "地に足のついた", "等身大",
  // grandiose experience words
  "真理", "虚飾", "境地", "美学", "深淵", "冷徹", "禁欲的", "優美", "極致", "宿命",
  // invented metaphors
  "意思決定OS", "羅針盤", "起爆剤", "触媒",
];

// Ordinary words that are also AI favourites: surfaced as info, never warn.
const SOFT_SLOP_WORDS = ["営み", "装置", "土台", "正本"];

const METAPHOR_VERBS = [
  [/(地味に|よく|じわじわ)効[きくいた]/, "比喩動詞「効く」"],
  [/静かに(壊れ|落ち|失敗|沈黙)/, "直訳「静かに壊れる」(silently fail)"],
  [/黙って(無視|捨て|スキップ|破棄)/, "直訳「黙って無視される」"],
  [/側に倒[すしせ]/, "「〜側に倒す」"],
  [/時間[をに]溶か[したす]/, "比喩動詞「時間を溶かす」"],
  [/(1つずつ|一つずつ)潰[していく]/, "比喩動詞「潰す」"],
  [/した瞬間/, "直訳「〜した瞬間」(the moment ...)"],
  [/(前提|基盤)が崩れ[るた]/, "抽象比喩「前提が崩れる」"],
  [/文化が醸成/, "非生物主語「文化が醸成される」"],
  [/プロセスが定着/, "非生物主語「プロセスが定着する」"],
  [/事例が残した/, "非生物主語「事例が残した」"],
];

const FILLERS = [
  [/^(まず|ここで)?重要なのは、?/, "前置き「重要なのは」"],
  [/^結論から言うと、?/, "前置き「結論から言うと」"],
  [/^正直に言うと、?/, "前置き「正直に言うと」"],
  [/^避けたいのは、?/, "前置き「避けたいのは」"],
  [/いかがでし(たでしょうか|たか)?[？?。]?$/, "定型の結び「いかがでしたでしょうか」"],
  [/ぜひ(参考|試し|活用)(に)?して(みて)?ください[！!。]?/, "定型の結び「ぜひ〜してみてください」"],
  [/に他なりません/, "決め文「〜に他なりません」"],
];

const DASH = /[—―─]{1,}/;
const NEGATIVE_PARALLEL = /ではなく/;
const SENTENCE_END_KINDS = ["でした", "ました", "です", "ます", "である", "だろう", "だ"];

const isListLine = (s) => /^\s*([-*+]|\d+\.)\s+/.test(s);
const isStructural = (stripped) =>
  stripped.startsWith(">") || stripped.startsWith("|") || stripped.startsWith("![") || stripped.startsWith("[![") || stripped.startsWith("<");

function frontmatterLines(lines) {
  if (!lines.length || lines[0].trim() !== "---") return 0;
  for (let i = 1; i < lines.length; i++) if (lines[i].trim() === "---") return i + 1;
  return 0;
}

/** Plain-prose sentences with their 1-based line numbers (no code, lists, tables, quotes). */
function proseSentences(lines, skip) {
  const out = [];
  let inCode = false;
  lines.forEach((line, idx) => {
    const no = idx + 1;
    if (no <= skip) return;
    const t = line.trim();
    if (t.startsWith("```") || t.startsWith("~~~")) {
      inCode = !inCode;
      return;
    }
    if (inCode || !t || t.startsWith("#") || isStructural(t) || isListLine(t) || /^( {2}|\t)/.test(line)) return;
    for (const s of t.split(/(?<=[。！？])/)) {
      const c = s.trim();
      if (c.length > 3) out.push([no, c]);
    }
  });
  return out;
}

function sentenceEndRuns(sentences) {
  const findings = [];
  let run = 0;
  let prev = "";
  for (const [line, s] of sentences) {
    const clean = s.replace(/[。！？\s]+$/, "");
    const kind = SENTENCE_END_KINDS.find((k) => clean.endsWith(k)) ?? "";
    if (kind && kind === prev) run++;
    else run = 1;
    prev = kind;
    if (kind && run === 3) {
      findings.push({
        rule: "sentence_end_repetition",
        line,
        severity: "warn",
        message: `同じ文末「${kind}」が3文続いています。直すついでにだけ文末を散らす。`,
        snippet: s,
      });
    }
  }
  return findings;
}

function metrics(lines, skip) {
  const kept = [];
  let inCode = false;
  lines.forEach((l, idx) => {
    if (idx + 1 <= skip) return;
    const t = l.trim();
    if (t.startsWith("```") || t.startsWith("~~~")) {
      inCode = !inCode;
      return;
    }
    if (inCode || isStructural(t)) return;
    kept.push(l);
  });
  const nonEmpty = kept.filter((l) => l.trim());
  // A bulleted external link is reference data, not a list standing in for prose.
  const listLines = nonEmpty.filter((l) => isListLine(l) && !/[-*+]\s+\[.*?\]\(https?:\/\//.test(l)).length;
  const body = kept.join("\n");
  const bold = (body.match(/\*\*[^*]+\*\*/g) ?? []).length;
  const chars = body.replace(/\s+/g, "").length;
  return {
    chars,
    lines: nonEmpty.length,
    listLines,
    listRatio: nonEmpty.length ? +(listLines / nonEmpty.length).toFixed(3) : 0,
    bold,
    boldPer1000: chars ? +((bold / chars) * 1000).toFixed(2) : 0,
  };
}

export function lintText(text) {
  const lines = text.split("\n");
  const skip = frontmatterLines(lines);
  const m = metrics(lines, skip);
  const findings = [];
  const add = (rule, line, severity, message, snippet) => findings.push({ rule, line, severity, message, snippet });

  if (m.chars > 300) {
    if (m.boldPer1000 > 3) {
      add("excess_bold", 1, "warn", `太字が1,000字あたり${m.boldPer1000}個。核になる1箇所に絞る。`, `${m.bold}回 / ${m.chars}字`);
    }
    if (m.listRatio > 0.25) {
      add("excess_list", 1, "warn", `箇条書きが${(m.listRatio * 100).toFixed(1)}%。つながりのある説明は地の文に戻す。`, `${m.listLines} / ${m.lines}行`);
    }
  }

  findings.push(...sentenceEndRuns(proseSentences(lines, skip)));

  let inCode = false;
  lines.forEach((line, idx) => {
    const no = idx + 1;
    if (no <= skip) return;
    const t = line.trim();
    if (t.startsWith("```") || t.startsWith("~~~")) {
      inCode = !inCode;
      return;
    }
    if (inCode) return;

    const emoji = line.match(EMOJI);
    if (emoji) add("emoji", no, "warn", `絵文字（${emoji.slice(0, 3).join(" ")}）。装飾は付けない。`, t);

    if (t.startsWith("#")) {
      if (/（(素の出力|いわゆる|概要|詳細)）/.test(t)) {
        add("redundant_bracket", no, "warn", "見出しの補足カッコが情報を増やしていない。", t);
      }
      return;
    }
    // Quotes, tables, images and HTML are usually examples of the anti-patterns.
    if (isStructural(t)) return;

    const scan = t.replace(/`[^`]+`/g, "");
    const plain = scan.replace(/\*\*|\*|__/g, "");

    if (/([ぁ-んァ-ヶ一-龥])\s+([a-zA-Z0-9_-]{2,})\s+([ぁ-ん])/.test(scan) && !/\[.*?\]\(.*?\)/.test(scan)) {
      add("halfwidth_space", no, "warn", "英単語の前後に不要な半角空白。助詞とそのまま続ける。", t);
    }
    if (/[：:]$/.test(scan) && !scan.startsWith("http")) {
      add("trailing_colon", no, "warn", "文末のコロン。句点で閉じるか、前置きを省く。", t);
    }
    if (DASH.test(plain)) {
      add("em_dash", no, "warn", "ダッシュ記号。助詞や句読点に置き換える。", t);
    }
    for (const w of SLOP_WORDS) {
      if (plain.includes(w)) {
        add("slop_word", no, "warn", `頻出語「${w}」。字義どおりの意味を担っているなら残す。飾りなら平易な言葉に。`, t);
      }
    }
    for (const w of SOFT_SLOP_WORDS) {
      if (plain.includes(w)) add("slop_word", no, "info", `「${w}」は普通の語でもある。比喩として浮いていなければ残す。`, t);
    }
    for (const [re, desc] of METAPHOR_VERBS) {
      if (re.test(plain)) {
        add("metaphor_verb", no, "warn", `${desc}。比喩なら平易な動詞へ。含み（後悔・不注意など）は残す。`, t);
      }
    }
    for (const [re, desc] of FILLERS) {
      if (re.test(plain)) {
        add("meta_filler", no, "warn", `${desc}。ただの前置きなら削る。評価を担っているなら述語に移して残す。`, t);
      }
    }
    if (NEGATIVE_PARALLEL.test(plain)) {
      add("negative_parallelism", no, "info", "「AではなくB」。否定を外しても主張が変わらないときだけ肯定にする。誤解の訂正を担っているなら残す。", t);
    }
  });

  return { metrics: m, findings, isClean: findings.length === 0 };
}

function formatReport(r) {
  const m = r.metrics;
  const out = [
    `文字数 ${m.chars} / 太字 ${m.boldPer1000}個/千字 / 箇条書き ${(m.listRatio * 100).toFixed(1)}%`,
    "(指摘は見直し候補。直すかどうかは文脈で決める)",
    "",
  ];
  if (r.isClean) out.push("指摘なし");
  else {
    for (const f of r.findings) {
      out.push(`L${f.line} [${f.severity}] ${f.rule}: ${f.message}`, `  > ${f.snippet}`);
    }
  }
  return out.join("\n");
}

function main(argv) {
  const args = argv.filter((a) => !a.startsWith("--"));
  let text;
  try {
    text = readFileSync(args[0] ?? 0, "utf8");
  } catch (e) {
    console.error(`cannot read ${args[0] ?? "stdin"}: ${e.message}`);
    return 2;
  }
  const result = lintText(text);
  console.log(argv.includes("--json") ? JSON.stringify(result, null, 2) : formatReport(result));
  const warns = result.findings.filter((f) => f.severity === "warn").length;
  return argv.includes("--strict") && warns > 0 ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = main(process.argv.slice(2));
