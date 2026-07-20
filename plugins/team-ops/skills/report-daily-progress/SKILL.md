---
name: report-daily-progress
description: Generate the daily progress report - PBI status board, burndown chart, and merges of the day - as a self-contained HTML file in the team-shared folder. Use in the daily routine, or when the user asks for today's progress report or a burndown chart.
---

# Daily progress report

Produce `projects/<p>/reports/daily/<date>.html` — the page the team opens
at stand-up.

## Steps

1. **Ensure fresh data** (token-free; run unless already run today):

   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/scripts/sync/sync-project-repos.mjs" <project>
   node "${CLAUDE_PLUGIN_ROOT}/scripts/snapshot/progress-snapshot.mjs" <project>
   ```

2. **Read the inputs**: `backlog/progress-history.jsonl` (all lines for the
   current sprint), `backlog/items/*` frontmatter, the current sprint's
   `scope.json` + `planning.md` (for scope-change notes), and each repo's
   `pbi-activity.json` + `commits.jsonl` tail (today's commits).
3. **Write one self-contained HTML file** (inline CSS/SVG, no external
   assets; text in the team content language):
   - **Header**: project, date, sprint id + goal, days remaining.
   - **Burndown (inline SVG)**: ideal line from `scope.json` total points →
     0 over the sprint dates vs actual `sprintRemainingPoints` per day from
     the history; annotate scope changes.
   - **Status board**: table of sprint items — id (linked to the item
     file), title, status, points, assignee, and dev activity (commit
     count / last merge from `pbi-activity.json` across repos).
   - **Merges of the day**: today's dev-main commits per repo, grouped by
     PBI id (unlinked commits listed under "other").
   - **Attention flags**: items in `doing` with no commits for several
     days, `review` items waiting, sync errors.
4. Save to `reports/daily/<date>.html` (overwrite same-day reruns), append
   an activity-log line, and give the user the path.
