---
name: manage-backlog
description: Add, refine, split, or reorder PBIs in the file-based product backlog in the team-shared folder. Use when the user wants to create backlog items, write user stories or acceptance criteria, estimate points, split oversized items, or tidy the product backlog.
---

# Manage the product backlog

The backlog is Markdown in the shared folder (SSoT):
`projects/<p>/backlog/product-backlog.md` (ordered overview) +
`items/<id>-<slug>.md` (one PBI = one file).

## PBI file schema

```markdown
---
id: P-0012          # per-project, sequential; next id = max existing + 1
title: ...
status: todo        # todo | doing | review | done
points: 3           # from project.json sprint.pointScale
sprint: ""          # sprint folder name once committed (plan-sprint sets it)
assignee: ""
repos: []           # repo names this PBI touches (from project.json)
created: <date>
updated: <date>
---

## Story
As a <user>, I want <capability>, so that <value>.

## Acceptance Criteria
- [ ] ...

## Tasks
- [ ] ...

## Notes
```

## Operations

- **Add**: assign the next id, create `items/<id>-<slug>.md`, add a row to
  `product-backlog.md` at the position the user wants (order = table order).
- **Refine**: fill missing story/AC/points; keep AC testable and concrete.
  Flag items that are vague or exceed the largest point value, and propose
  splits.
- **Split**: new ids for the parts; the original becomes `done` with a note
  pointing at its children, or is reworded as one of the parts.
- **Reorder / status**: edit the overview table; status changes also update
  the item file's frontmatter (`status`, `updated`). `done` is normally set
  by humans at review — don't mark items done unilaterally.

## Rules

- Content in the team content language (`<content-language>`); `id`/`status`
  values stay as-is.
- Never renumber existing ids. Never delete an item file — status and the
  overview table carry the lifecycle.
- Append one activity-log line summarizing the batch of edits.
