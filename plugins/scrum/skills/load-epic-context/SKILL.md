---
name: load-epic-context
description: Load a PBL Epic's working context — backlog snapshot, repo sync data, and the Epic summary — refreshing stale data first, so the conversation can start from the Epic's current state. Use when the user wants to load/open an Epic, asks "where are we on <Epic>", Epicをロード, or starts a session about a specific Epic's status.
---

# Load Epic Context

Prime the session with an Epic's current state at minimum token cost: refresh
the machine-managed data via scripts, then read only the aggregates —
`summary.md`, history, repo state — never the individual item files.

## Steps

1. **Confirm the Epic** (a monday.com group title mapped in `<scrum-context>`'s
   `mondayEpics`); ask if ambiguous.

2. **Refresh stale data.** Read `<epicFolder>/.pm/repo/repo-state.json`
   (`lastSyncAt`) and the newest `savedAt` in `.pm/backlog/items/` (one file is
   enough). If either is older than **60 minutes** — or missing — run:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/monday/save-all.mjs" "<groupName>"
   node "${CLAUDE_PLUGIN_ROOT}/scripts/repo/sync-repo.mjs" "<groupName>"
   ```
   Skip `sync-repo.mjs` when the Epic has no `repo` configured (it exits 2
   with a usage error in that case — not a failure of this skill). If either
   script reports a legacy `.snapshots/` layout, run
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/setup/migrate-epic-layout.mjs" "<groupName>"`
   once, then retry.

3. **Load the aggregates** — and only these:
   - `.pm/summary.md` — the maintained Epic summary (may not exist yet).
   - `.pm/backlog/progress-history.json` — last entry for totals/points/status
     mix; fall back to the `save-all.mjs` summary JSON from step 2.
   - `.pm/repo/repo-state.json`, `branch-diff.json`, and the **tail** of
     `commits.jsonl` (last ~20 lines) — epic branch, ahead/behind, recent
     activity.
   Do **not** read `items/*.json` one by one; that is the cost this layout
   exists to avoid. Open an individual item only if the user asks about it.

4. **Brief the user** (concise): Epic goal (from `summary.md`, else one line
   from `prd/prd.md`), backlog counts by status and total points, the epic
   branch and its ahead/behind vs the default branch, notable recent commits,
   and anything that obviously needs attention. Then ask what to work on —
   the context is now loaded for whatever follows (progress reports, audits,
   refinement, spikes…).

5. **Maintain `summary.md`.** If it is missing, or the briefing contradicts
   it (e.g. status mix or epic branch changed materially), offer to (re)write
   it: ~1 page — Epic goal, current state, key decisions, open risks — saved
   to `.pm/summary.md`. Keep it a summary, not a log; it is the cheap
   first-read for the next session and for the scheduled routine.

## Failure modes

- `MONDAY_TOKEN` missing → `save-all.mjs` exits 1; point to the plugin README.
- Epic not in `mondayEpics` → run `setup-scrum-context` or ask for the folder.
- No `repo` configured for the Epic → load backlog context only and say the
  repo view is unavailable; offer `setup-scrum-context` to add it.
- Legacy `.snapshots/` guard fires → run `migrate-epic-layout.mjs` (step 2).
