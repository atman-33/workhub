---
type: mindmap
title: architecture
created: 2026-07-14
updated: 2026-08-30
---

## Nodes

- N-001 Demo App
  - N-002 capture #green ^left
    - N-003 global hotkey
    - N-004 one-line window
    - N-005 save to disk
  - N-006 storage #blue ^left
    - N-007 plain Markdown files
      the source of truth; see dev-notes/storage.md
    - N-008 file watcher
    - N-009 no database ^collapsed
      - N-010 rejected: SQLite + export
  - N-011 search #amber ^right
    - N-012 title and body match task:T-0003 prio:high
    - N-013 highlight in row prio:low tags:polish
    - N-014 debounce 150ms prio:mid
  - N-015 quality #purple ^right
    - N-016 flaky upload test task:T-0004 prio:high tags:flaky,ci
    - N-017 cold start ~3s prio:mid tags:perf
    - N-018 unit tests for the matcher prio:low

## Stickies

- S-001 node:N-015 @-3,96 #amber fix the race, not the assertion

## Memo

Free-form notes. Neither the app nor the AI rewrites anything from here down.
