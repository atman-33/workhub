---
name: snapshot-pbl-to-drive
description: Snapshot a monday.com PBL Epic's items (PBIs), docs, and updates into its mapped Google Drive folder in one script run.
disable-model-invocation: true
---

# Snapshot a PBL Epic to Drive

One script call refreshes an entire Epic's Google Drive snapshot — no per-item
tool calls needed.

## Steps

1. Confirm the target Epic (the monday.com group title) from the conversation;
   ask the user if it isn't already clear.
2. Run once:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/monday/save-all.mjs" "<groupName>"
   ```
   `boardId` and the Drive folder path auto-resolve from `mondayBoardId` /
   `mondayEpics["<groupName>"]` in `.claude/scrum-context.json`. Only pass them
   explicitly (`save-all.mjs <boardId> "<groupName>" <epicFolderPath>`) when
   not configured there.
3. Report the script's JSON summary (`itemCount`, `itemsSaved`, `docsSaved`,
   `updatesSaved`, `prd`, `errors`) back to the user. **Do not open or verify
   individual snapshot files** — reading them one by one is exactly the
   token cost this skill exists to avoid. Only investigate further if
   `errors` is non-empty or the user asks for detail on a specific item.

## Reference

This runs the same `save-all.mjs` script documented in the `manage-monday-backlog`
skill — see that skill's "Epic snapshot layout" section for the folder
structure produced (`.pm/backlog/`, `prd/`) and its "Failure modes" section for
`MONDAY_TOKEN` / board / group errors. This skill only adds a dedicated
trigger for snapshot/backup-to-Drive requests; it does not change behaviour.

Once a snapshot exists, the `report-pbl-progress` skill turns it into a progress & completion-forecast HTML report — a natural next step after snapshotting.
