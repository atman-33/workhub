// persona — shared configuration, character discovery and state resolution.
//
// Derived from genshijin (MIT, InterfaceX-co-jp)
// https://github.com/InterfaceX-co-jp/genshijin
//
// State has two axes: the active character and the intensity level. Both are
// persisted so a switch survives into later sessions.
//
// Resolution order for the persisted default:
//   1. PERSONA_DEFAULT environment variable  ("<character>:<level>" or "off")
//   2. <claudeDir>/persona.json              (written by /persona)
//   3. compatibility paths, read-only:
//        $XDG_CONFIG_HOME/persona/config.json
//        ~/.config/persona/config.json
//        %APPDATA%/persona/config.json
//   4. genshijin:normal
//
// Characters are discovered from three layers, later layers losing to earlier:
//   1. <cwd>/.claude/personas/<id>/character.md        (reserved, see NOTE)
//   2. <claudeDir>/personas/<id>/character.md          (user, survives updates)
//   3. <pluginRoot>/characters/<id>/character.md       (bundled with plugin)
//
// NOTE: the project layer is deliberately inert in 0.1.0 — the lookup path
// exists so per-project characters can be enabled later without moving state
// around, but nothing writes to it yet.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const VALID_LEVELS = ['light', 'normal', 'heavy'];
export const DEFAULT_CHARACTER = 'genshijin';
export const DEFAULT_LEVEL = 'normal';

const CHARACTER_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const FLAG_BASENAME = '.persona-active';
const LABEL_BASENAME = '.persona-statusline-label';
const CONFIG_BASENAME = 'persona.json';
const MAX_FLAG_BYTES = 96;
const MAX_LABEL_BYTES = 64;
const MAX_CONFIG_BYTES = 8 * 1024;
const MAX_CHARACTER_BYTES = 256 * 1024;

export function claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

export function pluginRoot() {
  if (process.env.CLAUDE_PLUGIN_ROOT) return process.env.CLAUDE_PLUGIN_ROOT;
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

export function isValidCharacterId(id) {
  return typeof id === 'string' && CHARACTER_ID_RE.test(id);
}

// --- safe file primitives -------------------------------------------------
//
// The flag/label/config paths are predictable, so a symlink planted at one of
// them could otherwise be used to make this process clobber an unrelated file,
// or to read one back into the model's context. Refuse symlinks on both the
// entry itself, cap the size, and write through a temp file + rename.

function refuseSymlink(target) {
  try {
    const st = fs.lstatSync(target);
    if (st.isSymbolicLink() || !st.isFile()) return null;
    return st;
  } catch (err) {
    if (err.code === 'ENOENT') return undefined;
    return null;
  }
}

function readTextSafely(target, maxBytes) {
  const st = refuseSymlink(target);
  if (!st) return null;
  if (st.size > maxBytes) return null;
  const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
  let fd;
  try {
    fd = fs.openSync(target, fs.constants.O_RDONLY | O_NOFOLLOW);
    const buf = Buffer.alloc(Math.min(st.size, maxBytes));
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n).toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* already closed */ }
    }
  }
}

function writeTextSafely(target, content) {
  let tempPath;
  try {
    const dir = path.dirname(target);
    fs.mkdirSync(dir, { recursive: true });
    if (refuseSymlink(target) === null) return false;

    tempPath = path.join(
      dir,
      `.persona.tmp.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`
    );
    const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW;
    let fd;
    try {
      fd = fs.openSync(tempPath, flags, 0o600);
      fs.writeSync(fd, String(content));
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }

    // Windows rename cannot replace an existing destination; unlink first, and
    // stop if another writer recreates it so we never clobber a fresher value.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        fs.renameSync(tempPath, target);
        tempPath = undefined;
        return true;
      } catch (err) {
        if (!['EPERM', 'EBUSY', 'EACCES', 'EEXIST'].includes(err.code)) throw err;
        if (process.platform !== 'win32') continue;
        if (refuseSymlink(target) === null) return false;
        try {
          fs.unlinkSync(target);
        } catch (unlinkErr) {
          if (unlinkErr.code !== 'ENOENT') continue;
        }
      }
    }
    return false;
  } catch {
    return false;
  } finally {
    if (tempPath) {
      try { fs.unlinkSync(tempPath); } catch { /* already renamed or never created */ }
    }
  }
}

// --- session flag ---------------------------------------------------------

