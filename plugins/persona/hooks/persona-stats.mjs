// persona — token usage and estimated savings.
//
// Derived from genshijin (MIT, InterfaceX-co-jp)
// https://github.com/InterfaceX-co-jp/genshijin
//
// Reads the Claude Code session transcript directly, so the numbers are real
// usage rather than a model's guess. Only the savings figure is an estimate,
// and it is labelled as one.
//
//   node persona-stats.mjs [--session-file <path>] [--share] [--all] [--since 7d]
//
// persona-mode-tracker invokes this for /persona-stats and injects the output
// verbatim, so the model never does the arithmetic itself.

import fs from 'node:fs';
import path from 'node:path';
import { claudeDir, readFlag, resolveActive } from './persona-config.mjs';

// Average output reduction per level, applied to observed output tokens to
// estimate what the same answers would have cost uncompressed. Deliberately
// conservative; refine against real measurements before quoting these.
const REDUCTION_BY_LEVEL = { light: 0.25, normal: 0.55, heavy: 0.70 };

// The SessionStart injection plus the per-turn reminder are the price of the
// feature and are subtracted from gross savings so the net figure is honest.
const SESSION_OVERHEAD_TOKENS = 1200;
const DEFAULT_TURN_OVERHEAD_TOKENS = 60;

// Anthropic published output-token prices, USD per million, matched by model id
// prefix. Update from https://www.anthropic.com/pricing when they change.
const OUTPUT_PRICE_PER_M = [
  ['claude-opus-4-1', 75.0],
  ['claude-opus-4', 25.0],
  ['claude-opus', 75.0],
  ['claude-sonnet-4', 15.0],
  ['claude-sonnet', 15.0],
  ['claude-haiku-4', 5.0],
  ['claude-haiku', 4.0],
  ['claude-3-5-sonnet', 15.0],
  ['claude-3-opus', 75.0],
];

function turnOverheadTokens() {
  const raw = Number(process.env.PERSONA_TURN_OVERHEAD_TOKENS);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_TURN_OVERHEAD_TOKENS;
}

function priceForModel(model) {
  if (!model) return null;
  for (const [prefix, price] of OUTPUT_PRICE_PER_M) {
    if (model.startsWith(prefix)) return price;
  }
  return null;
}

