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

2. **Load context.** Read the task body:
   - `## Description` is the task description and acts as the prompt/spec.
     Follow links it contains.
   - `## Plan`, when non-empty, is an **approved implementation plan** — most
     often written in an earlier session that ran out of context, or by a
     different agent CLI. Treat it as settled: follow it instead of
     re-planning, say so up front, and ask before deviating from it.
   - **Pick up answers waiting for this task.** A question filed for the owner
     lives in `<vault>/_ai/comms/`; the answer arrives asynchronously, so a
     resumed task must read it before doing anything else:

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/scripts/comms-cli.mjs" list --status answered --task <task-id>
     ```

     Read each listed file's `## Answer`, act on it, and clear the block with
     `task-cli.mjs update <task-id> --blocked false`. Questions still
     `pending` are unanswered — do not ask them again.

     **Then feed the answer back.** For each answer, append one entry to
     `<vault>/profile/decision-log.md` under `## Decisions`:
     `- <date> <task-id> <the rule this establishes>` with
     `(from: <question-id>)` on the next line. If the answer is a standing
     leaning rather than a one-off call, put it in
     `<vault>/profile/decision-policy.md`'s `## Preferences` instead; if the
     same reasoning has now settled a second question, promote it to that
     note's `## Promoted rules` as an axis. Say which you chose. An answer
     that is not written back gets asked again next time, which is the whole
     problem the policy exists to solve.
3. **Resolve the target repository through the project.** The task's
   `project` key names a vault project (`projects/<slug>/`), not a
   repository — the two do not share a naming scheme, so never guess a path
   from the slug.
   - Read `repos:` from `projects/<slug>/_index.md`. Each entry is an
     absolute path or a repository name as registered in the app
     (`.claude/project-context.json`); resolve a name through that file.
   - One entry: use it. Several: use the one the task's `## Description`
     names, and otherwise **the first entry**, which is the project's
     default. Say which one you picked.
   - When `project` is empty, read the target repository out of the task's
     `## Description` (tasks state it as `**対象リポジトリ:** <path>`).
   - If it still cannot be resolved, ask the user.
4. **Set up a git worktree — only when the task opts in** (`worktree: true`
   in the frontmatter, which the app also states in the launch prompt).
   Isolating parallel tasks in their own worktree keeps them from colliding
   on one working tree. When enabled:
   - Create the worktree under the repository's parent directory, grouped by
     task id and keyed by repo name, on a task branch:

     ```bash
     git -C <repo> worktree add "<repo>/../.worktrees/<task-id>/<repo-name>" -b task/<task-id>
     ```

     e.g. for repo `C:/repos/workhub` and task `T-0017` →
     `C:/repos/.worktrees/T-0017/workhub` on branch `task/T-0017`.
     Grouping by task id keeps a multi-repo task's worktrees together under
     one `.worktrees/<task-id>/` folder (one sub-folder per repo).
   - If the worktree or branch already exists (a resumed task), reuse it
     instead of recreating (`git -C <repo> worktree list` to check; drop the
     `-b` flag and point at the existing path/branch).
   - Do **all** of the task's work inside that worktree path — treat it as the
     repository root for the rest of the task.
   When `worktree` is unset/false, work directly in the resolved repository as
   before.
5. **Record an approved plan — only for plan-first tasks** (`confirm: true`,
   or whenever the user approves a plan before implementation). Once the plan
   is approved and **before making any code changes**, write it into the task
   file's `## Plan` section. Writing it afterwards defeats the point: the
   section exists so an approved plan survives a session that dies mid-way.
   - Append; never rewrite an approved plan in place — the section doubles as
     the user's approval record.
   - Change nothing else in the body.
   - If `## Plan` was already non-empty, you are executing a recorded plan
     (step 2) and should not be writing a new one.
6. **Begin the work** in the target repository (or its worktree), following
   that repo's own instructions (CLAUDE.md etc.).

## Rules

- Allowed status transitions for AI: `inbox/todo → doing` only.
- Before interrupting the owner with a question, consult the `secretary`
  subagent; file what it escalates with `scripts/comms-cli.mjs ask` and mark
  the task blocked instead of waiting on the terminal.
- When the work is finished, always finish with the `task-report` skill —
  do not edit the task's `## Results` or status directly here.
- The language of `## Plan` and `## Results` follows the workhub **Task
  language** setting, stated in the app's launch prompt (default English). It
  governs those two sections only — never code, comments, commit messages, or
  repository documentation.