function flagPath() {
  return path.join(claudeDir(), FLAG_BASENAME);
}

// Returns { enabled, character, level } or null when unreadable/invalid.
export function readFlag() {
  const raw = readTextSafely(flagPath(), MAX_FLAG_BYTES);
  if (raw === null) return null;
  return parseState(raw.trim());
}

export function writeFlag(state) {
  return writeTextSafely(flagPath(), formatState(state));
}

export function parseState(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  const value = raw.trim().toLowerCase();
  if (value === 'off') return { enabled: false, character: null, level: null };
  const [character, level = DEFAULT_LEVEL] = value.split(':');
  if (!isValidCharacterId(character)) return null;
  if (!VALID_LEVELS.includes(level)) return null;
  return { enabled: true, character, level };
}

export function formatState(state) {
  if (!state || !state.enabled) return 'off';
  return `${state.character}:${state.level}`;
}

// --- persisted configuration ---------------------------------------------

export function configPath() {
  return path.join(claudeDir(), CONFIG_BASENAME);
}

function compatConfigPaths() {
  const paths = [];
  if (process.env.XDG_CONFIG_HOME) {
    paths.push(path.join(process.env.XDG_CONFIG_HOME, 'persona', 'config.json'));
  }
  paths.push(path.join(os.homedir(), '.config', 'persona', 'config.json'));
  if (process.platform === 'win32' && process.env.APPDATA) {
    paths.push(path.join(process.env.APPDATA, 'persona', 'config.json'));
  }
  return paths;
}

function stateFromConfigObject(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.enabled === false) return { enabled: false, character: null, level: null };
  const character = typeof obj.character === 'string' ? obj.character.toLowerCase() : null;
  const level = typeof obj.level === 'string' ? obj.level.toLowerCase() : DEFAULT_LEVEL;
  if (!isValidCharacterId(character)) return null;
  if (!VALID_LEVELS.includes(level)) return null;
  return { enabled: true, character, level };
}

function readConfigFile(target) {
  const raw = readTextSafely(target, MAX_CONFIG_BYTES);
  if (raw === null) return null;
  try {
    return stateFromConfigObject(JSON.parse(raw));
  } catch {
    return null;
  }
}

// The environment variable wins on read, which means a /persona switch cannot
// take effect next session while it is set. Callers surface that to the user
// rather than letting the write silently do nothing.
export function envOverride() {
  const raw = process.env.PERSONA_DEFAULT;
  if (!raw) return null;
  return parseState(raw);
}

export function readPersistedState() {
  const env = envOverride();
  if (env) return { state: env, origin: 'env' };

  const own = readConfigFile(configPath());
  if (own) return { state: own, origin: 'config' };

  for (const candidate of compatConfigPaths()) {
    const compat = readConfigFile(candidate);
    if (compat) return { state: compat, origin: 'compat' };
  }

  return {
    state: { enabled: true, character: DEFAULT_CHARACTER, level: DEFAULT_LEVEL },
    origin: 'default',
  };
}

export function writePersistedState(state) {
  const payload = state && state.enabled
    ? { character: state.character, level: state.level, enabled: true }
    : { enabled: false };
  return writeTextSafely(configPath(), `${JSON.stringify(payload, null, 2)}\n`);
}

// --- statusline label -----------------------------------------------------

// Control characters are stripped on both ends of this channel: the label is
// written straight to the terminal by the statusline, so an escape sequence
// smuggled in through a character file must never reach it.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

export function writeStatuslineLabel(label) {
  const clean = String(label ?? '').replace(CONTROL_CHARS, '').slice(0, 24);
  return writeTextSafely(path.join(claudeDir(), LABEL_BASENAME), clean);
}

export function readStatuslineLabel() {
  const raw = readTextSafely(path.join(claudeDir(), LABEL_BASENAME), MAX_LABEL_BYTES);
  if (raw === null) return null;
  return raw.replace(CONTROL_CHARS, '').trim().slice(0, 24) || null;
}

// --- character discovery --------------------------------------------------

// Flat `key: value` only. A nested YAML parser is not worth the dependency,
// and a flat shape keeps hand-written character files unambiguous.
export function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { meta: {}, body: text };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    let value = kv[2].trim();
    if ((value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
        (value.startsWith("'") && value.endsWith("'") && value.length > 1)) {
      value = value.slice(1, -1);
    }
    meta[kv[1]] = value;
  }
  return { meta, body: text.slice(match[0].length) };
}

