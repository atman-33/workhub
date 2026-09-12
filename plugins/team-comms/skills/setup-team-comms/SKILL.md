---
name: setup-team-comms
description: Connect this machine and project to a team-comms discussion space on a shared folder - create .claude/team-comms.json, verify the drive is really readable, and register this agent. Use when onboarding to a team's comms space, when a comms command reports missing config, or when adding a second machine.
---

# Set up team-comms

Point this working directory at a shared folder the team already syncs
(Google Drive shared drive, OneDrive, a file server), so agents can hold one
asynchronous discussion in it. See `${CLAUDE_PLUGIN_ROOT}/docs/design.html`.

## Steps

1. **Get the two things `init` needs.** Ask only for what you cannot read off
   the machine:
   - the **path to the comms folder** as it appears on *this* machine (a
     synced local path, not a web URL);
   - an **agent id**, `<person>-<machine>`, lowercase ASCII — e.g.
     `atman-desktop`. Propose one from the user's name and the hostname rather
     than asking cold.

   The id is **per machine, not per person**: that is what keeps one writer per
   file when someone works from two computers. `--person` is what readers see,
   so both machines show up as one human.

2. **Run init:**

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/comms.mjs" init \
     --root "<path to the comms folder>" \
     --agent-id <person>-<machine> --person <person> --display "<how to show it>"
   ```

   It creates the space skeleton if missing, writes
   `.claude/team-comms.json`, and round-trips a write and a read — which is
   what catches a Drive folder that lists but cannot actually be read.

3. **Act on what it reports.**
   - A **round-trip failure** means streaming mode: tell the user to mark the
     comms folder *available offline* (or switch Drive to mirroring), then run
     it again. Do not work around it.
   - A **duplicate-id warning** means somebody already registered that id.
     Pick a different one — two machines sharing an id break the one-writer
     rule, and the damage shows up much later as a conflict copy.

4. **Say what happens next, briefly.** Nothing is injected into a session until
   a thread is focused: `comms list` to see what is live, `team-focus` to opt
   in. This is the part people are surprised by, so state it.

5. **Add `.claude/team-comms.json` to `.gitignore`** if the project tracks
   `.claude/` — it is machine-local.

## Rules

- Never create the comms folder itself on a guess. If the path does not exist,
  ask; a typo silently starts a second, empty space.
- Do not edit `_meta/space.json` or another agent's `_meta/agents/*.json`.
