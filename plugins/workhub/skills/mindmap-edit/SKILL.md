---
name: mindmap-edit
description: Edit a workhub mindmap note (projects/<slug>/mindmaps/*.md) from a natural-language instruction — add, rename, move, group, colour or link the nodes in `## Nodes`, and annotate them with sticky notes in `## Stickies`. Use when asked to restructure a mindmap, group ideas under a new branch, prune a subtree, pin a note to a node, or when the workhub app launches a mindmap edit.
argument-hint: "<mindmap-file-path> <instruction>"
---

# Mindmap Edit

Apply a natural-language instruction to one workhub mindmap note by rewriting
**only the affected lines**.

This skill is normally launched by the workhub app's Mindmap tab, which passes
the file path and the instruction. It also works when invoked by hand.

## The file

A mindmap note is Markdown with flat frontmatter and two managed sections —
`## Nodes` (the tree) and the optional `## Stickies` (notes pinned to nodes):

```markdown
---
type: mindmap
title: workhub ideas
created: 2026-08-26
updated: 2026-08-26
---

## Nodes

- N-001 workhub #blue
  - N-002 tasks #green task:T-0042 prio:high tags:検討中
    - N-003 kanban ^collapsed
      - N-006 swimlanes
  - N-004 schedule #amber
    lead times are still guesses
  - N-005 mindmap

## Stickies

- S-001 node:N-004 @96,24 #amber lead time is a guess
  confirm with the vendor first

## Memo

Free-form prose. Never rewritten by this skill.
```

### Notation

Node line:

```text
- <id> <title> [#<color>] [task:<task-id>] [<key>:<value> ...] [^collapsed] [^left|^right]
```

| Field | Rule |
|---|---|
| `<id>` | `N-` + a zero-padded number, unique in the file. **Never change it.** |
| `<title>` | Free text, one line. Everything left after the modifiers are removed. |
| `#<color>` | Optional, one of `blue`, `green`, `amber`, `red`, `purple`, `gray`. |
| `task:<id>` | Optional link to a task in `tasks/`. |
| `<key>:<value>` | Optional attributes, any number, any order. Key is lowercase ASCII `[a-z][a-z0-9_-]*`, 24 characters at most; the value carries no spaces. `tags:` is comma-separated. |
| `^collapsed` | Optional. The node's children are hidden **in the app**; the subtree is unaffected. |
| `^left` / `^right` | Optional, and only meaningful on a **child of a root**: which side of the centre that branch is drawn on. Without it, branches alternate by their position in the list. |

**Attributes** are how a map is labelled for sorting and grouping — importance,
priority, an owner, a status, free tags. There is no fixed list of keys: use the
ones the map already uses, and only introduce a new key when the instruction
asks for something none of them covers. Write them after `task:` and before
`^collapsed`, sorted by key, which is the order the app writes them in — a diff
should show the word that changed, not a reordered line. (The order attributes
are *drawn* in is a separate, per-note setting; the line itself is always
sorted.) Inside a `tags:` value the order is the user's and must be preserved.

Anything that does not match the key rule stays part of the title, so a title
containing `15:00`, `https://example.com` or `Q3:目標` is safe and must be left
alone. A value that needs a space uses `_`.

**Nesting is indentation**: two spaces per level, exactly as Obsidian renders a
nested bullet list. A node's parent is the nearest node one level shallower
above it. There are no positions or coordinates in the file — the app lays the
map out itself every time it draws it, so structure is the only thing you have
to get right.

A node may carry a **note** on indented continuation lines beneath it —
ordinary Markdown list continuation, one level deeper than the node itself:

```text
  - N-004 schedule #amber
    lead times are still guesses
    revisit after the vendor call
```

The note belongs to its node: when you move a node, **move its continuation
lines and its whole subtree with it**, and never merge a note into the node's
first line (the first line is the grammar line, and a newline in it would
produce a second, unparsable node).

Sides are the user's arrangement of the map, not decoration: keep `^left` /
`^right` exactly as you found them unless the instruction is about which side
something is on ("move the release branch to the left"). When you add a branch
beside an existing one, give it the same side as its neighbour — and if the
neighbours have no explicit side, write the side each one is *currently* drawn
on onto all of them first, so that inserting into the middle of the list does
not shuffle the others across the centre.

Colour is **inherited down a branch** in the app: a node with no `#colour` of
its own is drawn in the nearest coloured ancestor's colour. Colour the branch
head rather than every node in it.

### Sticky notes

`## Stickies` is optional: a map that has none carries no such section, and you
only add the heading when you add the first sticky. Put it **between `## Nodes`
and `## Memo`**.

Sticky line:

```text
- <id> node:<node-id> @<dx>,<dy> [#<color>] [<text>]
```

| Field | Rule |
|---|---|
| `<id>` | `S-` + a zero-padded number, unique in the file. **Never change or reuse one.** Retired numbers stay retired. |
| `node:<id>` | **Required** — the node the sticky is pinned to. A line without it is not a sticky and the app keeps it verbatim. |
| `@<dx>,<dy>` | Integer offset, in pixels, from the pinned node's **centre** to the sticky's top-left corner. Optional; `@32,24` is assumed. |
| `#<color>` | Optional, same palette as a node. Absent means `amber`. |
| `<text>` | Free text, continued on indented lines beneath the sticky exactly like a node's note. |

The offset is the **only** coordinate anywhere in the file, and it is relative
on purpose: the map is still laid out from the tree every time it is drawn, so
a sticky follows its node wherever the layout puts it. Leave an offset alone
unless the instruction is about where a sticky sits — it is the user's own
arrangement, like `^left` / `^right`.

Stickies do not affect the layout, so a new one can land on top of something.
When you add several to one node, stagger them (about 96,24 for the first and
roughly 14,18 further along for each after it).

A sticky is deleted when the node it is pinned to is deleted: a sticky whose
`node:` no longer exists is kept in the file but can never be shown.

The frontmatter key `stickies: hidden` means the user has hidden every sticky
on the map. It is a display setting — leave it as you found it, and if the
instruction asks you to add a sticky to a note that has it, say that the map is
currently hiding them.

## Procedure

1. **Read the whole file** before editing. A relative instruction ("group these
   under a new branch", "move it up a level") can only be computed from the
   current tree.
2. **Identify the nodes the instruction names**, by title or by id. If the
   instruction is ambiguous about which node it means, say so and stop — do not
   guess and edit.
3. **Work out the new structure.** Moving a node means moving its whole
   subtree; grouping means inserting one new parent and re-indenting the nodes
   that go under it.
4. **Rewrite only the affected lines**, keeping the order of everything else.
5. **Validate before writing:**
   - indentation is a multiple of two spaces, and no line is more than one
     level deeper than the line above it;
   - every node has an id, ids are unchanged and still unique;
   - a new node uses the next unused number, zero-padded to three digits;
   - colours are from the list above;
   - no node lost its `task:` link, its attributes, its `^collapsed` flag or
     its note lines unless the instruction asked for that;
   - every attribute key still matches `[a-z][a-z0-9_-]*` and no value contains
     a space — an attribute that breaks either rule silently becomes part of the
     title the next time the file is read;
   - every sticky still names a node that exists, keeps its id and its offset,
     and `## Stickies` still sits between `## Nodes` and `## Memo`.
6. **Write the file**, then **report** in one paragraph: which node ids changed,
   what happened to them, and anything you declined to do.

## Never

- **Never rewrite the whole file.** The diff is what the user reviews and what
  the app's undo restores; a wholesale rewrite destroys both.
- **Never renumber or reuse an `id`.** Ids are how the app, the file's history,
  and this skill agree on which node is which. A new node gets the next unused
  number; a deleted node's number stays retired.
- **Never touch `## Memo` or anything after it.** That section is the human's.
- **Never orphan a subtree or a continuation line.** Deleting a node deletes
  everything indented under it — say so in the report, with the count.
- **Never re-order siblings** the instruction did not mention. Sibling order is
  the author's, and the layout follows it.
- **Never drop a `^left` / `^right`.** Removing one lets the branch jump to the
  other side of the map on the next render.
- **Never remove or reorder frontmatter keys** you do not recognize. Update
  `updated:` to today's date and leave the rest alone. `node_width`
  (`auto` / `siblings` / `depth`) and `stickies: hidden` are the note's display
  settings — preferences the user sets in the app, not something an instruction
  about the tree should change.
- **Never move a sticky you were not asked to move.** Its `@dx,dy` is where the
  user dropped it, and it is the only position the file records.
- **Never edit any file other than the target mindmap.** In particular, do not
  create or update tasks in `tasks/` — the `task:` link is a reference, and
  making a task is a separate, explicit request.

## When the instruction cannot be satisfied

Report what blocked it and change nothing. Common cases:

- the named node does not exist, or two nodes match the description;
- the move would put a node inside its own subtree;
- the instruction asks for something the notation cannot express (a link
  between two branches, a node in two places, a specific position on screen).
  Say which part is not expressible and offer the nearest structure that is.

## Examples

**"Group the kanban and swimlane ideas under a new 'board' branch."**

```diff
   - N-002 tasks #green task:T-0042
-    - N-003 kanban ^collapsed
-      - N-006 swimlanes
+    - N-007 board
+      - N-003 kanban ^collapsed
+        - N-006 swimlanes
```

Report: added `N-007` "board" under `N-002`; `N-003` (and its child `N-006`)
moved one level deeper. No titles or flags changed.

**"Colour the schedule branch red instead of amber and link it to T-0090."**

```diff
-  - N-004 schedule #amber
+  - N-004 schedule #red task:T-0090
     lead times are still guesses
```

Report: `N-004` recoloured amber → red and linked to `T-0090`; its note line is
unchanged, and its children inherit the new colour.

**"Pin a reminder to the schedule branch that the dates need re-checking."**

```diff
+## Stickies
+
+- S-001 node:N-004 @96,24 #amber re-check the dates after the vendor call
```

Report: added sticky `S-001` on `N-004`. The note had no `## Stickies` section,
so it was created between `## Nodes` and `## Memo`; nothing in the tree changed.
