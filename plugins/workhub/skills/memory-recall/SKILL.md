---
name: memory-recall
description: Search the workhub long-term memory database for past conversations - by keyword over any time range, or list the most recent sessions. Use when the user asks what was discussed or decided before, says "recall", "思い出して", or wants to check past session context beyond what was auto-injected.
argument-hint: "[query] [days]"
---

# memory-recall — Search past conversations

Long-term memory stores every session's Q&A pairs in
`<vault>/_ai/memory/memory.db`. Hybrid search (FTS5 keyword + local vector
embeddings, RRF fusion, time decay) runs fully locally via the engine CLI.

## Steps

1. Parse the arguments: a free-text query and an optional day window.
   No arguments → show the recent timeline instead of searching.

2. Run the engine CLI:

   ```bash
   # recent timeline (no query)
   node "${CLAUDE_PLUGIN_ROOT}/memory-engine/cli.mjs" recent --limit 20

   # search all time
   node "${CLAUDE_PLUGIN_ROOT}/memory-engine/cli.mjs" recall "<query>" --limit 5

   # search the last N days only
   node "${CLAUDE_PLUGIN_ROOT}/memory-engine/cli.mjs" recall "<query>" --days 30 --limit 5
   ```

   Add `--full` to print untruncated texts when the clipped output is not
   enough to answer.

3. **Synthesize, don't dump**: answer the user's actual question from the
   results, citing dates (and task ids when present). Quote raw chunks only
   when the wording itself matters.

4. If there are no hits, widen the window stepwise (30 → 90 → 180 days →
   all time) before concluding the topic was never discussed.

## Notes

- If the CLI reports the engine is not set up, run the `memory-setup`
  skill first (or tell the user to).
- Also works from OpenCode or a plain terminal — it is just a Node CLI.
