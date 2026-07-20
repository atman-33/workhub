// Background embedding trigger. Embedding is far too slow for a hook, so
// when enough un-embedded rows pile up we spawn a detached
// `cli.mjs embed-pending` process, serialized by a lock file.
import { spawn } from "node:child_process";
import { existsSync, statSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { LOCK_PATH } from "./paths.mjs";
import { pendingCount } from "./db.mjs";

export const EMBED_THRESHOLD = 30;
const LOCK_STALE_MS = 30 * 60 * 1000;

const CLI_PATH = join(fileURLToPath(new URL("..", import.meta.url)), "cli.mjs");

/** True when a live (non-stale) lock exists. Stale locks are removed. */
export function embedLocked() {
  if (!existsSync(LOCK_PATH)) return false;
  if (Date.now() - statSync(LOCK_PATH).mtimeMs < LOCK_STALE_MS) return true;
  // Older than the stale window — assume the process died and clear it.
  try {
    unlinkSync(LOCK_PATH);
  } catch {
    // another process may have removed it first
  }
  return false;
}

/**
 * Spawn a detached embed-pending run when the backlog crosses the threshold
 * and no other run is in flight. Returns the pending count that triggered
 * the spawn, or 0 when nothing was started.
 */
export function maybeTriggerEmbed(db) {
  if (embedLocked()) return 0;
  const pending = pendingCount(db);
  if (pending < EMBED_THRESHOLD) return 0;
  const child = spawn(process.execPath, [CLI_PATH, "embed-pending", "--all"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  return pending;
}
