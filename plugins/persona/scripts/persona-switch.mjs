#!/usr/bin/env node
// persona — switch the active character from outside a /persona command.
//
// `/persona <id>` is handled by the UserPromptSubmit hook, which only sees what
// the *user* typed. A skill that wants to run under a particular character has
// no way to reach that path, so this CLI is the sanctioned entry point for it.
//
// It writes the same session flag the hook writes, which matters more than it
// looks: `persona-mode-tracker.mjs` re-asserts the active character on every
// turn from that flag. Anything that merely *tells* the model to adopt a
// character loses to that reminder within a turn or two.
//
// Two things the caller has to handle, because this process cannot:
//
//   - The full character definition is injected at SessionStart only. A switch
//     made mid-session would otherwise arrive as a one-line reminder, so the
//     body is printed here and the caller is expected to follow it.
//   - Restoring. `--once` keeps the persisted default untouched, but the flag
//     lives for the rest of the session; the previous state is printed as
//     `restore:` so the caller can switch back when it is done.
//
// Usage:
//   node persona-switch.mjs <character> [level] [--once] [--quiet]
//   node persona-switch.mjs off [--once]
//   node persona-switch.mjs --status
//
// Exit codes: 0 switched, 1 bad usage, 2 unknown character/level, 3 write
// failed. A caller that treats any non-zero as "persona unavailable" and
// carries on unstyled is behaving correctly.

import {
  discoverCharacters,
  formatState,
  readFlag,
  readPersistedState,
  resolveLevelWord,
  levelHeadingLabel,
  statuslineLabelFor,
  writeFlag,
  writePersistedState,
  writeStatuslineLabel,
  DEFAULT_LEVEL,
  VALID_LEVELS,
} from '../hooks/persona-config.mjs';

const OFF_WORDS = new Set(['off', 'stop', 'disable', '解除', '停止', 'オフ', '無効']);

function fail(code, message) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const words = argv.filter((a) => !a.startsWith('--'));
const once = flags.has('--once');
const quiet = flags.has('--quiet');

const characters = discoverCharacters(process.cwd());
// The flag is the session's own state; fall back to the persisted default so
// `restore:` still names something real on the first switch of a session.
const current = readFlag() || readPersistedState().state;

if (flags.has('--status')) {
  process.stdout.write(`current: ${formatState(current)}\n`);
  process.stdout.write(`available: ${[...characters.keys()].sort().join(' ')}\n`);
  process.exit(0);
}

if (words.length === 0) fail(1, 'usage: persona-switch.mjs <character> [level] [--once] | off | --status');

let next;
if (OFF_WORDS.has(words[0].toLowerCase())) {
  next = { enabled: false, character: null, level: null };
} else {
  const id = words[0].toLowerCase();
  if (!characters.has(id)) {
    fail(2, `unknown character: ${words[0]} (available: ${[...characters.keys()].sort().join(' ')})`);
  }
  let level = current.enabled ? current.level : DEFAULT_LEVEL;
  if (words[1]) {
    const resolved = resolveLevelWord(words[1], characters);
    if (!resolved) fail(2, `unknown level: ${words[1]} (valid: ${VALID_LEVELS.join(' ')})`);
    level = resolved;
  }
  next = { enabled: true, character: id, level };
}

const character = next.enabled ? characters.get(next.character) : null;

if (!writeFlag(next)) fail(3, 'failed to write the persona session flag');
writeStatuslineLabel(next.enabled ? statuslineLabelFor(character, next.level) : '');
if (!once) writePersistedState(next);

// `restore:` is the whole point of the machine-readable header — the caller
// switches back with `persona-switch.mjs <that value>`, and `off` round-trips
// through the same parser the hook uses.
process.stdout.write(`switched: ${formatState(next)}\n`);
process.stdout.write(`restore: ${formatState(current)}\n`);
process.stdout.write(`scope: ${once ? 'session' : 'persisted'}\n`);

if (!next.enabled) {
  if (!quiet) process.stdout.write('\nペルソナを解除しました。以降は通常の応答スタイルで返答してください。\n');
  process.exit(0);
}

if (quiet) process.exit(0);

const levelLabel = character.levels[next.level] || next.level;
process.stdout.write(
  `\n以降、${character.name}（${levelLabel}）の口調で応答してください。` +
  '完全な定義は次回セッション開始時に注入されますが、当面は下記に従ってください。\n\n'
);
process.stdout.write(`# キャラクター: ${character.name}\n`);
// Only the selected level's section applies; the other two would be noise, and
// this file is read into a live context.
const drop = new Set(
  VALID_LEVELS.map((l) => character.levels[l]).filter((label) => label !== levelLabel)
);
let skipping = false;
for (const line of character.body.split(/\r?\n/)) {
  const label = levelHeadingLabel(line);
  if (label !== null) skipping = drop.has(label);
  else if (line.startsWith('## ')) skipping = false;
  if (!skipping) process.stdout.write(`${line}\n`);
}
