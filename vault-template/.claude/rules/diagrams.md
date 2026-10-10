---
paths:
  - "projects/*/diagrams/**"
  - "projects/*/backlog/**"
---

# Diagram notes

A **diagram** is a note under `projects/<NNNN-slug>/` whose frontmatter `type`
is one of `schedule`, `mindmap`, `matrix2x2`, `flow`, `pfd`, `algorithm` or `ifdam`. The app's
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
  you change the note), plus the kind's own keys. Managed sections (a 2x2
  matrix's optional `## Quadrants` is one of them), then an optional
  `## Stickies`, then `## Memo`. **Never edit `## Memo`**, and leave
  sections you do not recognise where they are.
- Every element has an id (`N-001`, `M-001`, `F-001`, `P-001`, `A-001`, `V-001`, ...) that is **never
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

## Quadrants

- q_tl 先にやる前に、前提を確認する。
  二行目。
  - 入れ子の箇条書きもそのまま
- q_br やらない理由: 効果が薄い

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
- **`## Quadrants`** (optional, right after `## Items`) holds one note per
  quadrant - what the quadrant means and how to respond to it, longer than the
  one-line `q_tl` name. An entry is `- q_tl <first line>` at column 0, the key
  being the frontmatter's own (`q_tl` `q_tr` `q_bl` `q_br`), then the rest of
  the note on indented lines (two spaces). Unlike an item's note, those lines
  may be blank (a paragraph break) or start with `- ` (a nested bullet); only a
  column-0 `- q_xx` opens a new entry. The note belongs to the position, not to
  the name, so renaming `q_tl` never moves it. Write at most one entry per
  quadrant, in the order tl, tr, bl, br; leave out a quadrant with no note and
  the whole heading when there is none - add it only with the first note.
  Change only the quadrants the instruction is about. It is not `## Memo`, and
  it is not the `q_tl` name in the frontmatter: those stay as they are. A line
  under it that is not a known entry (an unknown key, a second entry for the
  same quadrant, un-indented text) is kept by the app and listed as a warning;
  leave it alone. The app shows a small mark in a quadrant that has a note and
  the note on hover; the exported image does not carry it.
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
  turn a `P-` into a `D-` by editing the prefix. **Changing a node's kind** (what
  the editor's Kind selector does) means a new id: take the highest id of the other
  prefix plus one, put the node's line (title, tokens, note, `@x,y`) under it in
  the same place, rewrite every arrow end and every sticky `node:` that named the
  old id, and retire the old id. A node with arrows converts like any other:
  the arrows just follow the new id, whatever kinds they then join.
- **Arrow**: `- <from> -> <to>`, no label, no id; the pair `(from, to)` is the
  identity and two lines for one pair are one arrow. **An arrow may join any two
  nodes**: process to deliverable and back (the usual flow: a process makes or
  reads a deliverable, a deliverable feeds the next process), and also process to
  process or deliverable to deliverable. An arrow naming a node that does not
  exist is kept by the app as it is, listed as a warning and not drawn: do not
  write one.
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

## algorithm

A program flow chart (an algorithm, a function, a batch): **nodes** joined by
arrows, drawn top to bottom. Not a business flow (`flow`: people and swimlanes)
and not a PFD (`pfd`: work and deliverables). Self-contained - everything an edit
needs is here.

```markdown
---
type: algorithm
title: 注文の在庫引当
created: 2026-10-10
updated: 2026-10-10
---

## Nodes

- A-001 引当開始 ^start
- A-002 注文を読み込む ^io
- A-003 在庫あり? ^decision
- A-004 在庫を引き当てる ^sub task:T-0100
  メモ行。hover で出る。
- A-005 入荷を待つ #amber
- A-006 結果を返す ^io @220,560
- A-007 終了 ^end

## Edges

- A-001 -> A-002
- A-002 -> A-003
- A-003 -> A-004 "はい"
- A-003 -> A-005 "いいえ"
- A-004 -> A-006
- A-006 -> A-007
- A-005 -> A-002 "入荷後に再試行"

## Stickies

- S-001 node:A-003 @40,-30 #red 在庫の定義を確認
```

- **Frontmatter**: as for every diagram; `stickies: hidden` is the only other key
  in use. `direction:` is reserved (a later release may offer a horizontal
  chart): do not write it, and leave it alone if it is there. **Sections** in
  this order: `## Nodes`, `## Edges`, then the optional `## Stickies` and
  `## Memo`. There are no lanes.
