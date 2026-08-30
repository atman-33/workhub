---
type: schedule
title: <Schedule name>
range: {{DATE}}..{{DATE}}
created: {{DATE}}
updated: {{DATE}}
---

> Rename this file to the plan it holds (e.g. `2026Q3 release.md`). One file
> per plan; copy it to compare alternatives (`2026Q3 案A.md` / `案B.md`).
> The workhub app's **Schedule** tab reads and writes this file; you can also
> edit it here in Obsidian.
>
> The tab draws this note two ways: **Calendar** (a continuous week grid, for
> day-level planning) and **Timeline** (months across the top, for long-range
> planning). Both read the same elements below.
>
> To number the timeline by sprint, add two optional frontmatter keys:
>
> ```yaml
> sprint_start: 2026-07-06   # first day of sprint 1
> sprint_weeks: 2            # sprint length in whole weeks (1-13)
> ```
>
> The cadence lives on the note rather than in the app settings, so two plans
> can compare different ones. Sprints are a reading of the calendar only —
> they never move an element.

## Non-working

<!-- `weekly:` sets the standing weekend. Add one line per holiday, leave day
     or shutdown; a range covers several days at once. -->

- weekly: sat, sun

## Items

<!-- - [<kind>] <id> <date-spec> <title> [#<color>] [task:<task-id>]
     kind: bar | arrow | milestone | note
       bar   — a period that is settled
       arrow — the same span as an estimate, drawn as a thin double-headed
               line (lead time, buffer, parallel work)
     date-spec: `YYYY-MM-DD..YYYY-MM-DD` for a bar or arrow, `YYYY-MM-DD`
       otherwise
     id: `I-` + a number, unique in this file — never change or reuse one
     color: blue | green | amber | red | purple | gray

     An element can carry extra text on indented continuation lines beneath
     it. A note shows them on hover in the app; every other kind shows them
     in its tooltip:

       - [note] I-004 2026-07-31 monthly review
         15:00-16:00, room A
-->

## Memo

Free-form notes. Neither the app nor the AI rewrites anything from here down.