function formatUsd(amount) {
  if (amount >= 1) return `$${amount.toFixed(2)}`;
  if (amount >= 0.01) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(4)}`;
}

function formatTokens(n) {
  const value = Math.round(n);
  return value.toLocaleString('en-US');
}

function parseArgs(argv) {
  const args = { share: false, all: false, since: null, sessionFile: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--share') args.share = true;
    else if (arg === '--all') args.all = true;
    else if (arg === '--since') args.since = argv[++i] || null;
    else if (arg === '--session-file') args.sessionFile = argv[++i] || null;
  }
  return args;
}

function parseSince(value) {
  if (!value) return null;
  const match = /^(\d+)([dh])$/.exec(String(value).trim());
  if (!match) return null;
  const amount = Number(match[1]);
  const ms = match[2] === 'd' ? 86400000 : 3600000;
  return Date.now() - amount * ms;
}

function parseTranscript(filePath, sinceMs) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  let outputTokens = 0;
  let inputTokens = 0;
  let turns = 0;
  let model = null;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== 'assistant' || !entry.message || !entry.message.usage) continue;
    if (sinceMs) {
      const ts = entry.timestamp ? Date.parse(entry.timestamp) : NaN;
      if (!Number.isFinite(ts) || ts < sinceMs) continue;
    }
    const usage = entry.message.usage;
    outputTokens += usage.output_tokens || 0;
    inputTokens += (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0);
    turns++;
    if (!model && entry.message.model) model = entry.message.model;
  }
  return { outputTokens, inputTokens, turns, model };
}

function findTranscripts(limit) {
  const projectsDir = path.join(claudeDir(), 'projects');
  const files = [];
  const stack = [projectsDir];
  while (stack.length && files.length < limit) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith('.jsonl')) files.push(full);
    }
  }
  return files;
}

function mostRecentTranscript() {
  let best = null;
  for (const file of findTranscripts(5000)) {
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      continue;
    }
    if (!best || st.mtimeMs > best.mtime) best = { file, mtime: st.mtimeMs };
  }
  return best ? best.file : null;
}

function estimate(totals, level, sessions) {
  const reduction = REDUCTION_BY_LEVEL[level] ?? REDUCTION_BY_LEVEL.normal;
  // observed = baseline * (1 - reduction)  =>  saved = observed * r / (1 - r)
  const grossSaved = reduction >= 1
    ? 0
    : (totals.outputTokens * reduction) / (1 - reduction);
  const overhead = sessions * SESSION_OVERHEAD_TOKENS + totals.turns * turnOverheadTokens();
  return {
    reduction,
    grossSaved,
    overhead,
    netSaved: grossSaved - overhead,
  };
}

function render({ scope, totals, est, levelLabel, characterName, sessions }) {
  const price = priceForModel(totals.model);
  const lines = [];
  lines.push(`persona stats — ${scope}`);
  lines.push('');
  lines.push(`  キャラクター   ${characterName || '(無効)'}`);
  lines.push(`  レベル         ${levelLabel || '-'}  (推定削減率 ${Math.round(est.reduction * 100)}%)`);
  lines.push(`  モデル         ${totals.model || '(不明)'}`);
  lines.push('');
  lines.push(`  ターン数       ${formatTokens(totals.turns)}`);
  if (sessions > 1) lines.push(`  セッション数   ${formatTokens(sessions)}`);
  lines.push(`  出力トークン   ${formatTokens(totals.outputTokens)}  (実測)`);
  lines.push(`  入力トークン   ${formatTokens(totals.inputTokens)}  (実測、キャッシュ読込含む)`);
  lines.push('');
  lines.push(`  削減見込       ${formatTokens(est.grossSaved)}  (推定)`);
  lines.push(`  オーバーヘッド -${formatTokens(est.overhead)}  (ルール注入の実コスト)`);
  lines.push(`  正味           ${est.netSaved >= 0 ? '+' : ''}${formatTokens(est.netSaved)}`);
  if (price) {
    const usd = (est.netSaved / 1_000_000) * price;
    lines.push(`  金額換算       ${est.netSaved >= 0 ? '' : '-'}${formatUsd(Math.abs(usd))}  (出力単価 $${price}/M)`);
  }
  lines.push('');
  lines.push('  削減見込は平均削減率からの推定値です。トークン数とターン数は実測値です。');
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const active = resolveActive({ cwd: process.cwd(), sessionState: readFlag() });
  const level = active.enabled ? active.level : 'normal';
  const characterName = active.enabled ? active.character.name : null;
  const levelLabel = active.enabled
    ? (active.character.levels[active.level] || active.level)
    : level;

  if (args.all || args.since) {
    const sinceMs = parseSince(args.since);
    const totals = { outputTokens: 0, inputTokens: 0, turns: 0, model: null };
    let sessions = 0;
    for (const file of findTranscripts(2000)) {
      const parsed = parseTranscript(file, sinceMs);
      if (!parsed || parsed.turns === 0) continue;
      totals.outputTokens += parsed.outputTokens;
      totals.inputTokens += parsed.inputTokens;
      totals.turns += parsed.turns;
      if (!totals.model) totals.model = parsed.model;
      sessions++;
    }
    const scope = args.since ? `直近 ${args.since}` : '全期間';
    const est = estimate(totals, level, sessions);
    if (args.share) {
      process.stdout.write(
        `persona (${characterName || 'off'}) ${scope}: 出力 ${formatTokens(totals.outputTokens)} tok / ` +
        `正味削減 ${formatTokens(est.netSaved)} tok (推定)`
      );
      return;
    }
    process.stdout.write(render({ scope, totals, est, levelLabel, characterName, sessions }));
    return;
  }

  const file = args.sessionFile || mostRecentTranscript();
  if (!file) {
    process.stdout.write('persona stats: セッションログが見つかりません。');
    return;
  }
  const parsed = parseTranscript(file, null);
  if (!parsed) {
    process.stdout.write(`persona stats: セッションログを読めません (${file})。`);
    return;
  }
  const est = estimate(parsed, level, 1);
  if (args.share) {
    process.stdout.write(
      `persona (${characterName || 'off'}) 現セッション: 出力 ${formatTokens(parsed.outputTokens)} tok / ` +
      `正味削減 ${formatTokens(est.netSaved)} tok (推定)`
    );
    return;
  }
  process.stdout.write(
    render({ scope: '現セッション', totals: parsed, est, levelLabel, characterName, sessions: 1 })
  );
}

main();
