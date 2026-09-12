---
name: task-start
description: Start working on a workhub task - mark it doing, load its description as working context, and resolve the target repository. Use when the user says to start/work on a task by id or title, or after picking one via task-list.
argument-hint: "<task-id>"
---

# task-start — Begin a task from the workhub vault

## Steps

1. **Mark the task as started** with the bundled CLI (preferred — it
   validates the status transition, sets `status: doing` + `updated`,
   writes this session's active-task marker, and refreshes the index in one
   step):

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
   and write `<vault>/_ai/memory/sessions/$CLAUDE_CODE_SESSION_ID.json` with
   `{ "session_id", "host_session_id", "id", "file", "started" }`.

   The marker is per session, so two tasks started at once no longer
   overwrite each other's — and the folder doubles as the directory of who
   is working what (see *Handing information to another session* below).

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
3. **Settle the backlog item, then load it.** A task's `backlog` frontmatter
   key is `B-NNN` in `projects/NNNN-<project>/backlog/`. It is where everything
   this task produces will go, so it has to be decided before the work starts,
   not after.

   **When it is empty and the task has a `project`, choose one yourself.** An
   empty value means "not chosen yet" — the board never blocks a save, because
   that would ruin quick capture — it never means "no item needed". Do not ask
   the owner; everything the decision needs is in the vault:

   - List the project's items and compare each one's `## What` against this
     task's `## Description`.
   - **Start a new item only when the task overlaps none of them.** If it
     overlaps at all, use that one. The costs are not symmetric: a note filed
     under the wrong item is one move to fix, while a duplicate item splits a
     subject in two and the next reader cannot see that it happened. The one
     exception is a project with no items at all — nothing to compare against,
     so start one.
   - Write the answer back onto the task so the judgement is made once:

     ```bash
     node "C:/Users/gpbjk/.claude/plugins/cache/workhub-marketplace/workhub/0.31.0/scripts/task-cli.mjs" update <task-id> --backlog B-NNN
     ```

     A new item is created from the app's task editor, or by copying
     `templates/project/backlog/B-000-example.md` to
     `projects/NNNN-<project>/backlog/B-NNN-<slug>.md` and filling it in.
   - Say which item you chose and why, in your first message. If the owner
     disagrees, that is the cheapest moment to correct it.

   Two tasks keep no item: one with no `project` (vault housekeeping — its
   output goes to `_ai/logs/` or `knowledge/`), and a recurring task, which is
   a habit rather than a unit of work and leaves nothing durable behind.

   **Then read the item's entry note** — `<id>-<slug>.md`, or the note of the
   same name inside `<id>-<slug>/` once the item has grown into a folder:

   - `## Status` is the item's dated log. It says where the work stands and
     which of the numbered notes beside it is current, which a file listing
     alone cannot tell you.
   - `## What` and `## Why` are the standing intent behind every task on this
     item, including ones finished by earlier sessions.
   - The numbered notes in the folder are that item's specs, investigations
     and past task outputs. Read the ones the entry note points at; do not
     read the folder whole.

   This is the point of the item: the context a previous session left is one
   directory away instead of scattered across the project.

4. **Resolve the target repository through the project.** The task's
   `project` key names a vault project (`projects/NNNN-<slug>/`), not a
   repository — the two do not share a naming scheme, so never guess a path
   from the slug.
   - The project folder is `NNNN-<slug>`: a sort number, then the slug. Find it
     with the glob `projects/*-<slug>/`; `projects/<slug>/` does not exist.
   - Read `repos:` from `projects/NNNN-<slug>/_index.md`. Each entry is an
     absolute path or a repository name as registered in the app
     (`.claude/project-context.json`); resolve a name through that file.
   - One entry: use it. Several: use the one the task's `## Description`
     names, and otherwise **the first entry**, which is the project's
     default. Say which one you picked.
   - When `project` is empty, read the target repository out of the task's
     `## Description` (tasks state it as `**対象リポジトリ:** <path>`).
   - If it still cannot be resolved, ask the user.
5. **Set up a git worktree — only when the task opts in** (`worktree: true`
   in the frontmatter, which the app also states in the launch prompt).
   Isolating parallel tasks in their own worktree keeps them from colliding
   on one working tree. When enabled:
   - **The launch prompt names the worktree root.** It comes from the app's
     Worktree root setting, so it is the user's choice and not something to
     derive from the repository's path. Create the worktree under that root,
     grouped by task id and keyed by repo name, on a task branch:

     ```bash
     git -C <repo> worktree add "<worktree-root>/<task-id>/<repo-name>" -b task/<task-id>
     ```

     e.g. with the default root `C:/repos/.worktrees`, repo `C:/repos/workhub`
     and task `T-0017` → `C:/repos/.worktrees/T-0017/workhub` on branch
     `task/T-0017`. Grouping by task id keeps a multi-repo task's worktrees
     together under one `<worktree-root>/<task-id>/` folder (one sub-folder
     per repo).

     When the prompt names no root — the setting is empty — fall back to
     `.worktrees/` beside the repository (`<repo>/../.worktrees/<task-id>/`).
   - If the worktree or branch already exists (a resumed task), reuse it
     instead of recreating (`git -C <repo> worktree list` to check; drop the
     `-b` flag and point at the existing path/branch).
   - Do **all** of the task's work inside that worktree path — treat it as the
     repository root for the rest of the task.
   When `worktree` is unset/false, work directly in the resolved repository as
   before.
6. **Record an approved plan — only for plan-first tasks** (`confirm: true`,
   or whenever the user approves a plan before implementation). Once the plan
   is approved and **before making any code changes**, write it into the task
   file's `## Plan` section. Writing it afterwards defeats the point: the
   section exists so an approved plan survives a session that dies mid-way.
   - Append; never rewrite an approved plan in place — the section doubles as
     the user's approval record.
   - Change nothing else in the body.
   - If `## Plan` was already non-empty, you are executing a recorded plan
     (step 2) and should not be writing a new one.
7. **Begin the work** in the target repository (or its worktree), following
   that repo's own instructions (CLAUDE.md etc.).

## Handing information to another session

A task often needs something another session is holding — you split an
investigation into its own task, and its result has to reach the session that
asked for it. Do not wait for the owner to relay a file path.

1. Find the session working the other task:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/task-cli.mjs" sessions
   ```

   Each row is a task, the session working it, and that session's address.
   `*` marks this session. An old `started` means the row may be stale — a
   session that ended without reporting leaves its marker behind.

2. Send to that address with the desktop app's `send_message` tool, passing
   the address as its `session_id`. It arrives in the other session as a user
   turn labelled with this session's title, so say which task you are writing
   from and link the deliverable note rather than pasting it.

Rules for this:

- **Send links, not contents.** The vault is the durable channel; a message
  is a pointer plus the one line that says why it matters.
- **Only to a session that is actually working a related task.** Do not
  broadcast, and do not message a session to ask it to do your work.
- A session that is not running cannot be reached. Leave the finding in the
  task's `## Results` and its deliverable note — the next session for that
  task reads them at task-start, which is the whole point of writing there.
- Sessions started outside the desktop app (OpenCode, a bare terminal) have
  no address and show as `(not addressable)`.

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
