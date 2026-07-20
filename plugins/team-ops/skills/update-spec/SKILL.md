---
name: update-spec
description: Update the project's living spec (docs/spec/spec.md) from PBI acceptance criteria and diffs newly merged into the dev-main branches. Use in the daily routine after repo sync, or when the user asks to bring the spec up to date with what is implemented.
---

# Update the living spec

`docs/spec/spec.md` answers "what is implemented today, by feature area" —
kept truthful by folding in what actually merged, not what was planned.

## Steps

1. **Check there is anything to do**: compare each repo's
   `repo-state.json.lastSyncAt` / new `commits.jsonl` entries against the
   spec's last-updated marker (an HTML comment at the top of `spec.md`,
   e.g. `<!-- last-updated: 2026-07-20 / app@abc1234 api@def5678 -->`).
   **No new merges since the marker → stop and report "no change"** — this
   is what keeps the daily routine cheap.
2. **Gather what merged**: new commits per repo grouped by PBI id
   (`pbi-activity.json` + `commits.jsonl`), and for each involved PBI its
   `## Acceptance Criteria` (satisfied AC = implemented behavior). Inspect
   actual diffs in the script-owned mirror
   (`git -C <mirrorPath> show <sha>`) only where the commit subject + AC
   leave the behavior unclear.
3. **Fold into `spec.md`** (team content language):
   - Organized by **feature area** (grow headings as the product grows),
     not by sprint or PBI — a newcomer reads it as "how the product works".
   - Update the areas the merged PBIs touched; state current behavior, and
     reference source PBIs inline (`(P-0012)`) for traceability.
   - Move superseded statements out — the spec describes the present, the
     git history keeps the past.
   - Refresh the last-updated marker with today's date and each repo's
     synced tip sha.
4. Append an activity-log line
   (`- <date> [...] update-spec: folded P-0012, P-0015 into spec.md`).

## Rules

- Never describe unmerged work as implemented. Planned work lives in the
  backlog, not the spec.
- When `spec.md` outgrows one file, split into `docs/spec/<area>.md` with
  `spec.md` as the index — propose this to the user first.
