---
name: prepare-sprint-review
description: Generate a sprint-review HTML document for a PBL Epic — done items with demo pointers, sprint metrics, and an agenda — from the monday.com board and its Drive snapshot. Use when the user wants sprint review material, a demo agenda, or to prepare for a sprint review / スプリントレビュー.
---

# Prepare Sprint Review

Turn what actually got Done into one self-contained HTML review document a
team can project during the sprint review.

## Steps

1. **Confirm the target.** Epic = one monday board group (from
   `<scrum-context>`'s `mondayEpics`; ask if ambiguous), plus the sprint
   window (default: since the previous review doc in `sprint-reviews/`, else
   the last 7 days).

2. **Refresh the data.** Run
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/monday/save-all.mjs" "<groupName>"`
   so `.pm/backlog/` is current, then read `.pm/backlog/items/*.json` for the
   group. Follow `manage-monday-backlog`'s "Epic snapshot layout" for the
   folder structure. Classify items: **Done** (demo candidates), moved but
   not done (progress), untouched (carry-over).

3. **Gather demo material per Done item.** From
   `pbi/<itemId>-<name>/`: `acceptance.md` for what "done" meant, and
   `evidence/` for proof. An item lacking both still goes in the review —
   marked "no recorded evidence" rather than silently polished over.
   - Completion criterion: every Done item in the window appears with either
     demo material or an explicit "no evidence" mark.

4. **Generate the HTML.** One self-contained `.html` (inline CSS/JS/SVG, no
   CDN); prose in the user's conversation language. Sections:
   1. **Header** — Epic, sprint window, date.
   2. **Sprint summary** — items done / in progress / carried over, points if
      the board tracks them, and an SVG status-distribution bar.
   3. **Agenda** — the Done items in a sensible demo order (dependency or
      story order), each with a time-box suggestion.
   4. **Per-item cards** — goal (from `acceptance.md`), what to demo
      (concrete steps), evidence links, and open caveats.
   5. **Not done** — carry-overs with a one-line reason each (from item
      updates where available; otherwise "reason not recorded").
   6. **Discussion prompts** — 2–3 questions the data raises (scope creep,
      recurring carry-over, unbalanced load).

5. **Save and report.** Write to
   `<epicFolder>/sprint-reviews/<yyyy-MM-dd>-sprint-review.html` (create the
   folder if missing). Resolve the file's real Drive link the same way as
   `report-pbl-progress` step 4 (Drive MCP `search_files` →
   `get_file_permissions`; if not yet synced, say the link is pending).
   Report the path/link and the done/carry-over counts. **This skill does not
   post to Slack** — hand the summary + link to `post-to-slack` as a separate
   step if the user wants it shared.

## Failure modes

- Epic not in `mondayEpics` → run `setup-scrum-context` or ask for the folder
  explicitly.
- `save-all.mjs` fails (no `MONDAY_TOKEN`, exit 1) → point to the plugin
  README; a stale snapshot may still be usable — ask before proceeding on it.
- Zero Done items in the window → still generate the doc; a review of "what
  blocked us" is a legitimate sprint review.
