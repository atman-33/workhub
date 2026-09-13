---
id: B-000
title: <Backlog item title>
type: backlog
project: <project-slug>
status: idea          # idea | ready | doing | done | dropped
priority: medium      # low | medium | high
source:               # URL/id in an external backlog, when one owns this item
created: {{DATE}}
updated: {{DATE}}
tags:
  - backlog
---

# <Backlog item title>

> Make a folder `B-NNN-<title>/` for each unit of work — a feature, a
> bug, a support case — and copy this file into it as `B-NNN-<title>.md`.
> `B-NNN` is a stable id, not a sort order; ordering and
> status come from frontmatter and are rendered by `_backlog.base`.
>
> `[[B-NNN-<title>]]` links resolve to the entry note, and the folder is the
> item's whole workspace: numbered notes (`010-`, `020-`, … in tens), task
> outputs (`NNN-T-XXXX-<title>.md`) and any non-Markdown artefact, all flat.

## What

The work, in a sentence or two.

## Why

The value or motivation.

## Status

Where this stands, in one line. Then a dated log, newest first — this is what
tells a later reader which of the files here is current, since a number prefix
only records the order they were created.

- {{DATE}} raised

## Notes

Index of the notes in this folder, once there are any. Links, rough thoughts.

Create tasks for this item in the app and set `backlog: B-NNN` on them; the
item does not list its tasks back.