- **Node**: `- A-NNN <title> [^mark] [task:<id>] [#color] [@x,y]`, then optional
  indented lines (its note, shown on hover). Tokens may come in any order; the
  title is what is left, on one line. Ids are `A-` plus the highest number in the
  file plus one; never change or reuse one.
- **`^mark` decides the shape**; no mark is a process (a box; `^process` also
  reads). `^start` and `^end` rounded terminals, `^decision` a diamond, `^io`
  input/output (a parallelogram), `^sub` a predefined process (a box with inner
  rules - a call to a function or a sub-flow), `^doc` a document. One mark per
  node. A `^word` that is not in this list is not a mark: it stays in the title.
  Name a process with a verb phrase, a decision with a question ("在庫あり?"), and
  use one `^start` and as many `^end` as needed.
- **Arrow**: `- A-NNN -> A-NNN ["label"]`, no id; the pair `(from, to)` is the
  identity and two lines for one pair are one arrow (the app keeps the first
  label). Any two different nodes may be joined, and a decision may have any
  number of exits. **Label the exits of a decision** ("はい" / "いいえ", or the
  case). An arrow naming a node that does not exist is kept by the app as it is,
  listed as a warning and not drawn: do not write one. An arrow from a node to
  itself is kept and not drawn.
- **Layout is automatic, and the order you write the arrows in matters.** A node
  sits one row below the furthest node that flows into it. A node's **first**
  exit (its first arrow in `## Edges`) continues straight down, so write the main
  path first; the second exit goes to a new column on the right, the third to one
  on the left, and so on. An arrow that goes back to an earlier node (a loop) is
  drawn round the right side and moves no row. Write nodes in flow order and the
  arrows after them; do not invent positions.
- **`@x,y`** pins a node by hand: its centre in absolute diagram pixels, whole
  numbers, negatives allowed, y growing downward. **No `@` means "placed by the
  layout"**: when you add a node leave the `@` off, and never rewrite another
  node's position. The app writes `@` only on the node the user dragged;
  removing every `@` is its "auto-align".
- **Changing a node's kind** is changing its `^mark` (the id stays).
- **`## Stickies`** pins a note to a node: `node:A-NNN` (the key is `node:` in
  every kind). Not to arrows. Delete a node and delete its arrows and stickies.
- **Keep what you do not understand.** A line under `## Nodes` or `## Edges`
  that is not a list item, or starts with another kind's id (`F-001`, `P-001`,
  `N-001`), is kept by the app as it is and listed as a warning; leave it alone,
  and a sticky whose `node:` names no node too. Never edit `## Memo`.
