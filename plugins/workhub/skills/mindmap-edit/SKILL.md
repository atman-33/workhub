---
name: mindmap-edit
description: Edit a workhub mindmap note (projects/<slug>/mindmaps/*.md) from a natural-language instruction — add, rename, move, group, colour or link the nodes in `## Nodes`. Use when asked to restructure a mindmap, group ideas under a new branch, prune a subtree, or when the workhub app launches a mindmap edit.
argument-hint: "<mindmap-file-path> <instruction>"
---

# Mindmap Edit

Apply a natural-language instruction to one workhub mindmap note by rewriting
**only the affected lines**.

This skill is normally launched by the workhub app's Mindmap tab, which passes
the file path and the instruction. It also works when invoked by hand.

## The file

A mindmap note is Markdown with flat frontmatter and one managed section:

```markdown
---
type: mindmap
title: workhub ideas
created: 2026-08-26
updated: 2026-08-26
---

## Nodes

- N-001 workhub #blue
  - N-002 tasks #green task:T-0042
    - N-003 kanban ^collapsed
      - N-006 swimlanes
  - N-004 schedule #amber
    lead times are still guesses
  - N-005 mindmap

## Memo

Free-form prose. Never rewritten by this skill.
```

### Notation

Node line:

```text
- <id> <title> [#<color>] [task:<task-id>] [^collapsed] [^left|^right]
```

| Field | Rule |
|---|---|
| `<id>` | `N-` + a zero-padded number, unique in the file. **Never change it.** |
| `<title>` | Free text, one line. Everything left after the modifiers are removed. |
| `#<color>` | Optional, one of `blue`, `green`, `amber`, `red`, `purple`, `gray`. |
| `task:<id>` | Optional link to a task in `tasks/`. |
| `^collapsed` | Optional. The node's children are hidden **in the app**; the subtree is unaffected. |
| `^left` / `^right` | Optional, and only meaningful on a **child of a root**: which side of the centre that branch is drawn on. Without it, branches alternate by their position in the list. |

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
   - no node lost its `task:` link, its `^collapsed` flag or its note lines
     unless the instruction asked for that.
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
  (`auto` / `siblings` / `depth`) is the note's box-width setting — a display
  preference the user sets in the app, not something an instruction about the
  tree should change.
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
