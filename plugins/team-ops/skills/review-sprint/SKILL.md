---
name: review-sprint
description: Write the sprint review - scope vs done, demo pointers, and carry-over decisions. Use at sprint end when the user wants a sprint review, sprint summary, or to close out a sprint.
---

# Review a sprint

Summarize what the sprint actually delivered, anchored on data — not memory.

## Steps

1. Resolve the sprint (default: latest `sprints/<id>/` with a `scope.json`).
2. **Gather facts**:
   - `scope.json` vs each item's current `status` → done / not-done split
   - `repos/<repo>/pbi-activity.json` → what was actually merged per PBI
   - `backlog/progress-history.jsonl` → points burned over the sprint
3. **Write `sprints/<id>/review.md`** (team content language):
   - Sprint goal: met / partially / missed, with one-line evidence
   - Done items (with merge evidence and demo pointers where the PBI notes
     have them); not-done items with why
   - Metrics: committed vs completed points, velocity trend
   - Carry-over: agree with the user per unfinished item — back to backlog
     (clear `sprint:`) or into the next sprint (plan-sprint handles that)
4. Update the affected PBI files/backlog table per the carry-over decision,
   and append an activity-log line.

## Rules

- Marking items `done` is the humans' call during the review — record what
  they decide, don't decide for them.
