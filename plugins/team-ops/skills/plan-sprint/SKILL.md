---
name: plan-sprint
description: Plan a sprint - set the goal, commit backlog items into scope, and write the burndown baseline (scope.json). Use at a sprint boundary when the user wants to plan the next sprint or commit items to a sprint.
---

# Plan a sprint

Creates `projects/<p>/sprints/<sprint-id>/` with the human-readable plan and
the machine-readable scope that daily burndown tracking is measured against.

## Steps

1. **Sprint id**: `<year>.<sequence>` (e.g. `2026.15`) — sortable; next
   sequence = latest existing + 1. Length comes from `project.json`
   (`sprint.lengthDays`).
2. **Velocity check**: from `backlog/progress-history.jsonl` and previous
   sprints' scope vs done, tell the user roughly how many points fit.
3. **Select scope with the user**: walk `product-backlog.md` top-down;
   candidates need story + AC + points (send gaps to `manage-backlog`
   first). Set each committed item's `sprint:` frontmatter.
4. **Write the outputs**:
   - `planning.md` (team content language): sprint goal, dates, committed
     items table, risks/dependencies.
   - `scope.json` (burndown baseline — do not edit afterwards except via a
     documented scope change):

     ```json
     {
       "sprint": "2026.15",
       "start": "<date>", "end": "<date>",
       "items": [{ "id": "P-0012", "points": 3 }]
     }
     ```
5. Append an activity-log line, then remind the user the daily routine
   (sync → snapshot → report) starts drawing the burndown from tomorrow.

## Scope changes mid-sprint

Append the added/removed item to `scope.json` **and** record the change with
a date in `planning.md` — the daily report annotates these.
