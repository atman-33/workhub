---
paths:
  - "projects/*/diagrams/**"
  - "projects/*/backlog/**"
---

# Diagram notes

A **diagram** is a note under `projects/<NNNN-slug>/` whose frontmatter `type`
is one of `schedule`, `mindmap`, `matrix2x2`, `flow` or `pfd`. The app's
**Diagrams** tab lists them all and opens the editor for the note's `type`.
Each kind's own format is below (Schedule and Mindmap keep their own rules,
`schedules.md` and `mindmaps.md`; read the one for the note's `type`).

## Where a diagram lives

The folder does not decide what a note is; `type` does. The tab scans
`projects/*/` (archived projects are not looked at), up to three levels deep,
reading only the top of each file:

- `diagrams/<name>.md` — project-wide diagrams of the newer kinds. Created on
  the first one.
- `schedules/` and `mindmaps/` — where the older kinds were always kept, and
  where the tab still creates them for a project-wide note.
- `backlog/B-NNN-<slug>/NNN-<name>.md` — a diagram that belongs to one unit of
  work. Named like any child note of an item (tens, never renumbered).
- A file whose name starts with `_` is never listed.
- A note with no `type` is a diagram only inside `schedules/` or `mindmaps/`.

New projects start with none of these folders; create the one a diagram needs.

## What every diagram shares

- Flat frontmatter: `type`, `title`, `created`, `updated` (set `updated` when
  you change the note), plus the kind's own optional keys.
- Managed sections, then an optional `## Stickies`, then `## Memo`. **Never
  edit `## Memo`**, and leave sections you do not recognise where they are.
- Every element has an id (`N-001`, `M-001`, `F-001`, ...) that is **never
  changed or reused**. An element typed without one is given one by the app.
- A line is `- <id> <title> [tokens]`: whitespace-separated tokens such as
  `#<color>` and `task:<task-id>` are pulled out, the rest is the title. Extra
  indented lines under it are its note, shown on hover.
- Colours: `blue`, `green`, `amber`, `red`, `purple`, `gray`.
- A sticky is `- S-001 node:<element-id> @<dx>,<dy> [#<color>] [text]`: a note
  pinned to an element, `@dx,dy` being the offset in pixels from the element's
  centre to the sticky's top-left corner (default `@32,24`). Deleting an
  element deletes its stickies. `stickies: hidden` in the frontmatter hides
  them all.
- The view (zoom, pan) is never stored in the file.

The format of each newer kind is added here when its editor ships.
