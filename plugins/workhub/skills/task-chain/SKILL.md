---
name: task-chain
description: Run several workhub tasks back to back in this session, one subagent per task, with the owner's choices recorded up front. Use when the owner names an ordered list of tasks to work through (a milestone's run, a dependent series), not for a single task (task-handoff).
argument-hint: "<task-id> <task-id> ..."
---

# task-chain — Run an ordered list of tasks

This session is the **orchestrator**: it holds the order, the dependencies and
the owner's choices, and hands each task to a fresh subagent that runs
`task-start` through `task-report`. The orchestrator does no task work itself.
State lives in `_ai/state/task-chain.json`, kept by `scripts/task-chain.mjs`
(`TC` below = `node <plugin>/scripts/task-chain.mjs`, same vault resolution as
`task-cli`).

## Steps

1. **Preflight.** `TC preflight <ids in order>` returns per task its status,
   `confirm`, and each open predecessor labelled `earlier` (in the chain),
   `later` or `outside`. Fix every `problem` first — drop the task, reorder, or
   ask the owner to unblock it. A chain with a problem does not start. Done when
   no task reports a problem.

2. **Ask the owner once, up front.** Put each choice with a recommendation and
   its reason (decision policy first). Never start a task before all four are
   answered:

   - **`depends_on` on an `earlier` task:** *detach* it for the run (recommended:
     the orchestrator already holds the order, and the original list is
     restored at the end) or *stop* the chain before that task. Never use
     `task-cli start --force`: only the owner may allow it, and an agent
     passing it is refused.
   - **`confirm: true` task:** *relay* (recommended: a subagent drafts the
     plan, the owner approves it here), *delegate* (the orchestrator approves
     the plan against the task's `## Description`; for low-risk, easily
     reverted tasks the owner names), or *stop* before it.
   - **Merging:** whether each task's PR is merged before the next starts.
     Without it the chain stops after the first task that opens a PR.
   - **Limit:** the number of tasks to run unattended (default 5).

3. **Initialise.** `TC init <ids> --max <n> [--merge] [--detach <ids>]
   [--delegate <ids>]`. This detaches the chosen `depends_on` and records the
   originals.

4. **Run the loop.** `TC next` names the next task, its `confirm` mode and
   whether to merge. Dispatch one subagent (`general-purpose`, foreground) with:

   ```text
   Implement task <id>. First run the task-start skill.
   Task file: <vault>/tasks/<file name>
   <mode lines below>
   Edit files with the Edit tool, not an interpreter. Finish with the
   task-report skill. Reply in at most 5 lines: final status, any denied or
   failed tool call (named), the PR URL, the log path.
   ```

   Mode lines: for a plain task none. With `merge`: "Open the PR, merge it
   without waiting for CI, then run task-report." For `confirm` *relay*, run two
   subagents: the first "Draft the plan only; change nothing; reply with the
   plan." The orchestrator shows it to the owner in full and waits for approval;
   the second gets "Record this approved plan in the task's `## Plan` before any
   change: <plan>." For *delegate*, the orchestrator approves the plan itself and
   the second subagent's recorded plan opens with "Approved by the orchestrating
   agent under the owner's delegation."

5. **Judge by the task file.** After each subagent, `TC mark <id> review`
   succeeds only when the task's `status` is `review`; the subagent's own
   account does not count. Otherwise `TC mark <id> failed|stopped --note
   "<reason>"`. A question that needs the owner (a spec choice) is `stopped`:
   put it to the owner, then resume. After a failure or stop `TC next` returns
   no task, so no further task starts.

6. **Finish.** `TC finish` restores every detached `depends_on`. Report to the
   owner: each task's outcome, open PRs, and what remains. Resuming is a fresh
   `task-chain` with the remaining ids.

## What the owner accepts

Subagent runs do not appear in the desktop session list: follow them through
`_ai/logs/` and the state file. Work reaches `review` unreviewed, so the limit
and the halt-on-failure rule are the brakes.
