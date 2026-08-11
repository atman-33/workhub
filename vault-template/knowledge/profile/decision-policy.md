---
title: Decision policy
created: 2026-08-12
type: reference
tags:
  - profile
---

# Decision policy

What an agent may decide on its own, and what has to come back to you.

The `secretary` subagent reads this note to answer questions the main agent
would otherwise interrupt you with. Anything this note does not cover is
escalated, so the more you write here, the fewer interruptions you get. Start
with the defaults below and correct them as real questions come in — the
`## Past decisions` section is where those corrections accumulate.

This note is seeded once and never overwritten by a template sync — edit it
freely. Delete it to turn the secretary off by omission (the hooks stay
silent when it is missing); the ⚙ Settings toggle does the same thing without
losing the content.

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

## Gray-zone principles

1. Reversible → proceed. Irreversible → ask.
2. When unsure, follow the approved plan and the existing convention.
3. Cheap to redo → proceed and report. Expensive to redo → ask first.
4. Between two reasonable options, take the simpler one and record why.

## Past decisions

<!-- Rules that came out of questions you have already answered, e.g.
     - 2026-08-15: prefer X over Y for Z (from Q-0003). -->
