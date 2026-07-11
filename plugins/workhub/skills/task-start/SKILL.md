---
name: task-start
description: Start working on a workhub task - mark it doing, load its description as working context, and resolve the target repository. Use when the user says to start/work on a task by id or title, or after picking one via task-list.
argument-hint: "<task-id>"
---

# task-start — Begin a task from the workhub vault

## Steps

1. **Resolve the vault path** (same order as `task-list`: `WORKHUB_VAULT` env
   var, then `vault_path` in `%APPDATA%\workhub\config.json`).
2. **Locate the task file** in `<vault>/tasks/` by the `id` in its
   frontmatter (use `_ai/index/tasks.json` to find the file quickly).
3. **Validate the transition.** Only `inbox`, `todo` (or already `doing`)
   tasks can be started. Never touch a `review` or `done` task; report and
   stop instead.
4. **Update frontmatter** — set `status: doing` and `updated: <today>`.
   Change nothing else; preserve the body byte-for-byte.
5. **Record the active task** for the stop-hook reminder: write
   `<vault>/_ai/memory/active-task.json` with
   `{ "id", "file", "started": "<ISO timestamp>" }`.
6. **Load context.** Read the task body — `## Description` is the task
    description and acts as the prompt/spec. Follow links it contains.
7. **Resolve the target repository** from the `project` frontmatter key:
   - If it's an absolute path, use it directly.
   - Otherwise look for `C:/repos/<project>`.
   - If it cannot be resolved, ask the user.
8. **Begin the work** in the target repository, following that repo's own
   instructions (CLAUDE.md etc.).

## Rules

- Allowed status transitions for AI: `inbox/todo → doing` only.
- When the work is finished, always finish with the `task-report` skill —
  do not edit the task's `## Results` or status directly here.
