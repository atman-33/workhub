---
title: Incremental search
type: spec
project: demo-app
status: implemented
updated: 2026-08-27
tags:
  - spec
---

# Incremental search

## Behaviour

- A search box sits above the note list. Typing filters the list as you type,
  debounced by 150 ms.
- Titles and bodies are both matched, case-insensitively.
- The matching run is highlighted in each row.
- An empty query restores the unfiltered list; a query with no matches shows an
  empty state, not a blank list.

## Out of scope

Fuzzy matching, ranking, and search across attachments.
