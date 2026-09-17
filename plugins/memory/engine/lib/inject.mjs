// Builds the memory-injection context block for one prompt: the past
// conversations relevant to it (hybrid search over the last 7 days,
// relevance-gated so weak matches inject nothing).
//
// The opening summary lives in the SessionStart brief instead — a session is
// told where things stand before its first prompt, not in the middle of
// answering it.
// Shared by the Claude Code UserPromptSubmit hook and the OpenCode plugin
// (via `cli.mjs inject`).
import { ftsSearch, getStats } from "./db.mjs";
import { timeDecay, searchRecent } from "./retriever.mjs";
import { formatMemories } from "./format.mjs";

// Cosine-distance gate for vector hits. FTS hits (distance=null) pass — a
// literal keyword match is meaningful on its own.
// Ruri v3 (q8) produces a compressed distance scale: measured ~0.19 for
// clearly related chunks vs ~0.22 for unrelated ones, so the gate sits just
// under the unrelated baseline. Retune here if the model changes.
const DISTANCE_MAX = 0.2;
const INJECT_LIMIT = 5;
const MIN_PROMPT_LEN = 3;

/**
 * Hybrid search over the last 7 days; falls back to FTS-only (with time
 * decay) when the embedding model cannot run (e.g. model cache missing).
 */
async function searchWithFallback(db, prompt) {
  try {
    return await searchRecent(db, prompt, { limit: INJECT_LIMIT });
  } catch {
    const since = Date.now() / 1000 - 7 * 86400;
    return ftsSearch(db, prompt, { limit: 20, since })
      .map((r) => ({ ...r, distance: null, score: timeDecay(r.created_at, 30) }))
      .sort((a, b) => b.score - a.score);
  }
}

/**
 * Returns the injection text for this prompt, or "" when there is nothing
 * worth injecting. `db` must be an open, initialized database.
 */
export async function buildInjection(db, { prompt = "" } = {}) {
  const blocks = [];
  const stats = getStats(db);

  // The opening summary, the elapsed-days reminder and the capture health line
  // moved to the SessionStart brief (T-0369), which is where "what you should
  // know before you start" belongs. What is left here is the one thing that
  // genuinely depends on the prompt.
  if (prompt.length >= MIN_PROMPT_LEN && stats.total_memories > 0) {
    const memories = await searchWithFallback(db, prompt);
    const relevant = memories
      .filter((m) => m.distance === null || m.distance <= DISTANCE_MAX)
      .slice(0, INJECT_LIMIT);
    if (relevant.length) blocks.push(formatMemories(relevant));
  }

  return blocks.join("\n\n");
}
