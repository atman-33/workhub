// persona — SessionStart hook.
//
// Derived from genshijin (MIT, InterfaceX-co-jp)
// https://github.com/InterfaceX-co-jp/genshijin
//
// Composes the injected context from three sources, keeping only the section
// that belongs to the active level:
//
//   characters/<active>/character.md   identity and speech
//   core/compression.md                shared compression rules
//   core/boundaries.md                 shared boundaries and auto-clarity
//
// The model never reads those files itself — that would pull every character
// and every level into context. Everything it needs arrives here, already
// filtered, exactly once per session.

import fs from 'node:fs';
import path from 'node:path';
import {
  claudeDir,
  pluginRoot,
  readFlag,
  writeFlag,
  writePersistedState,
  readPersistedState,
  resolveActive,
  statuslineLabelFor,
  writeStatuslineLabel,
  parseFrontmatter,
  VALID_LEVELS,
} from './persona-config.mjs';

function readStdinJson() {
  try {
    if (process.stdin.isTTY) return {};
    const raw = fs.readFileSync(0, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// Keeps the "## レベル: <label>" section matching the active level and drops
// the other two. Any other heading is passed through untouched.
function filterLevelSections(body, keepLabel, allLabels) {
  const lines = body.split(/\r?\n/);
  const out = [];
  let skipping = false;
  for (const line of lines) {
    const heading = /^##\s+レベル:\s*(.+?)\s*$/.exec(line);
    if (heading) {
      const label = heading[1];
      if (label === keepLabel) {
        skipping = false;
        out.push(line);
      } else if (allLabels.includes(label)) {
        skipping = true;
      } else {
        // A level heading nobody declared: keep it rather than silently
        // swallowing content the author meant to ship.
        skipping = false;
        out.push(line);
      }
      continue;
    }
    if (/^##\s+/.test(line)) skipping = false;
    if (!skipping) out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function readCoreFile(name) {
  try {
    const raw = fs.readFileSync(path.join(pluginRoot(), 'core', name), 'utf8');
    // Core files open with a title and a provenance note aimed at maintainers.
    // Strip everything above the first "##" so none of it reaches the model.
    const firstSection = raw.indexOf('\n## ');
    return firstSection === -1 ? raw.trim() : raw.slice(firstSection + 1).trim();
  } catch {
    return '';
  }
}

function genshijinPluginActive() {
  try {
    return fs.existsSync(path.join(claudeDir(), '.genshijin-active'));
  } catch {
    return false;
  }
}

const input = readStdinJson();
const source = typeof input.source === 'string' ? input.source : 'startup';

// A real startup takes the persisted configuration — that is what makes a
// /persona switch survive into later sessions. resume/clear/compact re-enter an
// existing session, so the flag written during it wins.
const sessionFlag = source === 'startup' ? null : readFlag();
const active = resolveActive({ cwd: process.cwd(), sessionState: sessionFlag });

if (!active.enabled) {
  writeFlag({ enabled: false });
  writeStatuslineLabel('');
  if (active.warnings.length) process.stdout.write(active.warnings.join(' '));
  process.exit(0);
}

const { character, level } = active;

writeFlag({ enabled: true, character: character.id, level });
writeStatuslineLabel(statuslineLabelFor(character, level));

// A character resolved through the fallback should not silently rewrite the
// stored configuration — the original id may come back when the user restores
// their file. Only re-persist when nothing was stored at all.
const persisted = readPersistedState();
if (persisted.origin === 'default' && !active.warnings.length) {
  writePersistedState({ enabled: true, character: character.id, level });
}

const levelLabel = character.levels[level] || level;
const allLabels = VALID_LEVELS.map((id) => character.levels[id]);
const characterBody = filterLevelSections(character.body, levelLabel, allLabels);
// core/compression.md is character-agnostic, so its level headings use the
// internal ids rather than a character's display labels.
const compression = filterLevelSections(
  readCoreFile('compression.md'),
  level,
  VALID_LEVELS
);
const boundaries = readCoreFile('boundaries.md');

const parts = [];

if (active.warnings.length) parts.push(active.warnings.join('\n'));

parts.push(
  `ペルソナ有効 — ${character.name}（${levelLabel}）\n` +
  `切替: \`/persona <キャラクター> <レベル>\`  解除: \`/persona off\`  一覧: \`/persona\``
);

parts.push(`# キャラクター: ${character.name}\n\n${characterBody}`);
if (compression) parts.push(`# 圧縮ルール\n\n${compression}`);
if (boundaries) parts.push(`# 境界\n\n${boundaries}`);

if (genshijinPluginActive()) {
  parts.push(
    'WARNING: genshijin プラグインが同時に有効です。両方が毎ターン別々の口調指示を ' +
    '注入するため、口調が安定しません。どちらか一方を無効にしてください ' +
    '(`/genshijin off` または `/persona off`)。'
  );
}

process.stdout.write(parts.join('\n\n'));
