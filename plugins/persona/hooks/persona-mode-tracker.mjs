// persona — UserPromptSubmit hook.
//
// Derived from genshijin (MIT, InterfaceX-co-jp)
// https://github.com/InterfaceX-co-jp/genshijin
//
// Two jobs:
//   1. Interpret /persona commands (character switch, level switch, off,
//      listing) and persist the result.
//   2. Re-assert the active character every turn with a single short line.
//
// The per-turn reminder exists because a full rule set injected once at
// SessionStart drifts when other plugins inject competing style instructions
// each turn. It is deliberately one line: genshijin's equivalent runs ~150
// tokens per turn, which over a long session costs more than the SessionStart
// injection ever does.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  readFlag,
  writeFlag,
  writePersistedState,
  readPersistedState,
  envOverride,
  resolveActive,
  resolveLevelWord,
  discoverCharacters,
  statuslineLabelFor,
  writeStatuslineLabel,
  isValidCharacterId,
  VALID_LEVELS,
  DEFAULT_LEVEL,
} from './persona-config.mjs';

const TEMPORARY_WORDS = new Set(['一時', '一時的', 'once', '--once', 'temp', 'session']);
const OFF_WORDS = new Set(['off', 'stop', 'disable', '解除', '停止', 'オフ', '無効']);

function emit(additionalContext) {
  if (!additionalContext) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext,
    },
  }));
}

function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.on('data', (chunk) => { buf += chunk; });
    process.stdin.on('error', () => resolve(''));
    process.stdin.on('end', () => resolve(buf));
  });
}

// Claude Code delivers a slash command wrapped in an XML envelope. Unwrap ours
// back into literal form; for any other command, suppress command parsing so a
// stray "/persona" inside someone else's argument cannot switch characters.
function extractCommand(prompt) {
  const name = /<command-name>\s*([^<\s]+)\s*<\/command-name>/.exec(prompt);
  if (!name) return { text: prompt, foreign: false };
  if (!name[1].startsWith('/persona')) return { text: prompt, foreign: true };
  const args = /<command-args>\s*([^<]*?)\s*<\/command-args>/.exec(prompt);
  const argText = args ? args[1].trim() : '';
  return { text: argText ? `${name[1]} ${argText}` : name[1], foreign: false };
}

