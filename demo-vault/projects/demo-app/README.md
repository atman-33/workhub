---
title: Demo App
type: project-readme
project: demo-app
status: active
updated: 2026-08-29
tags:
  - project
---

# Demo App

> **AI agents: read this file first.** It is the single entry point for the
> project — it states the current status and points to everything else. Do not
> scan the whole project folder.

## Overview

Demo App is a small note-taking client used here as sample data for workhub's
screenshots. It exists so the app can be demonstrated without exposing a real
vault. Nothing in this folder describes a real product — see
[`prd.md`](prd.md) for the (equally fictional) scope.

## Current status

- **Phase:** build
- **Now:** search in the note list, and a flaky upload test on CI.
- **Next:** the API client migration, then the settings dialog redesign.

## Where things live

| Path | Contents |
|---|---|
| [`prd.md`](prd.md) | Product intent, scope, goals (single source) |
| [`roadmap.md`](roadmap.md) | Milestones and schedule |
| [`links.md`](links.md) | Link collection — repos, environments, dashboards, references |
| `backlog/` | One note or folder per unit of work — its spec, its research, its task outputs. See the Base view below |
| `dev-notes/` | Cross-cutting knowledge: architecture, environment, conventions |
| `deliverables/` | Task deliverable notes (`T-XXXX-…`) for tasks belonging to no item |
| `schedules/` | Date plans, read and written by the Schedule tab |
| `mindmaps/` | Idea maps, read and written by the Mindmap tab |
| `attachments/` | Images and binaries for this project |

## Reading order

1. `README.md` (this file) — status and map
2. `prd.md` — what and why
3. `roadmap.md` — when
4. The `backlog/` item you are working on — its entry note first (`## Status`
   says where it stands), then the numbered notes inside it
5. `dev-notes/` — only what the work actually touches

## Backlog

![[backlog/_backlog.base]]

## Key links

- Repo: `C:/repos/demo-app`
- Related tasks: `tasks/` (vault root) — the app's executable task list
