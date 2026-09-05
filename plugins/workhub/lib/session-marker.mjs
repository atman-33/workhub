// The per-session active-task marker.
//
// A marker records which workhub task a single agent session is working, and
// how to reach that session from another one. It lives at
// `<vault>/_ai/memory/sessions/<session-key>.json`.
//
// It used to be one shared `<vault>/_ai/memory/active-task.json`, which broke
// as soon as two sessions ran at once: the second `task-start` overwrote the
// first one's marker, so the Stop-hook reminder pointed at the wrong task and
// the memory engine filed a session's transcript under someone else's task id.
// One file per session removes the collision and, as a side effect, turns the
// folder into a directory of who is working what — which is what lets one
// session hand a finding to another (see `task-cli.mjs sessions`).
//
// Marker shape:
//
//   {
//     "session_id": "e41f45cd-…",        // the session key
//     "host_session_id": "local_49b4…",  // address for the desktop app's
//                                        // send_message; "" outside it
//     "id": "T-0243",
//     "file": "tasks/T-0243 ….md",       // vault-relative
//     "started": "2026-09-05T08:33:49.799Z",
//     "reminded": true                   // set by the Stop-hook reminder
//   }

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Claude Code exports both ids to every subprocess it spawns, so a hook and a
 * CLI run from the same session agree on the key without being told it.
 * Sessions that export neither (OpenCode, a bare terminal) share the single
 * `default` bucket — one marker, exactly as before, which is correct because
 * such a session cannot be addressed for messaging either.
 */
export function sessionKey(explicit) {
  const key = explicit || process.env.CLAUDE_CODE_SESSION_ID || "";
  return sanitizeKey(key) || "default";
}

/** The desktop app's own session id — the address `send_message` takes. */
export function hostSessionId() {
  return process.env.CLAUDE_CODE_HOST_SESSION_ID || "";
}

/** Keys become file names, so anything path-shaped has to go. */
function sanitizeKey(key) {
  return String(key).replace(/[^A-Za-z0-9._-]/g, "");
}

export function sessionsDir(vault) {
  return join(vault, "_ai", "memory", "sessions");
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

export function writeMarker(vault, key, data) {
  const file = markerPath(vault, key);
  mkdirSync(sessionsDir(vault), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return file;
}

/** Every marker in the vault, newest first. */
export function listMarkers(vault) {
  let names = [];
  try {
    names = readdirSync(sessionsDir(vault)).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  return names
    .map((n) => readMarker(vault, n.slice(0, -5)))
    .filter((m) => m && m.id)
    .sort((a, b) => String(b.started ?? "").localeCompare(String(a.started ?? "")));
}

/**
 * Drop every marker pointing at `taskId`, whichever session wrote it — a task
 * started in one session is routinely reported from another (a resume, or a
 * different agent CLI), and the marker that has to go is the stale one, not
 * necessarily this session's.
 *
 * Returns how many were removed.
 */
export function clearMarkersForTask(vault, taskId) {
  let removed = 0;
  let names = [];
  try {
    names = readdirSync(sessionsDir(vault)).filter((n) => n.endsWith(".json"));
  } catch {
    return 0;
  }
  for (const name of names) {
    const key = name.slice(0, -5);
    if (readMarker(vault, key)?.id !== taskId) continue;
    try {
      rmSync(markerPath(vault, key));
      removed += 1;
    } catch {
      // already gone — nothing to clear
    }
  }
  return removed;
}

/**
 * Remove the pre-T-0243 shared marker. It is never read any more, and leaving
 * it behind would leave a file that still looks authoritative.
 */
export function dropLegacyMarker(vault) {
  const legacy = join(vault, "_ai", "memory", "active-task.json");
  if (!existsSync(legacy)) return false;
  try {
    rmSync(legacy);
    return true;
  } catch {
    return false;
  }
}
