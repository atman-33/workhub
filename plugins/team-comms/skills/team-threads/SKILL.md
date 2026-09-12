---
name: team-threads
description: Show what is going on in the team's comms space - live threads, their state, and what is unread for you - and help pick one to work in. Use when the user asks what the team is discussing, what they have missed, or which thread to join.
---

# See the team's threads

## Steps

1. **List them:**

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/comms.mjs" list
   ```

   Add `--all` to include closed threads. `scan` additionally reports mentions
   and any stray files.

2. **Report in the order that matters**, not the order they came back:
   threads with unread posts first, then anything you are named in, then the
   rest. Give each one line: title, state, unread count, who wrote last.

3. **Say what is worth doing**, with a reason. Usually one of:
   - read a thread that has unread posts (`team-catchup`);
   - join the discussion the user is actually working on (`team-focus`);
   - nothing, because none of it touches today's work — say that plainly
     rather than manufacturing a next step.

4. **For a browsable copy**, generate the local HTML list:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/comms.mjs" index
   ```

   It is written under `~/.team-comms/`, and deliberately **not** into the
   shared folder: one index file everyone rewrites is exactly the write
   conflict the rest of the design removes. Tell the user the path.

5. **To find something specific**, search rather than opening threads one by
   one: `comms search "<text>"`.

## Rules

- **`scan` reporting a conflict copy or a stray file is not noise.** It means
  something wrote to the space without following the naming rules. Surface it,
  and leave the file where it is — moving someone's file is the user's call.
- Do not open every thread to summarise the space. The summaries in `list` are
  there so nobody has to.
