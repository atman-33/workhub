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
The `diagram-edit` skill edits any of them from a natural-language instruction:
it reads the note's `type` and follows the matching rule, so the formats live
here and in those two files, not in the skill.

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
  you change the note), plus the kind's own keys. Managed sections, then an
  optional `## Stickies`, then `## Memo`. **Never edit `## Memo`**, and leave
  sections you do not recognise where they are.
- Every element has an id (`N-001`, `M-001`, `F-001`, `P-001`, ...) that is **never
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
  not drawn. The end labels sit outside the plot at the middle of each edge (`x_low` left, `x_high` right, `y_high` top, `y_low` bottom); the axis names are small, below the right end and along the top of the left edge; the quadrant names are a faint watermark in each quadrant centre. With the axes above, the top left is "low effort / high impact".
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
  out (a malformed `@` stays in it); keep it to one line.
- **`## Stickies`** pins a note to an item: `node:M-NNN` names the item (the key
  is `node:` in every kind). The offset is from the item's centre to the
  sticky's top-left corner in pixels. Delete an item and delete its stickies.
- **Keep what you do not understand.** A line under `## Items` that is not a
  list item, or that starts with another kind's id (`N-001`, `F-002`), is kept
  by the app as it is and listed as a warning; leave it alone, and a sticky
  whose `node:` names no item too. Never edit `## Memo`.

## flow

A business flow: steps in swimlanes, joined by arrows. Self-contained -
everything an edit needs is here.

```markdown
---
type: flow
title: 受注フロー
created: 2026-10-09
updated: 2026-10-09
---

## Lanes

- L-001 営業 #blue
- L-002 経理 #green

## Steps

- F-001 受注 ^start lane:L-001
- F-002 見積を作る lane:L-001 task:T-0100
  メモ行。hover で出る。
- F-003 金額 1 万円超? ^decision lane:L-001
- F-004 承認する lane:L-002 @640,0
- F-005 完了 ^end lane:L-001

## Edges

- F-001 -> F-002
- F-002 -> F-003
- F-003 -> F-004 "はい"
- F-003 -> F-005 "いいえ"
- F-004 -> F-002 "差し戻し"

## Stickies

- S-001 node:F-004 @40,-20 #red 要確認
```

- **Frontmatter**: `type`, `title`, `created`, `updated` as for every
  diagram; `stickies: hidden` is the only other key. No view settings.
- **Sections** in this order: `## Lanes`, `## Steps`, `## Edges`, then the optional
  `## Stickies` and `## Memo`. A missing managed section is written in by the app.
- **Lane**: `- L-NNN <title> [#color]`. The order of the lines is the order of
  the bands, top to bottom. A flow with no lanes is one plain row.
- **Step**: `- F-NNN <title> [^kind] [lane:L-NNN] [task:<id>] [#color] [@x,y]`,
  then optional indented lines (its note). Ids are the highest in the file plus
  one; never change or reuse one. The kind is `^start` or `^end` (rounded ends),
  `^decision` (diamond), or none for a process (box). Put a question in a
  decision's title ("金額 1 万円超?") and label its outgoing arrows. The title is
  every token left once the modifiers are taken out; keep it to one line.
- **Lane membership**: `lane:L-NNN` names the lane the step belongs to. A step
  with no `lane:`, or one naming a lane that does not exist, is shown in an
  "Unassigned" band at the bottom. When you add a lane or step, give the step its
  `lane:`.
- **Arrow**: `- F-NNN -> F-NNN ["label"]`. Arrows have no id; the pair
  `(from, to)` is the identity, so two lines for the same pair are one arrow (the
  app keeps the first label). An arrow naming a step that does not exist is kept
  by the app as it is and listed as a warning.
- **Layout is automatic**: columns follow the flow (a step sits one column right
  of the furthest step that flows into it) and rows are the lanes. An arrow that
  goes back to an earlier step is drawn as a loop under the boxes and does not
  move any column. Write the steps in flow order and add the arrows; do not
  invent positions.
