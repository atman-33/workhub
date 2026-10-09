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

The format of each newer kind is added below when its editor ships.

## matrix2x2

A 2x2 matrix: items placed on two axes (effort against impact, say), with the
four quadrants optionally named. Self-contained - everything an edit needs is
here.

```markdown
---
type: matrix2x2
title: 施策の優先度
created: 2026-10-09
updated: 2026-10-09
x_axis: 工数
x_low: 小
x_high: 大
y_axis: 効果
y_low: 小
y_high: 大
q_tl: 先にやる
q_tr: 計画してやる
q_bl: 気が向いたら
q_br: やらない
---

## Items

- M-001 タブの並び替え @0.20,0.85 #green task:T-0684
- M-002 図解 AI 編集 @0.75,0.70 #blue
  メモ行。hover で出る。
- M-003 まだ置いていない項目

## Stickies

- S-001 node:M-002 @40,-20 #red 要確認
```

- **Frontmatter**: `type`, `title`, `created`, `updated` as for every diagram,
  plus ten optional labels, each on one line and written without a trailing
  `# comment`: the horizontal axis (`x_axis`, its left end `x_low`, its right
  end `x_high`), the vertical axis (`y_axis`, its bottom end `y_low`, its top
  end `y_high`) and the four quadrants (`q_tl` top left, `q_tr` top right,
  `q_bl` bottom left, `q_br` bottom right). An empty or absent label is simply
  not drawn. With the axes above, the top left is "low effort / high impact".
- **`## Items`** holds one line per item: `- M-NNN <title> [@x,y] [#color]
  [task:T-xxxx]`, then optional indented lines (the item's note). Ids are
  `M-` plus three digits or more, taken as the highest in the file plus one;
  never change or reuse one.
- **`@x,y`** is the item's centre. Both numbers run 0 to 1 with at most two
  decimals, written as `0.70`. **x: 0 is the left edge, 1 the right. y: 0 is the
  bottom, 1 the top** (higher is up - the opposite of screen coordinates). Values
  outside 0..1 are clamped. Put an important item at `y` near 1, not near 0.
- **No `@`** means "not placed yet": the app draws it near the middle, a little
  apart from the other unplaced ones, and writes a position only when someone
  drags it. When you add an item and have no view on where it goes, leave the
  `@` off rather than inventing one. Moving one item changes only that item's
  `@`; never rewrite the others' positions.
- **Title** is every token left once `@x,y`, `#color` and `task:` are taken
  out; a malformed `@` stays in the title. Keep it to one line.
- **`## Stickies`** pins a note to an item: `node:M-NNN` names the item (the key
  is `node:` in every kind). The offset is from the item's centre to the
  sticky's top-left corner in pixels. Delete an item and delete its stickies.
- **Keep what you do not understand.** A line under `## Items` that is not a
  list item, or that starts with another kind's id (`N-001`, `F-002`), is kept
  by the app as it is and listed as a warning; leave such lines alone. A
  sticky whose `node:` names no item is kept too.
- **Never edit `## Memo`**, and leave any section you do not know where it is.
