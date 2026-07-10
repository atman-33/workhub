---
name: task-list
description: List and filter tasks from the workhub vault task board. Use when the user asks what tasks exist, what is assigned to the AI, what is in progress, or wants to pick a task to work on.
argument-hint: "[status] [assignee] [project]"
---

# task-list — List tasks from the workhub vault

## Resolve the vault path

1. If the `WORKHUB_VAULT` environment variable is set, use it.
2. Otherwise read `vault_path` from `%APPDATA%\workhub\config.json`.
3. If neither exists, ask the user for the vault path.

## Read tasks

1. Prefer the machine index: `<vault>/_ai/index/tasks.json` — a JSON array of
   all task frontmatter objects plus `file` (path relative to the vault).
2. If the index is missing or stale (parse error), fall back to reading the
   YAML frontmatter of every `*.md` under `<vault>/tasks/` (skip `_index.md`).

## Filter and present

- Apply any filters given in the arguments (`status`, `assignee`, `project`).
- Default view: everything not `done`, grouped by `status` in board order
  (`inbox`, `todo`, `doing`, `review`), sorted by `priority` (high first)
  then `due`.
- Present as a compact table: `id | title | status | assignee | project | due`.
- Mention tasks assigned to `claude-code` explicitly — those are candidates
  for `task-start`.

Read-only: this skill never modifies the vault.
