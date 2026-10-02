---
paths:
  - "tasks/**"
---

# Task schema

Full frontmatter and body schema of a task file. The rules an agent must always follow (status
transitions, `depends_on`, Plan handling) are in the vault `CLAUDE.md`.

Active task files live flat in `tasks/`, named `<id> <title>.md` (e.g.
`T-0042 Improve sort order.md`); archived tasks are moved into the
`tasks/archive/` subfolder (same filename) to keep the flat listing tidy.
Frontmatter:

```yaml
id: T-0042          # assigned by the app, never change
title: ...
status: todo        # inbox | todo | doing | review | done
assignee: me        # me | claude-code | opencode
project: devdeck    # target project/repo identifier (optional)
backlog: B-007      # required once `project` is set: the backlog item in
                    # projects/*-<project>/backlog/ this task belongs to. The
                    # link runs this way only — the item never lists its
                    # tasks. Left blank it means "not chosen yet", never "no
                    # item": the agent fills it in at task-start
priority: medium    # low | medium | high
model: sonnet       # optional; AI model passed as `--model` when the app
                    # launches an agent for this task. Absent = agent default.
order: 2            # manual sort position; managed by the app — leave as is
due: 2026-07-20     # optional
tags: []
archived: true      # optional; absent = false. Hidden from the board by
                    # default; the app files it under tasks/archive/
confirm: true       # optional; absent = false. Plan-first approval before executing
worktree: true      # optional; absent = false. Work in a dedicated git worktree
blocked: true       # optional; absent = false. Waiting on someone else. Kept
                    # separate from `status` on purpose — a task can be
                    # blocked in any column
blocked_note: waiting for the vendor quote
                    # optional; one line, only while blocked. The longer story
                    # belongs in the body
blocked_since: 2026-08-06
                    # optional; when the wait started, only while blocked. The
                    # board counts the days from it
depends_on: [T-0012, T-0034]
                    # optional; absent = none. Tasks that must be `done` before
                    # this one can start. Not `blocked`: nobody sets a wait by
                    # hand — it is derived from those tasks' `status` and
                    # clears by itself when they are done. A loop is refused
created: 2026-07-10
updated: 2026-07-10
```

Body sections, in document order:

| Section | Written by | Meaning |
|---------|-----------|---------|
| `## Description` | human | prompt/spec for AI — what should happen |
| `## Plan` | AI, approved by human | the approved implementation plan |
| `## Results` | AI, on completion | deliverables, links to deliverable notes |

Description and Plan are inputs; Results is the output. A non-empty `## Plan`
means the plan is already approved — follow it instead of re-planning. The
section outlives the session that wrote it, so a plan approved by one agent
can be executed later by another. The app renders Plan read-only; edit plans
in Obsidian.
