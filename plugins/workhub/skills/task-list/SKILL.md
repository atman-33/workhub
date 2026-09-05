---
name: task-list
description: List, filter and file tasks on the workhub vault task board. Use when the user asks what tasks exist, what is assigned to the AI, what is in progress, wants to pick a task to work on, or says to put something on the board for later.
argument-hint: "[status] [assignee] [project]"
---

# task-list — List and file tasks on the workhub vault board

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

Listing is read-only apart from the index refresh: it never modifies an
existing task file.

## Create a task

For "put this on the board", "make that a task", "後でやるからタスクにしといて" —
touching the board without starting any work, which is why it lives here.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/task-cli.mjs" create \
  --title "..." [--project p] [--assignee a] [--priority p] [--status s] \
  [--due YYYY-MM-DD] [--model m] [--tags a,b] [--confirm] [--worktree] \
  [--body-file path] [--json]
```

The CLI assigns the `id` and `order` the same way the app does and refreshes
the index, so never hand-write a task file to get around it.

- `--status` defaults to `inbox`; use `todo` when the owner means to do it,
  `inbox` when it is only an idea. `done` is refused — a human sets that.
- `--assignee` defaults to `me`. Use `claude-code` only when the task is meant
  for an agent to pick up.
- Write the Description to a file and pass `--body-file` rather than trying to
  fit prose into a shell argument. Say what the task is *for* — the goal, the
  target repository, what to read first — not a list of edits.
- Report the id and the file path back, and stop there. Creating a task is not
  permission to start it; `task-start` is a separate decision.

A follow-up you found while finishing another task belongs to `task-report`
instead — it has the criteria for splitting one out and what its Description
has to carry.