function listCharacters(characters, active) {
  const rows = [];
  for (const character of [...characters.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    const shadowed = character.overrides && character.overrides.length
      ? character.overrides[0]
      : null;
    let origin;
    if (character.origin === 'bundled') origin = '標準';
    else if (shadowed) origin = '上書';
    else origin = '独自';

    const marker = active.enabled && active.character && active.character.id === character.id
      ? '*'
      : ' ';
    const levels = VALID_LEVELS.map((id) => character.levels[id]).join(' / ');
    let note = '';
    if (shadowed && character.basedOn) {
      const [, basedVersion] = String(character.basedOn).split('@');
      if (basedVersion && shadowed.meta.version && basedVersion !== shadowed.meta.version) {
        note = `  (複製元 ${basedVersion} / 標準 ${shadowed.meta.version} — 差分あり)`;
      }
    }
    rows.push(`${marker} ${origin}  ${character.id.padEnd(12)} ${character.name}  [${levels}]${note}`);
  }
  return rows.join('\n');
}

function applySwitch({ characters, next, temporary }) {
  writeFlag(next);
  const character = next.enabled ? characters.get(next.character) : null;
  writeStatuslineLabel(next.enabled ? statuslineLabelFor(character, next.level) : '');

  const lines = [];
  if (!temporary) {
    const stored = writePersistedState(next);
    if (!stored) {
      lines.push('WARNING: 設定ファイルに保存できませんでした。この切替はセッション限りです。');
    } else if (envOverride()) {
      lines.push(
        'WARNING: 環境変数 PERSONA_DEFAULT が設定されているため、保存した設定は次回起動時に ' +
        '反映されません。恒久的に変えるには PERSONA_DEFAULT を解除してください。'
      );
    }
  } else {
    lines.push('このセッション限りの切替です。次回起動時は保存済みの設定に戻ります。');
  }

  if (!next.enabled) {
    lines.unshift('ペルソナを解除しました。以降は通常の応答スタイルで返答してください。');
    return lines.join('\n');
  }

  const levelLabel = character.levels[next.level] || next.level;
  lines.unshift(
    `ペルソナを ${character.name}（${levelLabel}）に切り替えました。` +
    'このターンから、このキャラクターの口調で返答してください。' +
    '口調の詳細は次回セッション開始時に完全な形で注入されますが、' +
    '当面は下記のリマインダに従ってください。'
  );
  if (character.reminder) lines.push(character.reminder);
  return lines.join('\n');
}

async function main() {
  const raw = await readStdin();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }

  const prompt = String(data.prompt || '').trim();
  if (/<scheduled-task\b/.test(prompt)) return;

  const { text, foreign } = extractCommand(prompt);
  const characters = discoverCharacters(process.cwd());

  // /persona-stats is computed here and injected verbatim, so the model shows
  // real numbers instead of estimating token counts itself.
  const statsMatch = /^\/persona(?::persona)?-stats(?:\s+(.*))?$/i.exec(text);
  if (!foreign && statsMatch) {
    const tail = (statsMatch[1] || '').trim().split(/\s+/).filter(Boolean);
    const argv = [fileURLToPath(new URL('./persona-stats.mjs', import.meta.url))];
    if (data.transcript_path) argv.push('--session-file', data.transcript_path);
    if (tail.includes('--share')) argv.push('--share');
    if (tail.includes('--all')) argv.push('--all');
    const sinceIndex = tail.indexOf('--since');
    if (sinceIndex !== -1 && tail[sinceIndex + 1]) argv.push('--since', tail[sinceIndex + 1]);
    let block;
    try {
      block = execFileSync(process.execPath, argv, { encoding: 'utf8', timeout: 10000 }).trim();
    } catch {
      block = 'persona stats: 起動に失敗しました。node hooks/persona-stats.mjs を直接実行してください。';
    }
    emit('次の stats ブロックをコードフェンス内に原文どおり表示してください。他の文章は不要です。\n\n' + block);
    return;
  }

  if (!foreign && /^\/persona(?::persona)?(?:\s|$)/i.test(text)) {
    const parts = text.split(/\s+/).slice(1).filter(Boolean);
    const current = readFlag() || readPersistedState().state;

    // Bare /persona — report the roster and the current state, change nothing.
    if (parts.length === 0) {
      const active = resolveActive({ cwd: process.cwd(), sessionState: readFlag() });
      const state = active.enabled
        ? `${active.character.name}（${active.character.levels[active.level] || active.level}）`
        : '無効';
      emit(
        '次のペルソナ一覧をそのまま表示してください。他の文章は不要です。\n\n' +
        `現在: ${state}\n\n` +
        '```\n' + listCharacters(characters, active) + '\n```\n' +
        '\n切替: `/persona <キャラクター> <レベル>` / 一時切替: `/persona <キャラクター> 一時`' +
        ' / 解除: `/persona off`'
      );
      return;
    }

    const temporary = parts.some((p) => TEMPORARY_WORDS.has(p.toLowerCase()));
    const words = parts.filter((p) => !TEMPORARY_WORDS.has(p.toLowerCase()));

    if (words.some((p) => OFF_WORDS.has(p.toLowerCase()))) {
      emit(applySwitch({
        characters,
        next: { enabled: false, character: null, level: null },
        temporary,
      }));
      return;
    }

    let character = current.enabled ? current.character : null;
    let level = current.enabled ? current.level : DEFAULT_LEVEL;
    const unknown = [];

    for (const word of words) {
      const lower = word.toLowerCase();
      if (characters.has(lower)) {
        character = lower;
        continue;
      }
      const resolvedLevel = resolveLevelWord(word, characters);
      if (resolvedLevel) {
        level = resolvedLevel;
        continue;
      }
      unknown.push(word);
    }

    if (unknown.length) {
      emit(
        `指定された "${unknown.join(' ')}" はキャラクター名にもレベル名にも一致しません。` +
        '`/persona` で一覧を表示できることをユーザーに伝えてください。設定は変更していません。'
      );
      return;
    }

    if (!character || !isValidCharacterId(character) || !characters.has(character)) {
      emit('切替先のキャラクターを解決できませんでした。`/persona` で一覧を確認するよう伝えてください。');
      return;
    }

    emit(applySwitch({
      characters,
      next: { enabled: true, character, level },
      temporary,
    }));
    return;
  }

  // Not a /persona command: re-assert whatever is active, in one short line.
  const active = resolveActive({ cwd: process.cwd(), sessionState: readFlag() });
  if (!active.enabled || !active.character) return;

  const levelLabel = active.character.levels[active.level] || active.level;
  const reminder = active.character.reminder
    || `${active.character.name}の口調を維持。コード/コミット/PR/破壊的操作の確認は通常日本語。`;
  emit(`ペルソナ有効 (${active.character.name}/${levelLabel})。${reminder}`);
}

main();
