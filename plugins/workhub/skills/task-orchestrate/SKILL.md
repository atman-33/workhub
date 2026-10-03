---
name: task-orchestrate
description: Triage a pile of workhub tasks, within one project or across several, and advise on the order, what can run in parallel, and whether a worktree is needed, then dispatch the approved ones. Use when the owner wants to know which task to take next, how to work through a backlog, or opens a session to steer many tasks; not for a fixed ordered list (task-chain) or a single task (task-handoff).
argument-hint: "[<project-slug> | all]"
---

# task-orchestrate — Advise on the order, then dispatch

This session is the **conductor**. It reads the board, recommends an order, a
degree of parallelism and a start mode per task, and — once the owner approves —
routes each task to an existing runner. It does no task work itself and starts
nothing the owner has not approved. A session opened for this skill stays open:
it re-triages as tasks reach `review`.

Runners already exist; this skill only decides and hands over:

- `task-handoff` — a task in its own session (a Claude Desktop chip).
- `task-chain` — an ordered list run back to back, one subagent per task.
- A single subagent from here — only for a small, self-contained task.

`strategist` argues about direction against `strategy/`; this skill orders
work that is already on the board. Neither replaces the other.

## Steps

1. **Take stock (read-only).** `TC` = `node <plugin>/scripts/task-cli.mjs`.
   - `TC list --json` (add `--project <slug>` when the argument names one). Keep
     `todo`, `doing` and `review`; list `inbox` ideas apart, as candidates for
     promotion, not as work.
   - Per task note: `priority`, `due`, `project`, `backlog`, `depends_on` (the
     `waiting-on` column), `confirm`, `worktree`, `assignee`, `blocked`.
   - `TC sessions --json` shows which tasks a session already holds. Never
     recommend a task that is `doing` in another session.
   - For each project in play read `projects/*-<slug>/README.md` and the
     backlog items the tasks point at, so the grouping follows the owner's own
     units of work.
   - For every target repository: `git status --short`, the current branch, and
     `git worktree list`. Uncommitted work from another session in the shared
     working tree is the main reason a parallel task needs a worktree.

2. **Analyse.**
   - **Ready set:** tasks with nothing in `waiting-on`, not blocked, not held by
     a session. A task that is not ready is never offered as the next one.
   - **Order:** unblock first (a task that others wait on), then `due`, then
     `priority`. Across projects, say which project's work the order favours
     and why. When `strategy/bottlenecks/` exists, read the open walls and
     prefer the task that removes one; cite the file. Do not turn this into a
     direction review: that is `strategist`.
   - **Parallel or serial:** two tasks may run side by side only when they
     touch different repositories, or clearly different areas of one. The board
     carries no file-level data, so a same-repository judgement is an
     **inference from `## Description` and the backlog item**: label it as one.
   - **Width:** recommend a work-in-progress limit (default 2 to 3 sessions
     open at once). Review is the real bottleneck, so more than the owner can
     review in a sitting is not parallelism, only a queue.
   - **Worktree:** recommend one for a task when it runs beside another task in
     the same repository, or the working tree already holds another session's
     uncommitted work. Recommend none for a serial run, or a task in a
     repository nothing else touches. `worktree: true` on the task is what makes
     `task-start` build it; `task-cli update` cannot set that key, so name the
     tasks and let the owner turn it on in the app, or edit the frontmatter if
     they ask you to.

3. **Propose.** Show the plan in the chat before doing anything, in waves:

   ```text
   Wave 1 (start now, in parallel)
     T-0xxx  <title>   start: own session | chain | subagent   worktree: yes|no
             why: <one line, with the file or preference it comes from>
   Wave 2 (after Wave 1 reaches review)
     ...
   Not ready: T-0yyy waits on T-0xxx · T-0zzz is held by another session
   Inferred, not known: <each same-area judgement>
   ```

   Open choices follow the decision policy: at most two options, one marked
   recommended with its reason and `P-NN`. Include the WIP limit and any
   `confirm: true` task, whose plan the owner approves in whichever session
   runs it.

4. **Dispatch what the owner approves, and only that.**
   - Own session: run `task-handoff` for the task; it makes the chip and the
     start-mode call. Hand over one task at a time so each recommendation is
     seen.
   - A serial run of several: run `task-chain` with those ids, in the agreed
     order.
   - A small, self-contained task: one `general-purpose` subagent running
     `task-start` through `task-report`, as `task-chain` step 4 does.
   - Without `spawn_task` (OpenCode, a terminal) there is no chip: point the
     owner at the task's **Launch agent** or **Send to Claude Desktop** button
     in the app, naming the tasks.
   - Never `task-cli start --force`, and never set a task to `done`.

5. **Re-triage.** When the owner reports a task in `review`, or asks "what
   next", repeat steps 1 and 2 on the changed board and show only what moved.
   Keep working notes, if any, in `_ai/state/orchestrate-<date>.md`; the board
   itself stays the source of truth.

## Notes for the owner

- A chip session hangs off this one: archiving the conductor archives its
  chips, and they cannot be detached. A task that must outlive this session
  goes through **Send to Claude Desktop** instead.
- Subagent runs do not show in the session list. Use them sparingly; the
  work stays visible when it has its own session.
- A session with no task and no single project is left unnamed, as the vault's
  *Session names* rule says.
