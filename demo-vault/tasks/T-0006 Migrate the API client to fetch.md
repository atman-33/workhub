---
id: T-0006
title: Migrate the API client to fetch
status: todo
assignee: claude-code
project: demo-app
priority: medium
order: 1
confirm: true
model: opus
due: 2026-09-05
tags: [refactor]
created: 2026-08-26
updated: 2026-08-26
---

## Description

Replace the axios client with the platform `fetch`, keeping the retry and
timeout behaviour identical. Plan first — the error mapping is used in a dozen
call sites and must not change shape.

## Plan

## Results
