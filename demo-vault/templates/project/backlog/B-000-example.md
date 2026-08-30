---
id: B-000
title: <Backlog item title>
type: backlog
project: <project-slug>
status: idea          # idea | ready | promoted | dropped
priority: medium      # low | medium | high
promoted:             # T-XXXX once promoted to a real task in tasks/
created: {{DATE}}
updated: {{DATE}}
tags:
  - backlog
---

# <Backlog item title>

> Copy this file to `B-NNN-<title>.md` for each item. `B-NNN` is a stable id,
> not a sort order — ordering and status come from frontmatter and are rendered
> by `_backlog.base`.

## What

The idea, in a sentence or two.

## Why

The value / motivation.

## Notes

Rough thoughts, links. Promote to a real task (`tasks/`) via the app when
`status: ready`; then set `status: promoted` and `promoted: T-XXXX` here.
