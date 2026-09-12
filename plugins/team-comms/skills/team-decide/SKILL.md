---
name: team-decide
description: Record the conclusion of a team-comms discussion and close the thread. Use when a discussion has reached an answer, when the user says what was decided, or when a thread is finished and should stop appearing as live.
---

# Record a decision and close the thread

A thread nobody closes keeps showing up as live, and the team stops trusting
the list. Closing is cheap — two posts.

## Steps

1. **Make sure you have the discussion**, not just the last message: run
   `team-catchup` if this session is cold. The decision post has to say what
   was rejected, and that is in the middle of the thread.

2. **Post the decision:**

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/comms.mjs" post \
     [--thread <id>] --kind decision \
     --summary "<what was decided, in one line>" [--body-file <path>]
   ```

   The body carries what a reader in three months needs: what was chosen, the
   reason, what was rejected and why, and anything left open. That paragraph is
   the entire value of having discussed it in writing.

3. **Close it:**

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/comms.mjs" post \
     [--thread <id>] --kind status --state closed --summary "<why it is closed>"
   ```

   Closed threads drop out of `comms list` and clear their own focus at the
   next session start.

4. **Check for a competing decision first.** If the thread already has one,
   the tools report "several decisions" rather than resolving it — because sync
   delay lets two people each believe theirs was last. Do not add a third
   silently: say what is already recorded, and let the user settle it.

5. **Carry the conclusion where it belongs.** A decision that changes how a
   repository works belongs in that repository too — an ADR, a rule, or the
   project's own notes. The thread is the discussion, not the documentation.

## Rules

- **Only record what the team actually settled.** Writing a decision to tidy
  away a thread that is still open is worse than leaving it open.
- Anyone may close a thread and everything stays in the history, so an undo is
  just another status post. The convention is that whoever opened it closes it.
- Never close a thread that is waiting on somebody's answer, even if it has
  gone quiet. Mention them instead.