- **`@x,y`** pins a step by hand. `x` is the centre's absolute horizontal position
  in pixels; `y` is the vertical offset in pixels from the middle of the step's
  lane (0 is the lane's centre line, negative is up), and the step stays inside
  the lane. Whole numbers. **No `@` means "placed by the layout"**: when you add a
  step leave the `@` off, and never rewrite another step's position. Moving a
  step to another lane means changing its `lane:` and setting `y` to 0. Removing
  every `@` is the app's "auto-align".
- **`## Stickies`** pins a note to a step: `node:F-NNN` names the step (the key is
  `node:` in every kind). Not to lanes or arrows. Delete a step and delete its
  arrows and stickies.
- **Keep what you do not understand.** A line under `## Lanes`, `## Steps` or
  `## Edges` that is not a list item, or starts with another kind's id (`N-001`,
  `M-001`, `P-001`), is kept by the app as it is and listed as a warning; leave it
  alone, and a sticky whose `node:` names no step too. Never edit `## Memo`.

## pfd

A PFD (process flow diagram): **processes** and the **deliverables** they
produce or use, joined by arrows. Self-contained - everything an edit needs is
here.

```markdown
---
type: pfd
title: 開発の流れ
created: 2026-10-10
updated: 2026-10-10
---

## Nodes

- P-001 要件を整理する @120,160
  メモ行。定義書の要点など。hover で出る。
- D-001 要件定義書 task:T-0100 #amber @360,160
- P-002 設計する

## Edges

- P-001 -> D-001
- D-001 -> P-002

## Stickies

- S-001 node:D-001 @40,-20 #red 要確認
```

- **Frontmatter**: as for every diagram; `stickies: hidden` is the only other key.
  **Sections** in this order: `## Nodes`, `## Edges`, then the optional
  `## Stickies` and `## Memo`.
- **Node**: `- <id> <title> [task:<id>] [#color] [@x,y]`, then optional indented
  lines (its note, shown on hover). Tokens may come in any order; the title is
  what is left, on one line.
- **What a node is comes from its id prefix**, nothing else: `P-NNN` is a
  **process** (an oval; name it with a verb phrase - "要件を整理する"), `D-NNN` a
  **deliverable** (a document shape with a wavy bottom edge; name it with a noun -
  "要件定義書"). Numbers run per prefix: the highest `P-` in the file plus one for
  the next process, likewise for `D-`. Never change or reuse an id, and never
  turn a `P-` into a `D-` by editing the prefix - make a new node.
- **Arrow**: `- <from> -> <to>`, no label, no id; the pair `(from, to)` is the
  identity and two lines for one pair are one arrow. **Only a process to a
  deliverable and a deliverable to a process are allowed** (a process makes or
  reads a deliverable; a deliverable feeds the next process). An arrow between two
  nodes of the same kind, or naming a node that does not exist, is kept by the app
  as it is, listed as a warning and not drawn: do not write one.
- **`@x,y`** pins a node by hand: its centre in absolute diagram pixels, whole
  numbers, negatives allowed, y growing downward. **No `@` means "placed by the
  layout"**, in columns that follow the arrows (a node sits one column right of
  the furthest node that flows into it): when you add a node leave the `@` off,
  write nodes in flow order, and never rewrite another node's position. The app
  writes `@` only on the node the user dragged; removing every `@` is its
  "auto-align". There are no lanes.
- **`## Stickies`** pins a note to a node: `node:P-NNN` or `node:D-NNN` (the key is
  `node:` in every kind). Not to arrows. Delete a node and delete its arrows and
  stickies.
- **Symbols are a closed list.** Only `P-` and `D-` exist today. A line whose
  prefix is anything else (`X-001`, `F-001`, `N-001`, ...) is kept by the app as it
  is and listed as a warning, which is also how a symbol not yet confirmed
  survives. **Do not invent a prefix to express something new** - ask the owner,
  and use a `P-` or `D-` node meanwhile. Leave such lines, lines that are not list
  items and stickies whose `node:` names no node alone. Never edit `## Memo`.
- **Adding a symbol (for the app's developers, not for note edits)**: add one entry
  `{ prefix, name, shape, label, next }` to `SYMBOLS` in
  `src/lib/diagram/pfd/symbols.ts` - `shape` an id from the shape registry
  (`src/lib/diagram/shapes.ts`, `registerShape` for a new outline), `next` the
  prefixes an arrow from it may reach (and add its prefix to the `next` of the
  symbols that may lead to it). The line grammar does not change; then list the
  new prefix in this section.
