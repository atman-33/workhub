---
name: task-list
description: List and filter tasks from the workhub vault task board. Use when the user asks what tasks exist, what is assigned to the AI, what is in progress, or wants to pick a task to work on.
argument-hint: "[status] [assignee] [project]"
---

# task-list — List tasks from the workhub vault

## Preferred: run the task CLI

Run the bundled CLI — it resolves the vault, scans the task frontmatter
directly (never a stale index), refreshes `_ai/index/tasks.json`, and prints
a table:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/task-cli.mjs" list [--status s] [--assignee a] [--project p] [--json]
```

Vault resolution order (built into the CLI; pass `--vault <path>` to
override): `WORKHUB_VAULT` env var → **the current directory if it is a
vault** (has `tasks/` and `_ai/`) → `vault_path` in
`%APPDATA%\workhub\config.json`. If none resolves, ask the user.

## Fallback: manual read (no node, or script missing)

1. Resolve the vault with the same order as above.
2. Read the YAML frontmatter of every `*.md` under `<vault>/tasks/`
   (skip `_index.md`). Do not trust `_ai/index/tasks.json` blindly — it can
   be stale when files were hand-edited without the app running.

## Present

- Default view: everything not `done` and not `archived` (the optional
  `archived` boolean field; absent = false), grouped by `status` in board
  order (`inbox`, `todo`, `doing`, `review`), sorted by `priority` (high
  first) then `due`. Include archived tasks only when the user explicitly
  asks for them.
- Present as a compact table: `id | title | status | assignee | project | due`.
- Mention tasks assigned to `claude-code` explicitly — those are candidates
  for `task-start`.

Read-only apart from the index refresh: this skill never modifies task files.
