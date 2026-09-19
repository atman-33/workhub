// When `memory-reflect` last ran on this machine, and whether it is due again.
//
// The verbatim conversation lives only in this machine's `memory.db`. Until
// `memory-reflect` promotes what matters into `memory/notes/`, it exists
// nowhere else — lose the machine and it is gone. Nothing runs reflect on a
// schedule on purpose: an unattended job is one nobody looks at, so instead the
// session is told it is due and suggests it to the user (T-0386).
//
// Due means both: at least REFLECT_INTERVAL_DAYS since the last run, and at
// least one conversation captured after it. With nothing new to promote there
// is nothing to ask for.
//
// The stamp is machine-local, like capture health: it describes this
// machine's database, not the vault.
import { readFileSync, writeFileSync } from "node:fs";
import { injectSeenPath, readMarker, reflectStatePath } from "./paths.mjs";

export const REFLECT_INTERVAL_DAYS = 7;
const DAY = 86400;

/** @returns {{ lastReflectAt: number | null }} seconds since the epoch */
export function readReflectState() {
  try {
    const state = JSON.parse(readFileSync(reflectStatePath(), "utf8"));
    return { lastReflectAt: typeof state.lastReflectAt === "number" ? state.lastReflectAt : null };
  } catch {
    return { lastReflectAt: null };
  }
}

/** Record that reflect finished now. Called as the skill's last step. */
export function markReflected(now = Date.now() / 1000) {
  writeFileSync(reflectStatePath(), JSON.stringify({ lastReflectAt: now }, null, 2));
  return now;
}

/** When setup last ran on this machine, in seconds, or null. */
export function setupTime() {
  const at = Date.parse(readMarker()?.installedAt ?? "");
  return Number.isNaN(at) ? null : at / 1000;
}

const SEEN_LIMIT = 200;

/**
 * True the first time a session id is passed in, false after. Lets
 * `cli.mjs inject` — which OpenCode calls on every prompt — say something once
 * per session, the way the Claude Code SessionStart brief does. Keeps the most
 * recent SEEN_LIMIT ids; a state file that cannot be read counts as empty.
 */
export function firstPromptOf(sessionId) {
  if (!sessionId) return false;
  let seen = [];
  try {
    const parsed = JSON.parse(readFileSync(injectSeenPath(), "utf8"));
    if (Array.isArray(parsed)) seen = parsed;
  } catch {
    // no state yet
  }
  if (seen.includes(sessionId)) return false;
  seen.push(sessionId);
  try {
    writeFileSync(injectSeenPath(), JSON.stringify(seen.slice(-SEEN_LIMIT)));
  } catch {
    // Unwritable state means the line may repeat; never fail the prompt over it.
  }
  return true;
}

/**
 * One line asking for `memory-reflect`, or "" when it is not due.
 *
 * `since` stands in for the last run when reflect has never run on this
 * machine — the setup time, so a fresh install is not nagged on its first day.
 *
 * @param {{ last_session_at?: number | null } | null} stats the database summary
 * @param {{ since?: number | null, now?: number }} [opts]
 */
export function reflectDueLine(stats, { since = null, now = Date.now() / 1000 } = {}) {
  const lastSession = stats?.last_session_at;
  if (!lastSession) return "";
  const { lastReflectAt } = readReflectState();
  const base = lastReflectAt ?? since;
  if (base === null || base === undefined) return "";
  if (now - base < REFLECT_INTERVAL_DAYS * DAY) return "";
  if (lastSession <= base) return "";
  const days = Math.floor((now - base) / DAY);
  const when = lastReflectAt === null ? `セットアップから ${days} 日、一度も` : `前回から ${days} 日`;
  return (
    `📝 memory-reflect が${when}実行されていません（その後の会話あり）。` +
    `会話の逐語はこの PC にしか無いので、作業の区切りでユーザーに \`memory-reflect\` の実行を提案してください。自分では実行しないこと。`
  );
}
