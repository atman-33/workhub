---
name: schedule-edit
description: Edit a workhub schedule note (projects/<slug>/schedules/*.md) from a natural-language instruction — move or resize the bars, milestones and notes in `## Items`, and adjust `## Non-working` days. Use when asked to shift a phase, rebalance a plan, add or remove non-working days, or when the workhub app launches a schedule edit.
argument-hint: "<schedule-file-path> <instruction>"
---

# Schedule Edit

Apply a natural-language instruction to one workhub schedule note by rewriting
**only the affected lines**.

This skill is normally launched by the workhub app's Schedule tab, which passes
the file path and the instruction. It also works when invoked by hand.

## The file

A schedule note is Markdown with flat frontmatter and two managed sections:

```markdown
---
type: schedule
title: 2026Q3 release plan
range: 2026-07-20..2026-08-31
created: 2026-07-24
updated: 2026-07-24
---

## Non-working

- weekly: sat, sun
- 2026-08-11 Mountain Day
- 2026-08-13..2026-08-15 summer leave

## Items

- [bar] I-001 2026-07-21..2026-08-07 implementation #blue task:T-0090
- [bar] I-002 2026-08-08..2026-08-19 integration test #amber
- [milestone] I-003 2026-08-20 release review #red
- [note] I-004 2026-07-31 monthly review 15:00

## Memo

Free-form prose. Never rewritten by this skill.
```

### Notation

Element line:

```text
- [<kind>] <id> <date-spec> <title> [#<color>] [task:<task-id>]
```

| Field | Rule |
|---|---|
| `<kind>` | `bar`, `milestone`, or `note`. No other kinds exist. |
| `<id>` | `I-` + a zero-padded number, unique in the file. **Never change it.** |
| `<date-spec>` | `bar`: `YYYY-MM-DD..YYYY-MM-DD`. `milestone`/`note`: a single `YYYY-MM-DD`. |
| `#<color>` | Optional, one of `blue`, `green`, `amber`, `red`, `purple`, `gray`. |
| `task:<id>` | Optional link to a task in `tasks/`. |

An element may carry a **body** on indented continuation lines beneath it —
ordinary Markdown list continuation. Any kind may have one; a `note` is the
usual case, since a note is a comment about the day:

```text
- [note] I-004 2026-07-31 monthly review
  15:00-16:00, room A
  bring the deck
- [bar] I-002 2026-08-08..2026-08-19 integration test #amber
  QA lead is away the first week
```

The body belongs to its element: when you move or edit the element, **keep its
continuation lines with it**, and never merge a body into the element's first
line (the first line is the grammar line, and a newline in it would produce a
second, unparsable element).

Non-working line — one of:

```text
- weekly: sat, sun          # weekday names: sun mon tue wed thu fri sat
- 2026-08-11 Mountain Day
- 2026-08-13..2026-08-15 summer leave
```

## Procedure

1. **Read the whole file** before editing. You need the current dates to
   compute a relative instruction ("push it back a week") correctly.
2. **Identify the elements the instruction names**, by title or by id. If the
   instruction is ambiguous about which element it means, say so and stop —
   do not guess and edit.
3. **Compute the new dates.** Unless the instruction says otherwise, shifts are
   in calendar days: "one week later" is +7 calendar days, not 7 working days.
   When the instruction is explicitly about *working* days, count them using
   `## Non-working` (both the `weekly:` rule and the explicit ranges).
4. **Rewrite only the affected lines**, in place, keeping their order.
5. **Validate before writing:**
   - every `bar` has `start <= end`;
   - every date is a real calendar date in `YYYY-MM-DD` form;
   - ids are unchanged and still unique;
   - colors are from the list above;
   - no line lost its `task:` link unless the instruction asked for that.
6. **Write the file**, then **report** in one paragraph: which element ids
   changed, from what to what, and anything you declined to do.

## Never

- **Never rewrite the whole file.** The diff is what the user reviews and what
  the app's undo restores; a wholesale rewrite destroys both.
- **Never renumber or reuse an `id`.** Ids are how the app, the file's history,
  and this skill agree on which element is which. A new element gets the next
  unused number; a deleted element's number stays retired.
- **Never touch `## Memo` or anything after it.** That section is the human's.
- **Never orphan a continuation line.** An element's body moves with it; if you
  delete an element, delete its continuation lines too.
- **Never remove or reorder frontmatter keys** you do not recognize. Update
  `updated:` to today's date and leave the rest alone.
- **Never edit any file other than the target schedule.** In particular, do not
  update linked tasks in `tasks/` — the `task:` link is a reference, and
  changing a task's dates is a separate, explicit request.
- **Never change an element the instruction did not mention.**

## When the instruction cannot be satisfied

Report what blocked it and change nothing. Common cases:

- the named element does not exist, or two elements match the description;
- the requested move would invert a bar (`end` before `start`);
- the instruction asks for something the notation cannot express (a half-day,
  a dependency between elements). Suggest the nearest expressible change
  instead — often a `note` element carrying the detail in its title.

## Examples

**"Push the implementation phase back a week and shorten the integration test
by the same amount."**

```diff
-- [bar] I-001 2026-07-21..2026-08-07 implementation #blue task:T-0090
-- [bar] I-002 2026-08-08..2026-08-19 integration test #amber
+- [bar] I-001 2026-07-28..2026-08-14 implementation #blue task:T-0090
+- [bar] I-002 2026-08-15..2026-08-19 integration test #amber
```

Report: `I-001` moved +7 days (2026-07-28..2026-08-14); `I-002` now starts
2026-08-15, shortened from 12 to 5 calendar days.

**"Take 8/13 to 8/15 off as summer leave."**

```diff
 - 2026-08-11 Mountain Day
+- 2026-08-13..2026-08-15 summer leave
```
