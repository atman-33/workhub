---
id: T-0003
title: Add search to the note list
status: review
assignee: claude-code
project: demo-app
priority: high
model: sonnet
order: 1
due: 2026-08-28
tags: [feature]
created: 2026-08-18
updated: 2026-08-30
---

## Description

The note list has grown past what scrolling can handle. Add an incremental
search box above the list that filters by title and body, debounced, with the
match highlighted in the row.

## Plan

1. Add a `useDeferredValue`-backed filter to the list store.
2. Highlight matches in the row renderer.
3. Cover the matcher with unit tests.

## Results

Search box implemented with a 150 ms debounce and highlighted matches.
Unit tests cover the matcher, including the empty-query and no-match cases.
