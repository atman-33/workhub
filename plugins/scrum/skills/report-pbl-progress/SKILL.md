---
name: report-pbl-progress
description: Generate a PBL Epic's progress & completion-forecast HTML report from its Drive snapshot. Use when the user wants a progress/status report, or a burndown/completion forecast for a PBL Epic.
disable-model-invocation: true
---

# Report PBL Epic progress

One script call turns an Epic's Drive snapshot into a progress &
completion-forecast HTML report — no manual JSON parsing or point arithmetic
needed.

## Steps

1. Confirm the target Epic (the monday.com group title) from the
   conversation; ask the user if it isn't already clear.
2. Run once:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/report/generate-progress-report.mjs" "<groupName>"
   ```
   The snapshot root auto-resolves from `mondayEpics["<groupName>"]` in
   `.claude/scrum-context.json` (the same resolution `save-all.mjs` uses).
   Pass `--snapshot-root <path>` explicitly only when not configured there.
   Pass `--fallback-velocity <n>` / `--sprint-days <n>` to override the
   default assumed velocity (6pt per 7-day sprint) — this is only used when
   there isn't yet enough snapshot history to measure a real one.
3. The script's JSON summary (`totalItems`, `totalPoints`, `byStatus`,
   `forecast`, `reportPath`) is everything you need — **do not re-derive the
   aggregation by reading individual item files**, that's exactly the cost
   this skill exists to avoid.
4. Resolve the report's Google Drive link and confirm sharing before handing
   it back: `search_files({query: "title contains '<reportFileName>'"})` →
   `get_file_permissions({fileId})` on the Google Drive MCP connector. If the
   file (or its parent folder) has no permissions beyond the owner, say so
   plainly rather than assuming it's shared — Drive sharing must be changed
   by the user; no tool here can do it.
5. Report the KPIs, completion forecast, and Drive link back to the user.
   **This skill does not post to Slack.** If the user wants the report
   shared there, hand its JSON summary + Drive link to the `post-to-slack`
   skill (in the `productivity` plugin) as a separate step — that keeps this
   skill's completion criterion to "report generated, link known," which
   also lets it run unattended from a scheduled routine without needing to
   ask whether/where to post.

## Reference

See `manage-monday-backlog`'s "Epic snapshot layout" section for the
`.pm/backlog/items/*.json` structure this script reads.

### CLI flags

| Flag | Default | Purpose |
|------|---------|---------|
| `--snapshot-root <path>` | resolved from `mondayEpics[groupName]` + `.pm/backlog` | Where to read `items/*.json` and write the report + history |
| `--fallback-velocity <n>` | `6` | Assumed points/sprint, used only when history has fewer than 2 entries or a non-positive measured slope |
| `--sprint-days <n>` | `7` | Sprint length in days, for both the assumed and measured velocity |

The script also maintains `<snapshotRoot>/progress-history.json` — one entry
per calendar day, upserted so re-running the same day never duplicates an
entry. Once at least 2 days of history exist, the forecast switches from the
assumed velocity to one measured from that history (least-squares regression
once there are 3+ days). The JSON output's `forecast.assumed` flag says
which was used — never present an assumed forecast as measured.

### Failure modes

- **`items/` directory not found** (exit 2): the Epic hasn't been
  snapshotted yet — run `snapshot-pbl-to-drive` first.
- **No items matched the group** (exit 3): the group name doesn't match any
  `group` field in the snapshot; confirm the exact monday.com group title
  with the user (case-sensitive).
- **Epic not in `.claude/scrum-context.json`**: pass `--snapshot-root`
  explicitly, or add the Epic to `mondayEpics` via `setup-scrum-context`.
- **Stale leftover items inflate the totals**: `save-all.mjs` never deletes
  old `items/<id>.json` files for items that later left the group (renamed
  away, deleted, or a stale placeholder row cleaned up on the board) — this
  script only counts items whose `savedAt` falls within 15 minutes of the
  most recent snapshot run for that group, so older leftover files are
  silently excluded from the count. If totals still look off, check for old
  un-pruned files in `items/`.
- **"Done" detection is literal**: matched case-sensitively against the
  status label `"Done"`. A board using a different completion label needs
  the script's `DONE_LABEL` constant updated to match.
