---
title: Why notes are plain files
type: dev-note
project: demo-app
updated: 2026-08-14
tags:
  - decision
---

# Why notes are plain files

A database would make search cheaper, but it would also make the notes
unreadable outside the app. Plain Markdown files keep every other tool — the
editor, grep, backups, an AI agent — able to read and write the same data. The
cost is that search has to be built rather than queried, which M2 accepts.

Rejected: SQLite with a Markdown export. It moves the source of truth into a
format only the app can open, which is the thing this project set out to avoid.
