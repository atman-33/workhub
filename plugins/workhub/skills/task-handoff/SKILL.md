---
name: task-handoff
description: Decide whether a workhub task meant for an agent to work continues in this session or goes to a fresh one, and hand it off. Use right after filing such a task (task-list, task-report follow-ups), or when the user asks to run a task in another session.
argument-hint: "<task-id>"
---

# task-handoff — Continue here, or hand the task to a fresh session

A task filed mid-session invites rolling straight into it. The owner's default
runs the other way: a follow-up gets its own session, with a clean context and
its own row in the session list. This skill turns that into an explicit call —
a recommendation with its reason, every time — and carries out the handoff.
For an ordered list of tasks to run back to back, use `task-chain` instead.

## Steps

1. **Recommend continue or hand off.** Read the task file's frontmatter and
   `## Description`. This skill is for a task an agent is meant to work
   (`todo`, an agent assignee); for an `inbox` idea or a task assigned to
   `me`, the filing is the whole job and this skill is done — unless the
   owner asked for the handoff themselves. Recommend a **fresh session** when any of these hold:

   - it is its own unit of work — a different milestone or backlog item from
     the task this session is on;
   - it has `confirm: true`, so its plan needs the owner's approval;
   - it works in a different area or repository from this session;
   - this session's context is already large;
   - this session's own task is still open — `task-report` has not run.

   Recommend **continuing here** only when all of these hold: the change is
   small (a few places), it leans on context this session holds and no note
   records, and the owner has said to carry on. When the call is close,
   recommend a fresh session.

   Put the recommendation and its one-line reason to the owner, and wait for
   their answer. On "continue here", run `task-start` in this session; this
   skill is done.

2. **Pick the chip's start mode.** Applies when this session has the desktop
   app's `spawn_task` tool (Claude Desktop). Starting a chip asks the owner
   whether to run it locally or in a git worktree, and that worktree is made
   of *this session's* working directory.

   - Recommend **local** when this session runs in the vault — nearly always.
     A chip worktree is a copy of the vault: it isolates nothing in the target
     repository, and the task file, `_ai/` markers and notes the new session
     writes land in the copy rather than the vault the app reads. A task that
     needs its repository isolated carries `worktree: true` in its
     frontmatter; `task-start` then builds the worktree in the target
     repository.
   - Recommend **worktree** only when this session runs in the target
     repository itself and other work is in flight in that working tree, or
     will run beside it.

3. **Hand off.**

   - **With `spawn_task`:** call it with the title `<task-id> <title>`, a
     `tldr` saying why this task gets its own session, and a minimal prompt:

     ```text
     Implement task <task-id>. First run the task-start skill.
     Task file: <vault>/tasks/<file name>
     Read first: <the notes and logs the Description points at>
     ```

     Keep the prompt to that. `task-start` reads confirm mode, the `## Plan` /
     `## Results` language and the owner's custom prompt from the task and the
     vault, so the app's launch prompt needs no rebuilding here.

     Then tell the owner, in one message:
     - the start mode from step 2, with its one-line reason;
     - that a chip session hangs off this one: archiving this session archives
       it too, and it cannot be detached. When the task should outlive this
       session, the task's **Send to Claude Desktop** button in the app opens
       an independent session instead.
   - **Without `spawn_task`** (OpenCode, a terminal): point the owner at the
     app — the task's **Launch agent** or **Send to Claude Desktop** button.

   Done when the chip (or the app route) and the recommendation are in front
   of the owner. The task itself starts in its own session.
