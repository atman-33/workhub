---
name: task-start
description: Start working on a workhub task - mark it doing, load its description as working context, and resolve the target repository. Use when the user says to start/work on a task by id or title, or after picking one via task-list.
argument-hint: "<task-id>"
---

# task-start — Begin a task from the workhub vault

## Steps

1. **Mark the task as started** with the bundled CLI (preferred — it
   validates the status transition, sets `status: doing` + `updated`,
   writes the active-task marker, and refreshes the index in one step):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/task-cli.mjs" start <task-id>
   ```

   Vault resolution order (pass `--vault <path>` to override):
   `WORKHUB_VAULT` env var → the current directory if it is a vault (has
   `tasks/` and `_ai/`) → `vault_path` in `%APPDATA%\workhub\config.json`.
   The CLI refuses `review`/`done` tasks — report and stop in that case.

   *Fallback (no node, or script missing):* edit the task file by hand —
   set `status: doing` and `updated: <today>` in the frontmatter (preserve
   the body byte-for-byte; never start `review`/`done`/`archived` tasks),
   and write `<vault>/_ai/memory/active-task.json` with
   `{ "id", "file", "started": "<ISO timestamp>" }`.

2. **Load context.** Read the task body — `## Description` is the task
   description and acts as the prompt/spec. Follow links it contains.
3. **Resolve the target repository** from the `project` frontmatter key:
   - If it's an absolute path, use it directly.
   - Otherwise look for `C:/repos/<project>`.
   - If it cannot be resolved, ask the user.
4. **Set up a git worktree — only when the task opts in** (`worktree: true`
   in the frontmatter, which the app also states in the launch prompt).
   Isolating parallel tasks in their own worktree keeps them from colliding
   on one working tree. When enabled:
   - Create the worktree under the repository's parent directory, grouped by
     repo name and keyed by task id, on a task branch:

     ```bash
     git -C <repo> worktree add "<repo>/../.worktrees/<repo-name>/<task-id>" -b task/<task-id>
     ```

     e.g. for repo `C:/repos/workhub` and task `T-0017` →
     `C:/repos/.worktrees/workhub/T-0017` on branch `task/T-0017`.
   - If the worktree or branch already exists (a resumed task), reuse it
     instead of recreating (`git -C <repo> worktree list` to check; drop the
     `-b` flag and point at the existing path/branch).
   - Do **all** of the task's work inside that worktree path — treat it as the
     repository root for the rest of the task.
   When `worktree` is unset/false, work directly in the resolved repository as
   before.
5. **Begin the work** in the target repository (or its worktree), following
   that repo's own instructions (CLAUDE.md etc.).

## Rules

- Allowed status transitions for AI: `inbox/todo → doing` only.
- When the work is finished, always finish with the `task-report` skill —
  do not edit the task's `## Results` or status directly here.