- **Adding a symbol (for the app's developers, not for note edits)**: add one
  entry `{ kind, mark, shape, label }` to `SYMBOLS` in
  `src/lib/diagram/algorithm/symbols.ts` (and the shape to
  `src/lib/diagram/shapes.ts` when none fits); the line grammar does not change.

## ifdam

An IFDAM diagram (shown as "IFDAM 図" / "IFDAM"): **one feature of an app**, drawn
as the **screens** the user sees, the **triggers** (what the user does on a
screen), the **processes** the app runs, the **data stores** they read and write
and the **messages** they show. A screen is a box that holds its contents:
what it shows, what the user enters, what the user can press. Not a program flow
(`algorithm`: the steps inside one function) and not a PFD (`pfd`: work and
deliverables). Self-contained - everything an edit needs is here.

```markdown
---
type: ifdam
title: Todo の登録
created: 2026-10-10
updated: 2026-10-10
---

## Nodes

- V-001 Todo 一覧 ^screen
  show: 登録済みの Todo の一覧
  show: 件数
  input: 検索語
  action: 「追加」ボタン
- V-002 「追加」ボタンをクリック ^trigger
- V-003 Todo 追加 ^screen @560,200
  show: 入力フォームの見出し
  input: タイトル（必須）
  input: 期限
  action: 「登録」ボタン
  action: 「キャンセル」ボタン
  登録に成功したら一覧へ戻る。
- V-004 「登録」ボタンをクリック ^trigger
- V-005 Todo を登録する task:T-0100
- V-006 Todo ^store
- V-007 「登録しました」を表示する ^message
- V-008 一覧を取得する

## Edges

- V-001 -> V-002
- V-002 -> V-003
- V-003 -> V-004
- V-004 -> V-005
- V-005 -> V-006
- V-005 -> V-007
- V-007 -> V-008
- V-006 -> V-008
- V-008 -> V-001

## Stickies

- S-001 node:V-005 @40,-30 #red 重複チェックは未定
```

- **Frontmatter**: as for every diagram; `stickies: hidden` is the only other key.
  **Sections** in this order: `## Nodes`, `## Edges`, then the optional
  `## Stickies` and `## Memo`. There are no lanes.
- **Node**: `- V-NNN <title> [^mark] [task:<id>] [#color] [@x,y]`, then optional
  indented continuation lines. Tokens may come in any order; the title is what is
  left, on one line. Ids are `V-` plus the highest number in the file plus one;
  never change or reuse one.
- **`^mark` says what the element is**; no mark is a process (`^process` also
  reads). `^screen` a screen (a box with sections), `^trigger` a trigger (a
  hexagon), `^store` a data store (a cylinder), `^message` a message (a rounded
  box); a process is an oval. One mark per node. A `^word` that is not in this list
  is not a mark: it stays in the title. **Name them by what they are**: a trigger
  is something that happens ("「追加」ボタンをクリック", "画面を開く"), a process a verb
  phrase ("Todo を登録する"), a data store a noun ("Todo"), a message the text
  shown ("「登録しました」を表示する"), a screen its name ("Todo 一覧").
- **A screen's contents are its continuation lines**, one item per line, each
  starting with a key: `show: <text>` for what the screen shows, `input: <text>` for
  what the user enters, `action: <text>` for what the user can press or choose.
  The keys are exactly `show:` `input:` `action:` (lower case, whatever language
  the text is in). **Write one item per line and a key on every line**; do not
  nest bullets, do not put several items on one line, do not write a heading line
  for a section. Add an item by adding a line; the app draws the sections in the
  order show, input, action whatever order the lines are in, and draws only the
  sections that have items. **Keep the lines in the order they are in**: never
  regroup or sort them. A continuation line with no key (or with a key and no text)
  is the node's **memo**, shown on hover; it is not drawn in the box.
- **Items belong to the screen.** Do not repeat an item in the trigger that
  follows it: the button is an `action:` of the screen, "「追加」ボタンをクリック" is
  the trigger that happens when it is pressed. `show:` `input:` `action:` under a
  node that is not a `^screen` are plain memo text and are not drawn as items;
  changing a screen to another kind (or back) never deletes a line.
- **Arrow**: `- V-NNN -> V-NNN ["label"]`, no id; the pair `(from, to)` is the
  identity and two lines for one pair are one arrow (the app keeps the first
  label). Any two different nodes may be joined; there is no connection rule. The
  usual flow is screen -> trigger -> process -> message (or screen) -> screen.
  **The direction to or from a data store says how it is used**: process -> store
  writes, store -> process reads; write both when it does both (they are drawn on
  one line with a head at each end, so give such arrows no label). Label the exits
  of a process only when they differ ("成功" / "失敗"). An arrow naming a node that
  does not exist is kept by the app as it is, listed as a warning and not drawn:
  do not write one. An arrow from a node to itself is kept and not drawn.
- **Layout is automatic and runs left to right.** A node sits one column right of
  the furthest node that flows into it (the arrows that touch a data store do not
  count). A **data store sits below, in the column of the first node that has an
  arrow to or from it** (the first such arrow in `## Edges`), so write that arrow
  first; more stores for the same node stack under it in the order written. An
  arrow that goes back to the left (the loop back to the list screen) is drawn
  under the whole diagram. **Write the entry screen first, then the nodes in
  flow order, then the arrows**, ending with the arrow back to the entry screen
  when there is a loop. Do not invent positions.
- **`@x,y`** pins a node by hand: its centre in absolute diagram pixels, whole
  numbers, negatives allowed, y growing downward. **No `@` means "placed by the
  layout"**: when you add a node leave the `@` off, and never rewrite another
  node's position. The app writes `@` only on the node the user dragged; removing
  every `@` is its "auto-align".
- **Changing a node's kind** is changing its `^mark` (the id stays).
- **`## Stickies`** pins a note to a node: `node:V-NNN` (the key is `node:` in
  every kind). Not to arrows. Delete a node and delete its arrows and stickies.
- **Keep what you do not understand.** A line under `## Nodes` or `## Edges`
  that is not a list item (a `show: x` at column 0, for one), or starts with
  another kind's id (`F-001`, `P-001`, `A-001`, `N-001`), is kept by the app as
  it is and listed as a warning; leave it alone, and a sticky whose `node:` names
  no node too. Never edit `## Memo`.
- **Adding an element (for the app's developers, not for note edits)**: add one
  entry `{ kind, mark, shape, label, next }` to `SYMBOLS` in
  `src/lib/diagram/ifdam/symbols.ts` (and the shape to
  `src/lib/diagram/shapes.ts` when none fits); the line grammar does not change.