function characterSearchLayers(cwd) {
  return [
    { origin: 'project', dir: path.join(cwd || process.cwd(), '.claude', 'personas') },
    { origin: 'user', dir: path.join(claudeDir(), 'personas') },
    { origin: 'bundled', dir: path.join(pluginRoot(), 'characters') },
  ];
}

function loadCharacterFrom(dir, id, origin) {
  const file = path.join(dir, id, 'character.md');
  const raw = readTextSafely(file, MAX_CHARACTER_BYTES);
  if (raw === null) return null;
  const { meta, body } = parseFrontmatter(raw);
  if (!isValidCharacterId(meta.id) || meta.id !== id) return null;
  const levels = {
    light: meta.level_light || 'light',
    normal: meta.level_normal || 'normal',
    heavy: meta.level_heavy || 'heavy',
  };
  return {
    id,
    origin,
    file,
    body,
    meta,
    name: meta.name || id,
    source: meta.source || '',
    statusline: meta.statusline || meta.name || id,
    reminder: meta.reminder || '',
    basedOn: meta.based_on || null,
    order: characterOrder(meta.order),
    levels,
  };
}

// Display order for the character lists. Absent or unparseable sorts last, so
// a hand-written character without the key still appears — just at the end.
export const DEFAULT_ORDER = Number.MAX_SAFE_INTEGER;

function characterOrder(raw) {
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : DEFAULT_ORDER;
}

// Sorts by the declared `order:`, falling back to the id so the result is
// stable when several characters share one (or declare none).
export function byDisplayOrder(a, b) {
  return a.order - b.order || a.id.localeCompare(b.id);
}

// Returns a Map keyed by id. Earlier layers win, and the losing entry is kept
// on `overrides` so /persona can report that a bundled character is shadowed.
export function discoverCharacters(cwd) {
  const found = new Map();
  for (const layer of characterSearchLayers(cwd)) {
    let entries;
    try {
      entries = fs.readdirSync(layer.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const id = entry.name;
      if (id.startsWith('_') || !isValidCharacterId(id)) continue;
      const character = loadCharacterFrom(layer.dir, id, layer.origin);
      if (!character) continue;
      const existing = found.get(id);
      if (existing) {
        existing.overrides = existing.overrides || [];
        existing.overrides.push(character);
      } else {
        found.set(id, character);
      }
    }
  }
  return found;
}

// Maps a user-typed level word to an internal id. Accepts the internal ids,
// and any display label defined by any discovered character, so `/persona 無口`
// works without naming the character.
export function resolveLevelWord(word, characters) {
  if (!word) return null;
  const value = String(word).trim();
  const lower = value.toLowerCase();
  if (VALID_LEVELS.includes(lower)) return lower;
  for (const character of characters.values()) {
    for (const level of VALID_LEVELS) {
      if (character.levels[level] === value) return level;
    }
  }
  return null;
}

// Resolves what should actually be in effect right now.
//   sessionState — the flag written during this session, if any
//   warnings     — plain-Japanese notices to surface to the user
export function resolveActive({ cwd, sessionState } = {}) {
  const characters = discoverCharacters(cwd);
  const persisted = readPersistedState();
  const state = sessionState || persisted.state;
  const warnings = [];

  if (!state.enabled) {
    return { enabled: false, characters, character: null, level: null, warnings, origin: persisted.origin };
  }

  let character = characters.get(state.character);
  let level = state.level;

  if (!character) {
    warnings.push(
      `キャラクター "${state.character}" が見つかりません。/persona で一覧を確認してください。` +
      `暫定的に ${DEFAULT_CHARACTER} を使用します。`
    );
    character = characters.get(DEFAULT_CHARACTER) || null;
  }

  if (!VALID_LEVELS.includes(level)) level = DEFAULT_LEVEL;

  if (!character) {
    warnings.push('利用できるキャラクターが1つもありません。プラグインの導入状態を確認してください。');
    return { enabled: false, characters, character: null, level: null, warnings, origin: persisted.origin };
  }

  return { enabled: true, characters, character, level, warnings, origin: persisted.origin };
}

export function statuslineLabelFor(character, level) {
  if (!character) return '';
  const badge = character.statusline;
  if (level === DEFAULT_LEVEL) return badge;
  return `${badge}:${character.levels[level] || level}`;
}
