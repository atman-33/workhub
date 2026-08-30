---
id: T-0004
title: Fix the flaky upload test
status: doing
assignee: claude-code
project: demo-app
priority: high
order: 1
worktree: true
model: sonnet
tags: [bug, ci]
created: 2026-08-25
updated: 2026-08-29
---

## Description

`upload.spec.ts` fails on CI roughly one run in five, always on the progress
assertion. Find the root cause before changing the test — a real race in the
uploader is the more likely explanation.

## Plan

## Results
