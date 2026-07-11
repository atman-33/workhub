---
name: launch-team
description: Launch a role-based team of Claude Code agents in separate multiplexer panes that coordinate on one task by messaging each other directly.
argument-hint: The task plus the roles/number of agents (e.g. "implement feature X with a designer, an implementer, and a reviewer")
disable-model-invocation: true
compatibility: Must run inside a supported multiplexer session (herdr or zellij); requires that multiplexer's CLI and the `claude` CLI on PATH.
---

Launch a **team** of Claude Code agents — one persistent session per pane — to work a single task together. You are the **conductor**: pick the roles, write the brief, start the team. From there the agents coordinate themselves, each messaging teammates by typing into their panes. `launcher.mjs` does the deterministic setup (panes, role prompts, the shared roster); your judgment is the roles and the brief.

This skill only works **inside a supported multiplexer session** (herdr or zellij). The transport is selected automatically (herdr is the default; override via `transport.config.json`). If no multiplexer session is active, stop and tell the user to start herdr (or zellij) first.

## Step 1 — Decide the team

From the arguments, settle the roles and how many agents. One agent is the **orchestrator** (decomposes the task, delegates, integrates); the rest are workers. If the user gave only a task, propose a default and confirm:

- `orchestrator` — Designer & Orchestrator
- `implementer` — Implementer
- `reviewer` — Reviewer

Use lowercase kebab-case ids (they become pane names). Keep the team to 2–4 agents.

Done when: the agent ids, their roles, and which one is the orchestrator are settled.

## Step 2 — Write the brief and config

Write a **brief**: a self-contained description of the goal. Reference existing artifacts (PRDs, plans, issues, diffs) by path/URL instead of pasting them; redact secrets.

Then write a **config JSON** to the OS temp directory (not the workspace):

```json
{
  "team": "feature-x",
  "brief": "<the full brief>",
  "agents": [
    { "id": "orchestrator", "role": "Designer & Orchestrator", "orchestrator": true, "focus": "plan and coordinate" },
    { "id": "implementer", "role": "Implementer", "focus": "write the code" },
    { "id": "reviewer", "role": "Reviewer", "focus": "review diffs and flag issues" }
  ]
}
```

Done when: the config JSON is saved and its absolute path is captured.

## Step 3 — Launch the team

Run the launcher by its **absolute path** — do NOT `cd` into the skill directory. Pass `--cwd` set to the **project directory** the team works on (not the skill directory):

```
node "<absolute path to launcher.mjs>" --config "<absolute config path>" --cwd "<project directory>"
```

The launcher lives in the installed skill directory, e.g.:
`C:\Users\<user>\.claude\plugins\cache\workhub-marketplace\productivity\<version>\skills\launch-team\launcher.mjs`

Add `--dry-run` to print the multiplexer commands without launching. The launcher opens one named pane per agent, writes the roster, and delivers the brief into the orchestrator's pane to start the work.

Done when: the launcher reports the started agents, their panes, and the team directory.

## Step 4 — Report

Tell the user the team is live: the agents/roles, the panes to watch, and the team directory. Note that the orchestrator drives the task and that they can steer by typing into any pane. If the launcher printed a warning (e.g. it could not auto-deliver the brief), relay its manual command verbatim.

Done when: the user knows the team is running and how to follow or steer it.
