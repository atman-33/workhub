---
name: task-report
description: Record the results of a workhub task - store the raw report in the vault AI zone, polished notes in the human zone, update the task's result section, and set status to review. Use when finishing work started via task-start, or when the user asks to report/close out a task.
argument-hint: "<task-id>"
---

# task-report — Record task results into the workhub vault

## Steps

1. **Resolve the vault** (same order as the other task skills:
   `WORKHUB_VAULT` env var → the current directory if it is a vault →
   `vault_path` in `%APPDATA%\workhub\config.json`) and locate the task
   file by `id`.
2. **Write the raw report** to `<vault>/_ai/logs/<task-id>-<yyyymmdd>.md`:
   what was done, key decisions, files changed (as `path:line` references),
   verification results, and anything a future agent needs to resume.
3. **Write human-readable deliverables** where they belong:
   - Knowledge gained (research, gotchas, how-tos) → a note under
     `<vault>/knowledge/`, added to `knowledge/_index.md`.
   - Project-specific outcomes → a note under `<vault>/projects/`.
   - Keep these polished and short; link to the raw log with a wikilink
     only if the detail matters.
4. **Append to the task's `## Results` section** (Edit tool): a 2-4 line
   summary and wikilinks to the notes created in step 3. Change nothing
   else in the body.
5. **File the follow-ups this task turned up.** Finishing a task is the moment
   you have seen the most of what was left undone, and step 2 has already made
   you write it down. Create those tasks now rather than leaving a line in a
   log nobody re-reads.

   **Include it in this task, or split it out?** Split when any of these hold:

   - it needs its own decision from the owner (scope, design, priority);
   - it touches a different repository, or a part of this one the current
     `## Plan` never covered;
   - it is not needed for the work in this task to stand on its own.

   Otherwise finish it here. A follow-up that is two lines of the change you
   just made is a task nobody wants to read, review and merge separately.

   **Write a Description a cold session can act on.** The next session has none
   of this one's context, so the Description carries it:

   - the target repository, as an absolute path;
   - the PR or branch this depends on, and whether it has merged;
   - what to read first — the raw log from step 2, the notes from step 3, the
     source files as `path:line`;
   - what the task is for, not a list of edits. Hand over the goal; let the
     next session work out the how;
   - a wikilink back to the originating task's raw log, e.g.
     `[[T-0236-20260905]]`, so the trail survives.

   Create each one with the CLI — it assigns the `id` and `order` exactly as
   the app would, so a task filed here is indistinguishable from one filed on
   the board:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/task-cli.mjs" create \
     --title "..." --project <slug> --assignee claude-code \
     --status todo --priority medium --body-file <path to the Description>
   ```

   Write the Description to a file and pass `--body-file`; it is prose, and
   prose does not survive a shell argument intact. Leave `status` at `todo`
   (or `inbox` when it is only an idea) — never start a follow-up yourself as
   part of closing this task. List what you filed in the report and in the
   final message, so the owner can drop any of them.
6. **Feed the owner's judgement calls back.** If the owner settled anything
   during this task — a question you put to them, a correction to your
   approach, a preference they stated in passing — record the rule it
   establishes:
   - a one-off call → `<vault>/profile/decision-log.md`, under `## Decisions`
     (`- <date> <task-id> <the rule>` with `(from: <the question>)` on the
     next line). This file has no size limit; it is grepped, not read.
   - a standing leaning → `<vault>/profile/decision-policy.md`'s
     `## Preferences`.
   - an axis the same reasoning has now applied twice → that note's
     `## Promoted rules`, at most 12 entries of 3 lines. A thirteenth arrives
     by merging or dropping one, never by appending.

   Say in the report which lines you added and where. This is what stops the
   next task asking the same question.
7. **Close out the status** with the bundled CLI (preferred — it sets
   `status: review` + `updated`, clears every session marker pointing at the
   task, and refreshes the index in one step):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/task-cli.mjs" report <task-id>
   ```

   *Fallback (no node, or script missing):* set `status: review` and
   `updated: <today>` in the frontmatter by hand (preserve the rest), and
   delete any `<vault>/_ai/memory/sessions/*.json` that refers to this task.
8. **Offer to clean up the worktree — only for worktree-mode tasks**
   (`worktree: true`). Once the work is committed/pushed and no longer needed,
   **propose** removing the task's worktree (do not delete it automatically —
   the user may still want to inspect it):

   ```bash
   git -C <repo> worktree remove "<repo>/../.worktrees/<repo-name>/<task-id>"
   ```

   Mention the branch `task/<task-id>` is left in place for the PR/merge.

## Rules

- AI never sets `status: done` — a human does that in the workhub app after
  reviewing.
- If the work is incomplete or blocked, still report: describe the blocker in
  `## Results`, keep `status: doing`, and leave the session marker in place.
  When the blocker is a question filed for the owner (`_ai/comms/`), name the
  question id and mark the task blocked so the board shows the wait:
  `task-cli.mjs update <id> --blocked true --blocked-note "waiting on Q-0001"`.
- Do not overwrite existing human notes; create new ones and link them.
- Never modify the task's `## Plan` section — it is the approved plan and the
  user's approval record, not a place for results.
- Write `## Results` in the language given by the workhub **Task language**
  setting, stated in the app's launch prompt (default English). That setting
  governs the task file's `## Plan` and `## Results` only — notes under
  `knowledge/` and `projects/`, and everything in target repositories, follow
  their own conventions.
