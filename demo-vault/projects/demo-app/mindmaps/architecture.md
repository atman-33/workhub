---
type: mindmap
title: architecture
created: 2026-07-14
updated: 2026-08-27
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
    - N-012 title and body match task:T-0003
    - N-013 highlight in row
    - N-014 debounce 150ms
  - N-015 quality #purple ^right
    - N-016 flaky upload test task:T-0004
    - N-017 cold start ~3s
    - N-018 unit tests for the matcher

## Stickies

- S-001 node:N-015 @110,28 #amber fix the race, not the assertion

## Memo

Free-form notes. Neither the app nor the AI rewrites anything from here down.
