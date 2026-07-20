---
name: write-retro
description: Facilitate and record a sprint retrospective (KPT) with follow-up on the previous retro's action items. Use at sprint end when the user wants a retrospective, KPT, or team improvement discussion.
---

# Write a retrospective

Facilitate a KPT (Keep / Problem / Try) anchored on sprint facts, and keep
action items accountable across sprints.

## Steps

1. Resolve the sprint (default: latest). Read `review.md` if present,
   `progress-history.jsonl`, and the **previous** sprint's `retro.md`.
2. **Follow up first**: list the previous retro's Try/action items and ask
   which happened — carry unfinished ones forward explicitly.
3. **Facilitate KPT**: propose seed observations from the data (velocity
   swings, items stuck in `doing`, scope changes), then collect the team's
   Keep / Problem / Try. Push each Try to be actionable (owner + when).
4. **Write `sprints/<id>/retro.md`** (team content language): KPT table,
   action items with owners, previous-retro follow-up results.
5. If a Try is a durable process rule, propose promoting it to
   `knowledge/rules/` via `team-kb-save`. Append an activity-log line.
