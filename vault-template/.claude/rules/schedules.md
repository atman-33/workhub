---
paths:
  - "projects/*/schedules/**"
---

# Schedule notes

Format of a project's `schedules/` notes. The `diagram-edit` skill follows this file; the spec lives here, not in the skill.

`schedules/` holds the project's date planning. One file is one plan; copy it
to compare alternatives. The app's **Schedule** tab renders the file as a
continuous week grid and writes changes straight back, so the note stays
editable in Obsidian at the same time.

Frontmatter is flat (`type: schedule`, `title`, `range`, `created`,
`updated`); the content lives in two managed sections, plus a `## Memo`
section neither the app nor the AI ever rewrites:

```markdown
## Non-working

- weekly: sat, sun
- 2026-08-11 Mountain Day
- 2026-08-13..2026-08-15 summer leave

## Items

- [bar] I-001 2026-07-21..2026-08-07 implementation #blue task:T-0090
- [arrow] I-005 2026-07-21..2026-08-19 vendor lead time #gray
- [milestone] I-003 2026-08-20 release review #red
- [note] I-004 2026-07-31 monthly review 15:00
```

Element line: `- [<kind>] <id> <date-spec> <title> [#<color>] [task:<task-id>]`

- `<kind>` is `bar`, `arrow`, `milestone`, or `note`. A `bar` is a period that
  is settled; an `arrow` is the same span drawn as a thin double-headed line,
  for a period that is still an estimate (lead time, buffer, parallel work).
- `<id>` is `I-` + a number, unique in the file. **Never change or reuse one** —
  it is how the app and the AI identify an element across edits.
- `<date-spec>` is `YYYY-MM-DD..YYYY-MM-DD` for a `bar` or `arrow`, a single
  `YYYY-MM-DD` otherwise.
- `#<color>` is one of `blue`, `green`, `amber`, `red`, `purple`, `gray`.
- `task:<task-id>` links the element to a task in `tasks/`.
- An element may carry extra lines of text on **indented continuation lines**
  beneath it (ordinary Markdown list continuation). A `note` shows them on
  hover in the app; every other kind shows them in its tooltip.

```markdown
- [note] I-004 2026-07-31 monthly review
  15:00-16:00, room A
```

Non-working days drive the working-day counts the grid shows. Schedule
elements are **not** tasks: they are candidates under consideration, and
putting them on the board would break its meaning. A task appears on the
calendar through its own `due` date, or via a `task:` link.
