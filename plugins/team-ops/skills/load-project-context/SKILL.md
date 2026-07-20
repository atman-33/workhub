---
name: load-project-context
description: Prime a session with a team project's current state - backlog, sprint, repo progress - and refresh its _index.md summary. Use when the user asks "where are we" on a team project, or at the start of a work session on one.
---

# Load a project's context

Brief the user (and this session) on the project's current state at minimum
token cost: read aggregates first, raw data only when asked.

## Steps

1. Resolve the project from `<team-context>` (ask if several are active).
2. **Refresh stale data when cheap** (both are token-free scripts; run them
   if the last sync is older than ~1 day):

   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/scripts/sync/sync-project-repos.mjs" <project>
   node "${CLAUDE_PLUGIN_ROOT}/scripts/snapshot/progress-snapshot.mjs" <project>
   ```

3. **Read the aggregates** (not the raw item files):
   `_index.md`, `product-backlog.md`, the latest `progress-history.jsonl`
   line, each repo's `repo-state.json` + `diff-vs-default.json`, and the
   current sprint's `planning.md`.
4. **Brief the user** (their language): sprint goal and remaining points,
   items in `doing`/`review`, dev-main branch positions vs default, and
   anything unusual (stale sync, items stuck, scope changes).
5. **Maintain the summary**: update the current-state section of the
   project's `_index.md` (team content language, ~10 lines) when it has
   drifted from reality, so the next session starts even cheaper. Append an
   activity-log line when you do.
