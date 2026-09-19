// The read half of the per-session active-task marker.
//
// A marker records which workhub task one agent session is working; it lives
// at `<ai-state-dir>/sessions/<session-key>.json` and is written by
// `task-cli start`. Capture reads it to file a session's chunks under the task
// *that* session is working — reading a shared marker used to file a transcript
// under whichever task happened to be started last, which under two parallel
// sessions was routinely the other one's (T-0243).
//
// This is a deliberate copy of the read path of
// `plugins/workhub/lib/session-marker.mjs`, which stays the source of truth
// (it also writes, lists and sweeps markers). Claude Code installs each plugin
// into a cache keyed by that plugin's version, so this plugin cannot import
// from the workhub plugin's directory: the relative path resolves in the
// repository and breaks on an installed copy. The marker's location and key
// derivation are therefore a *data contract* between the two plugins, and
// `copies.test.mjs` pins this copy against the original so the contract
// cannot drift silently. That includes `resolveAiStateDir` below, a second
// copy of the same T-0390 transitional folder resolver in
// `plugins/workhub/hooks/lib.mjs`.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The vault's `_ai/` working-data folder: `_ai/state/` if it exists, else
 * `_ai/memory/` if it exists (a vault not yet carried through the T-0390
 * rename), else `_ai/state/`. See the copy in `plugins/workhub/hooks/lib.mjs`
 * for the full rationale.
 */
function resolveAiStateDir(vault) {
  const state = join(vault, "_ai", "state");
  if (existsSync(state)) return state;
  const legacy = join(vault, "_ai", "memory");
  if (existsSync(legacy)) return legacy;
  return state;
}

/**
 * Claude Code exports its session id to every subprocess it spawns, so a hook
 * and a CLI run from the same session agree on the key without being told it.
 * Sessions that export neither id (OpenCode, a bare terminal) share the single
 * `default` bucket.
 */
export function sessionKey(explicit) {
  const key = explicit || process.env.CLAUDE_CODE_SESSION_ID || "";
  return sanitizeKey(key) || "default";
}

/** Keys become file names, so anything path-shaped has to go. */
function sanitizeKey(key) {
  return String(key).replace(/[^A-Za-z0-9._-]/g, "");
}

export function sessionsDir(vault) {
  return join(resolveAiStateDir(vault), "sessions");
}

export function markerPath(vault, key) {
  return join(sessionsDir(vault), `${sanitizeKey(key) || "default"}.json`);
}

/** The marker for one session, or null when it has no active task. */
export function readMarker(vault, key) {
  try {
    return JSON.parse(readFileSync(markerPath(vault, key), "utf8"));
  } catch {
    return null;
  }
}
