---
title: <Project name>
type: project-readme
project: <project-slug>
status: active        # active | paused | done
updated: {{DATE}}
tags:
  - project
---

# <Project name>

> **AI agents: read this file first.** It is the single entry point for the
> project — it states the current status and points to everything else. Do not
> scan the whole project folder.

## Overview

One paragraph: what this project is, who it is for, and the problem it solves.
Link to the full spec in [`prd.md`](prd.md).

## Current status

- **Phase:** <discovery | design | build | stabilize | done>
- **Now:** what is actively being worked on.
- **Next:** the next few things, or link to the backlog view below.

## Where things live

| Path | Contents |
|---|---|
| [`prd.md`](prd.md) | Product intent, scope, goals (single source) |
| [`roadmap.md`](roadmap.md) | Milestones and schedule |
| [`links.md`](links.md) | Link collection — repos, environments, dashboards, references |
| `specs/` | Feature specs, one file per feature |
| `backlog/` | Backlog items; see the Base view below |
| `research/` | Investigations and technical spikes |
| `dev-notes/` | Development notes, design decisions, architecture |
| `deliverables/` | Task deliverable notes (`T-XXXX-…`) |
| `attachments/` | Images and binaries for this project |

Nothing else belongs at the project root. If a document fits none of the
folders above, add a folder for it (English kebab-case) and list it in this
table — don't leave the note loose at the root.

## Reading order

1. `README.md` (this file) — status and map
2. `prd.md` — what and why
3. `roadmap.md` — when
4. Relevant `specs/` — how
5. `backlog/` — what's queued

## Backlog

![[backlog/_backlog.base]]

## Key links

The two or three links opened daily. Everything else — environments,
dashboards, design files, references — lives in [`links.md`](links.md).

- Repo: <path or URL>
- Related tasks: `tasks/` (vault root) — the app's executable task list
