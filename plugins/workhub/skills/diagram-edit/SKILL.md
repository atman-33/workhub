---
name: diagram-edit
description: Edit a workhub diagram note (schedule, mindmap, matrix2x2, flow or pfd) from a natural-language instruction - add, rename, move, group, recolour or link its elements, and annotate them with sticky notes. Reads the note's frontmatter `type` and follows that kind's rule file. Use when asked to restructure or adjust a diagram, or when the workhub app launches a diagram edit.
argument-hint: "<diagram-file-path> <instruction>"
---

# Diagram Edit

Apply a natural-language instruction to one workhub diagram note by rewriting
**only the affected lines**.

The workhub app's Diagrams tab launches this skill with the file path and the
instruction (and, in confirm mode, asks for a diff instead of a write). It also
works when invoked by hand. It is the one skill for every kind of diagram: it
carries the shared procedure and nothing about any single format.

## Find the format first

**The rule file is the source of truth for the notation. This skill does not
repeat it.** Read the note, then its rule, before changing a line:

1. Read the whole target file and take the frontmatter `type`.
2. Read the rule for that type (the vault's `.claude/rules/`):

   | `type` | Rule to read |
   |---|---|
   | `schedule` | `schedules.md` |
   | `mindmap` | `mindmaps.md` |
   | `matrix2x2`, `flow`, `pfd` | `diagrams.md` - the shared section and the section named after the type |

   The rule normally loads on its own when you read a note under `diagrams/`,
   `schedules/` or `mindmaps/`; a note inside a backlog item does not always
   trigger it, so open the file yourself when it did not appear.
3. A `type` that is none of those five, or a file with no `type` outside
   `schedules/` and `mindmaps/`, is not a diagram: say so and change nothing.

A kind added to the app later works the same way: its rule names its format,
and everything below still applies.

## Procedure

1. **Identify the elements the instruction names**, by title or by id. If it is
   ambiguous which element is meant, say so and stop - do not guess and edit.
2. **Work out the new content** from the current file: relative instructions
   ("a week later", "one level up", "group these") can only be computed from
   what is there. Moving an element moves what hangs off it (a mindmap
   subtree, an element's indented note lines, its stickies stay pinned).
3. **Rewrite only the affected lines**, in place, keeping the order of
   everything else.
4. **Validate against the rule** before writing: every line you touched still
   parses by the kind's grammar, ids are unchanged and unique, colours are in
   the list, and no element lost a `task:` link, a note line or a modifier
   unless the instruction asked for that.
5. **Set `updated:` to today's date** in the frontmatter and leave every other
   key as you found it.
6. **Write the file, then report** in one paragraph: which element ids changed,
   from what to what, and anything you declined to do. In confirm mode, do not
   write: report the exact lines you would change, as a diff, and stop.

## Shared rules

- **Ids are never changed or reused.** A new element takes the next unused
  number of its prefix in that file; a deleted element's number stays retired.
- **`## Memo` and everything after it is the human's.** Never edit it.
  Sections you do not recognise stay where they are.
- **Stickies** (`## Stickies`, optional, between the managed sections and
  `## Memo`): a sticky is pinned to an element by `node:<element-id>` - the key
  is `node:` whatever the kind, and the value is any element's id. Add the
  heading only when you add the first sticky. Keep every existing sticky's id,
  offset (`@dx,dy`) and colour unless the instruction is about them; stagger
  several new ones on one element rather than stacking them; a sticky whose
  element you delete goes with it. `stickies: hidden` in the frontmatter is the
  user's display setting - leave it, and say so if you add a sticky to a note
  that hides them. Schedules have no stickies.
- **Display settings are not content.** Frontmatter keys such as `node_width`,
  `stickies`, `node_ids` or an axis label belong to the user; change one only
  when the instruction is about it.
- **Positions the user set by hand stay put.** A coordinate (`@x,y`), a side
  (`^left` / `^right`) or a sticky offset is an arrangement, not decoration;
  touch it only when the instruction is about where something sits.
- **Never rewrite the whole file.** The diff is what the user reviews and what
  the app's undo restores; a wholesale rewrite destroys both.
- **Never edit any file other than the target note.** In particular do not
  create or update tasks in `tasks/`: a `task:` link is a reference, and
  changing a task is a separate, explicit request.
- **Never change an element the instruction did not mention**, and never
  reorder siblings or lines it did not mention.
- **Never remove or reorder frontmatter keys** you do not recognise.

### PFD

A PFD node's symbol is fixed by its id prefix, and the set of symbols is a
registry in the app, not something a note can extend.

- **Do not invent an id prefix.** Use the prefixes the rule lists. If the
  instruction needs a symbol the rule does not list, say so and ask which
  existing symbol to use; do not write a line the app would keep as unreadable.
- **Never change an existing node's prefix** in place to change its kind. A kind
  change is a new id plus re-pointed arrows and stickies; follow the conversion
  paragraph of the pfd rule.
- **An arrow may join any two nodes**, same kind included (process to process,
  deliverable to deliverable); write one when the instruction asks for it. Never
  write an arrow naming a node that does not exist.

## When the instruction cannot be satisfied

Report what blocked it and change nothing. Common cases:

- the named element does not exist, or two match the description;
- the change would break the kind's grammar or its connection rules (an
  inverted span, a node inside its own subtree, an arrow the kind forbids);
- the instruction asks for something the notation cannot express. Say which
  part is not expressible and offer the nearest structure that is.

## Example

**"Group the kanban and swimlane ideas under a new 'board' branch"** on a
`mindmap` note:

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
