---
title: Decision policy
created: 2026-08-12
type: reference
tags:
  - identity
---

# Decision policy

What an agent may decide on its own, and what has to come back to you.

This note holds the *axes* of a decision, not a log of decisions. Agents read
it before putting any question to you, and the `secretary` subagent reads it in
full on every question it gates, so it has to stay short enough that the axes
below are not buried. Individual calls you settle go to `memory/notes/`
instead — nobody reads that file front to back; it is grepped when a similar
question comes up.

**What goes in.** An entry has to pass three tests:

- It is an axis, not a case. The case goes to `memory/notes/` as a
  `type: decision` note.
- It does not overlap an entry already here. If it does, merge the two.
- It says something the model would not do unprompted, and that nothing else —
  a CLAUDE.md, a hook — already enforces.

Each entry opens with a `P-NN` id (`- P-01 …`, or `1. P-04 …` in a numbered
list): the next unused one, never reused, never renumbered. An agent cites the
id when a recommendation or a decision note stands on the entry.

**Size limit.** 40 entries across all sections, at most 3 lines each. A 41st
arrives by merging or dropping one, never by appending. There is no quota per
section and no line count on purpose: a quota decides where a rule lives by
which box has room, and a line count lets the entries grow while the prose
around them shrinks. `/kb-lint` and `memory-doctor` report an overrun.

**Unused entries.** Add `axes_since: YYYY-MM-DD` to the frontmatter when you
start citing ids. Ninety days later `memory-tidy` lists the entries — other
than `## Always ask`, which is a safety net and is rarely reached exactly
because it works — that no note in `memory/notes/` or `_ai/comms/` has cited
since, as candidates for moving down to `memory/notes/`. You decide; nothing is
removed automatically.

This note is seeded once and never overwritten by a template sync — edit it
freely. Delete it and agents fall back to asking you plainly: the hooks stay
silent when it is missing, which also turns the secretary off by omission (the
⚙ Settings toggle does that without losing the content).

## Proceed without asking

- P-01 Reversible edits: new files, appends, commits on a branch.
- P-02 Naming, file placement and formatting that follow existing conventions.
- P-03 Adding or fixing tests, typos, comments and minor documentation.
- P-04 Implementation detail inside an approved plan (structure, helpers,
  splits).
- P-05 Libraries and approaches with a clear de-facto standard.
- P-06 Commit granularity and message wording, within the repo's convention.

## Always ask

- P-07 Destructive or irreversible operations: deleting, overwriting,
  force-push, rewriting history.
- P-08 Anything outward-facing: sending, publishing, posting.
- P-09 Anything that spends money.
- P-10 Scope changes: work outside the approved plan, or a changed reading of
  the requirements.
- P-11 Heavy new dependencies (build, distribution or licensing impact).
- P-12 User-visible behaviour and wording changes.

## Preferences

How you want an agent to work, in enough detail that it can pick a
recommendation for you. This is the section that decides what a proposal looks
like, so write the leanings, not just the rules.

<!-- e.g.
     - P-13 Prefer the simplest feature that solves the problem; reject scope
       creep.
     - P-14 Two options at most when asking, with one marked recommended.
     - P-15 Explain the conclusion and the reason; keep the detail for
       follow-ups.
     - P-16 Reuse an existing note/module/convention over introducing a new one.
     - P-17 Languages: chat in <language>, repository artifacts in <language>. -->

## Gray-zone principles

1. P-18 Reversible → proceed. Irreversible → ask.
2. P-19 When unsure, follow the approved plan and the existing convention.
3. P-20 Cheap to redo → proceed and report. Expensive to redo → ask first.
4. P-21 Between two reasonable options, take the simpler one and record why.

## Promoted rules

Axes that came out of decisions you have already made and now apply beyond the
case that produced them. Promote an entry from `memory/notes/` once
the same reasoning has decided a second question, and write the axis rather
than the case.

<!-- e.g.
     - P-22 Replace an overlapping tool rather than keeping both and drawing the
       line in their descriptions. -->
