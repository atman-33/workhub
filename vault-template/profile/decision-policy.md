---
title: Decision policy
created: 2026-08-12
type: reference
tags:
  - profile
---

# Decision policy

What an agent may decide on its own, and what has to come back to you.

Every agent session reads this note. It uses `## Preferences` to build a
recommendation *before* putting a question to you, so a question arrives with a
proposed answer attached rather than as an open choice.

When the secretary agent is turned on, the `secretary` subagent reads the same
note to answer questions the main agent would otherwise interrupt you with.
Anything this note does not cover is escalated, so the more you write here, the
fewer interruptions you get. Start with the defaults below and correct them as
real questions come in — the `## Past decisions` section is where those
corrections accumulate, and agents are told to append to it whenever you settle
a question yourself.

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

## Past decisions

<!-- Rules that came out of questions you have already answered, e.g.
     - 2026-08-15: prefer X over Y for Z (from Q-0003). -->
