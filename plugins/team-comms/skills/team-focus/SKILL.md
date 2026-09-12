---
name: team-focus
description: Declare that this working directory is now taking part in a team-comms thread, so future sessions here surface its unread posts - or stop, so they go quiet again. Use when the user says they are working in a thread, wants notifications for one, or wants them to stop.
---

# Focus a thread (or stop)

team-comms is silent by default. A session is told about a thread only while
this working directory has opted in — because injecting unread counts into
every session is a cost paid in tokens and attention every time, and ends with
everyone ignoring them.

## Steps

1. **Resolve which thread.** If the user named one, find it with
   `comms list` / `comms search`. If they described a topic and no thread
   exists, this is `team-open`, not this skill.

2. **Focus it:**

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/comms.mjs" focus <thread-id>
   ```

   Stored per working directory, so another repository can follow a different
   thread at the same time.

3. **Offer the catch-up in the same breath.** Focus points at a thread; it does
   not remember its contents, and this session has none of the discussion. If
   the thread has posts the user has not seen, run `team-catchup` now rather
   than waiting for them to ask.

4. **To stop:** `comms unfocus`. Say plainly that sessions in this directory
   will go silent — that is the intended state, not a loss of a feature.

## Rules

- **Focus only what the user actually said to.** Quietly focusing a thread
  because it looked relevant makes every later session pay for it.
- A closed thread clears its own focus at the next session start; there is no
  need to unfocus it by hand.
- Being named in a post still produces a one-line count with no focus at all.
  That is the only exception, and it is deliberate.
