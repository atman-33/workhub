---
name: team-onboard
description: Generate an onboarding briefing for a new team member from the team KB, project specs, and recent progress. Use when someone new joins the team or a project, or when the user asks for an onboarding guide / "explain this team to a newcomer".
---

# Onboard a new team member

Produce a self-serve briefing so a newcomer can get productive from the
shared folder alone.

## Steps

1. Resolve paths from `<team-context>`; ask which project(s) the newcomer
   joins if not stated.
2. **Read the sources** (skim via indexes, don't dump whole files):
   - `knowledge/_index.md` → `rules/` and the most relevant topics
   - `_meta/conventions.md` (IDs, branch naming, writing rules)
   - per project: `_index.md`, `prd/`, `docs/spec/spec.md`,
     `backlog/product-backlog.md`, the latest `reports/daily/*.html`
3. **Write the briefing** to `knowledge/onboarding/<date>-<name-or-role>.md`
   in the team content language:
   - What the team builds (from PRD/spec) and where things stand (from the
     latest report)
   - The working cycle: backlog → `start-pbi` branch convention → dev-main
     merge → daily report/spec update (link the design doc's cycle)
   - Reading list: the 5–10 most valuable existing notes, with paths
   - First-week checklist (access to the shared folder, run
     `setup-team-context`, etc.)
4. Update `knowledge/onboarding/_index.md`, append an activity-log line,
   and hand the user the briefing path.

## Rules

- Link to existing notes instead of restating them — the briefing is a map,
  not a copy.
