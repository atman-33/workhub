// UserPromptSubmit hook: inject long-term memory context into the session.
//   - first prompt of a session: time summary + elapsed-days reminder
//   - every prompt: memories relevant to the prompt (hybrid search over the
//     last 7 days, relevance-gated so weak matches inject nothing)
// Silent no-op when the memory engine is not set up on this machine.
import { readFileSync, writeFileSync } from "node:fs";
import { readPayload } from "./lib.mjs";

// Cosine-distance gate for vector hits. FTS hits (distance=null) pass — a
// literal keyword match is meaningful on its own.
// Ruri v3 (q8) produces a compressed distance scale: measured ~0.19 for
// clearly related chunks vs ~0.22 for unrelated ones, so the gate sits just
// under the unrelated baseline. Retune here if the model changes.
const DISTANCE_MAX = 0.2;
const INJECT_LIMIT = 5;
const MIN_PROMPT_LEN = 3;

try {
  const paths = await import("../memory-engine/lib/paths.mjs");
  if (!paths.readMarker()) process.exit(0);

  const vault = paths.resolveVault();
  if (!vault) process.exit(0);

  const { loadSqlite } = await import("../memory-engine/lib/deps.mjs");
  const sqlite = loadSqlite();
  if (!sqlite) process.exit(0);

  const payload = readPayload();
  const prompt = payload.prompt ?? "";
  const sessionId = payload.session_id ?? "";

  const dbLib = await import("../memory-engine/lib/db.mjs");
  const format = await import("../memory-engine/lib/format.mjs");
  const db = dbLib.openDb(paths.dbPathForVault(vault), sqlite);
  const blocks = [];
  try {
    dbLib.initDb(db);
    const stats = dbLib.getStats(db);

    // Time summary + reminder only on the session's first prompt — repeating
    // them every turn wastes context.
    if (sessionId && isFirstPromptOfSession(sessionId, paths.INJECT_STATE_PATH)) {
      blocks.push(format.timeSummary(stats));
      const rem = format.reminder(format.daysSinceLast(stats));
      if (rem) blocks.push(rem);
    }

    if (prompt.length >= MIN_PROMPT_LEN && stats.total_memories > 0) {
      const memories = await searchWithFallback(db, prompt, dbLib);
      const relevant = memories
        .filter((m) => m.distance === null || m.distance <= DISTANCE_MAX)
        .slice(0, INJECT_LIMIT);
      if (relevant.length) blocks.push(format.formatMemories(relevant));
    }

    const { maybeTriggerEmbed } = await import("../memory-engine/lib/background.mjs");
    maybeTriggerEmbed(db);
  } finally {
    db.close();
  }

  if (blocks.length) console.log(blocks.join("\n\n"));
} catch (err) {
  console.error(`[workhub-memory] inject skipped: ${err.message}`);
}
process.exit(0);

/** True exactly once per session id (state survives across prompts). */
function isFirstPromptOfSession(sessionId, statePath) {
  let state = {};
  try {
    state = JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    // first ever run
  }
  if (state.session_id === sessionId) return false;
  try {
    writeFileSync(statePath, JSON.stringify({ session_id: sessionId }));
  } catch {
    // state not persisted — better to repeat the summary than to fail
  }
  return true;
}

/**
 * Hybrid search over the last 7 days; falls back to FTS-only (with time
 * decay) when the embedding model cannot run (e.g. model cache missing).
 */
async function searchWithFallback(db, prompt, dbLib) {
  try {
    const { searchRecent } = await import("../memory-engine/lib/retriever.mjs");
    return await searchRecent(db, prompt, { limit: INJECT_LIMIT });
  } catch {
    const since = Date.now() / 1000 - 7 * 86400;
    const { timeDecay } = await import("../memory-engine/lib/retriever.mjs");
    return dbLib
      .ftsSearch(db, prompt, { limit: 20, since })
      .map((r) => ({ ...r, distance: null, score: timeDecay(r.created_at, 30) }))
      .sort((a, b) => b.score - a.score);
  }
}
