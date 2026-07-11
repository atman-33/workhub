---
name: sidekick-go
description: Use when the user explicitly asks to delegate work to a persistent sidekick/helper agent in its own pane that you can iterate with across multiple rounds (e.g. review -> fix -> re-review) without losing its context each time, or when another skill's instructions explicitly direct invoking sidekick-go. Do not use for a one-off review or one-shot subagent task; that's the Agent/Task tool's job.
argument-hint: The task to delegate, plus (optionally) the sidekick's role, e.g. "Code Reviewer"
compatibility: Must run inside a supported multiplexer session (herdr or zellij); requires that multiplexer's CLI and the `claude` CLI on PATH.
---

Get a **sidekick**: a dedicated helper agent that lives in its own pane for as long as you need it, so you can go back and forth with the *same* agent — review, fix, re-review — without it forgetting round one by round three. That persistence is the whole point: a fresh subagent (Agent/Task tool) starts cold every call and has to be re-briefed each time; a sidekick remembers.

This skill only works **inside a supported multiplexer session** (herdr or zellij; the transport is selected automatically, herdr by default). If no multiplexer session is active, stop and tell the user to start herdr (or zellij) first.

You (the caller) don't launch anything for yourself — you're already running in a live pane. `dispatch.mjs` finds that pane, opens the sidekick's pane next to it, and wires messaging between the two via the shared bus (the same mechanism `launch-team` uses for its teammates).

## Step 1 — Decide the role and write the brief

Pick a role for the sidekick (e.g. "Code Reviewer", "Second Opinion", "Investigator"). Write a **brief**: a self-contained description of its first task. Save it to the OS temp directory (not the workspace) and capture its **absolute path**.

- Reference existing artifacts (diffs, plans, issues) by path/URL instead of pasting them.
- Redact secrets.

Done when: the brief is saved, its absolute path is captured, and a role is chosen.

## Step 2 — Dispatch

Run the dispatcher using its **absolute path** — do NOT `cd` into the skill directory first. Always pass `--cwd` set to the **current session working directory** (the project root, not the skill directory):

```
node "<absolute path to dispatch.mjs>" --brief "<absolute brief path>" --cwd "<current session working directory>" --role "<sidekick role>"
```

The dispatcher script is located inside the installed skill directory, e.g.:
`C:\Users\<user>\.claude\plugins\cache\workhub-marketplace\productivity\<version>\skills\sidekick-go\dispatch.mjs`

Add `--dry-run` to print the multiplexer commands without launching. There is no A/B/C fallback here (unlike `handoff-go`): pane-to-pane messaging requires a multiplexer session, so the script fails fast with instructions if none is active.

Done when: the script reports the sidekick's pane, the team directory, and the follow-up bus command.

## Step 3 — Report

Tell the user the sidekick is live: its role, its pane, and the **follow-up command** the script printed (`bus.mjs send --from caller --to helper`) — they'll need it verbatim for later rounds.

Done when: the user knows the sidekick is running and has the follow-up command.

## Step 4 — Wait for the reply, then act

The sidekick's replies arrive as new input directly in **this same prompt**, prefixed `[team message from helper — <role>]` — no polling, no file to check. When one arrives, act on it (e.g. fix the issues it flagged).

Done when: the sidekick's message has been read and acted on.

## Step 5 — Iterate or wrap up

To send the sidekick another round on the *same* context (e.g. "fixed, please re-review"), run the follow-up command from Step 3/2 with your own message. Repeat Steps 4–5 as many times as needed — the sidekick keeps the full history of the exchange.

When the exchange is done, send a closing message so the sidekick knows to stop, then tell the user its pane can be closed.

Done when: the exchange has reached a natural end and the user knows the sidekick's pane is safe to close.
