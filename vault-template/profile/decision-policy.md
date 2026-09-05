---
title: Decision policy
created: 2026-08-12
type: reference
tags:
  - profile
---

# Decision policy

What an agent may decide on its own, and what has to come back to you.

This note holds the *axes* of a decision, not a log of decisions. Agents read
it before putting any question to you, and the `secretary` subagent reads it in
full on every question it gates, so it has to stay short enough that the axes
below are not buried. Individual calls you settle go to [[profile/decision-log]]
instead — nobody reads that file front to back; it is grepped when a similar
question comes up.

**Size limit.** `## Promoted rules` holds at most 12 entries of at most 3 lines
each: a thirteenth arrives by merging or dropping one, never by appending. That
is the limit that matters. The 120-line backstop on the whole note is derived
from it — a filled-in `## Preferences` plus 12 full-size rules lands at 118 —
so crossing it means the prose grew, not the rules. `/kb-lint` warns on both.

This note is seeded once and never overwritten by a template sync — edit it
freely. Delete it and agents fall back to asking you plainly: the hooks stay
silent when it is missing, which also turns the secretary off by omission (the
⚙ Settings toggle does that without losing the content).

## Proceed without asking

- Reversible edits: new files, appends, commits on a branch.
- Naming, file placement and formatting that follow existing conventions.
- Adding or fixing tests, typos, comments and minor documentation.
- Implementation detail inside an approved plan (structure, helpers, splits).
- Libraries and approaches with a clear de-facto standard.
- Commit granularity and message wording, within the repo's convention.

## Always ask

- Destructive or irreversible operations: deleting, overwriting, force-push,
  rewriting history.
- Anything outward-facing: sending, publishing, posting.
- Anything that spends money.
- Scope changes: work outside the approved plan, or a changed reading of the
  requirements.
- Heavy new dependencies (build, distribution or licensing impact).
- User-visible behaviour and wording changes.

## Preferences

How you want an agent to work, in enough detail that it can pick a
recommendation for you. This is the section that decides what a proposal looks
like, so write the leanings, not just the rules.

<!-- e.g.
     - Prefer the simplest feature that solves the problem; reject scope creep.
     - Two options at most when asking, with one marked recommended.
     - Explain the conclusion and the reason; keep the detail for follow-ups.
     - Reuse an existing note/module/convention over introducing a new one.
     - Languages: chat in <language>, repository artifacts in <language>. -->

## Gray-zone principles

1. Reversible → proceed. Irreversible → ask.
2. When unsure, follow the approved plan and the existing convention.
3. Cheap to redo → proceed and report. Expensive to redo → ask first.
4. Between two reasonable options, take the simpler one and record why.

## Promoted rules

Axes that came out of decisions you have already made and now apply beyond the
case that produced them. Promote an entry from [[profile/decision-log]] once
the same reasoning has decided a second question, and write the axis rather
than the case. At most 12 entries, 3 lines each.

<!-- e.g.
     - Replace an overlapping tool rather than keeping both and drawing the
       line in their descriptions. -->
