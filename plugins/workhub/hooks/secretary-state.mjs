// Shared state for the secretary hooks.
//
// The gate hook has to know whether *this* session already consulted the
// secretary before it lets a question through to the owner. Sessions are
// separate processes, so the answer lives in a small per-session file under
// `~/.workhub/secretary/`.
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const STATE_DIR = join(homedir(), ".workhub", "secretary");
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Number of times the gate may block one session before it gives up. */
export const MAX_BLOCKS = 2;

function statePath(sessionId) {
  const safe = String(sessionId || "default").replace(/[^A-Za-z0-9._-]/g, "_");
  return join(STATE_DIR, `${safe}.json`);
}

export function readState(sessionId) {
  try {
    return JSON.parse(readFileSync(statePath(sessionId), "utf8"));
  } catch {
    return { consulted: false, blocks: 0 };
  }
}

export function writeState(sessionId, state) {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(statePath(sessionId), JSON.stringify(state));
    pruneOldStates();
  } catch {
    // State is an optimization, not a guarantee — never fail the hook over it.
  }
}

/** Drop state files from sessions that ended long ago. */
function pruneOldStates() {
  const cutoff = Date.now() - MAX_AGE_MS;
  try {
    for (const name of readdirSync(STATE_DIR)) {
      const file = join(STATE_DIR, name);
      if (statSync(file).mtimeMs < cutoff) rmSync(file, { force: true });
    }
  } catch {
    // ignore
  }
}
