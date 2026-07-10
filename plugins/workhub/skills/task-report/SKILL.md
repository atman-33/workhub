---
name: task-report
description: Record the results of a workhub task - store the raw report in the vault AI zone, polished notes in the human zone, update the task's result section, and set status to review. Use when finishing work started via task-start, or when the user asks to report/close out a task.
argument-hint: "<task-id>"
---

# task-report — Record task results into the workhub vault

## Steps

1. **Resolve the vault path** (`WORKHUB_VAULT` env var, then `vault_path` in
   `%APPDATA%\workhub\config.json`) and locate the task file by `id`.
2. **Write the raw report** to `<vault>/_ai/logs/<task-id>-<yyyymmdd>.md`:
   what was done, key decisions, files changed (as `path:line` references),
   verification results, and anything a future agent needs to resume.
3. **Write human-readable deliverables** where they belong:
   - Knowledge gained (research, gotchas, how-tos) → a note under
     `<vault>/knowledge/`, added to `knowledge/_index.md`.
   - Project-specific outcomes → a note under `<vault>/projects/`.
   - Keep these polished and short; link to the raw log with a wikilink
     only if the detail matters.
4. **Update the task file**:
   - Append to the `## 結果` section: a 2-4 line summary and wikilinks to the
     notes created in step 3.
   - Set `status: review` and `updated: <today>` in the frontmatter.
   - Change nothing else; preserve the rest of the body.
5. **Clear the active-task marker** — delete
   `<vault>/_ai/memory/active-task.json` if it refers to this task.

## Rules

- AI never sets `status: done` — a human does that in the workhub app after
  reviewing.
- If the work is incomplete or blocked, still report: describe the blocker in
  `## 結果`, keep `status: doing`, and leave the active-task marker in place.
- Do not overwrite existing human notes; create new ones and link them.
