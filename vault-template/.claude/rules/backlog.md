---
paths:
  - "projects/*/backlog/**"
---

# Backlog items

Format of a project's `backlog/` items. The one rule `task-start` needs before any file is touched (every task with a project has an item) stays in the vault `CLAUDE.md`.

`backlog/` is where a project's work actually lives. One item is one unit of
work — a feature, a bug, a support case — and it holds everything that unit
produces: the candidate write-up, the spec, the investigation, the notes each
task left behind. `tasks/` at the vault root remains the app's executable task
list; an item is what a task is *about*, never a duplicate of it.

An item is a folder from the start (folder-first since T-0321):

```text
backlog/
  _backlog.base
  B-005-task-editor-project-source/
    B-005-task-editor-project-source.md   <- entry note, named after the folder
  B-007-mindmap/
    B-007-mindmap.md                      <- entry note, named after the folder
    010-feature-design.md
    020-node-attributes.md
    030-T-0194-sticky-notes.md
    040-T-0194-manual-test.html
```

- Create the folder and its entry note together. **The entry note keeps the
  folder's exact name** — so every `[[B-007-mindmap]]` resolves to the entry
  note.
- Child notes are `NNN-<title>.md`, numbered in **tens** so a later note can be
  slotted between two existing ones. A task's output is `NNN-T-XXXX-<title>.md`,
  which puts it in sequence and names the task it came from.
- **A child note is named once and never renamed.** The tens are what make that
  possible: a note that belongs between `010` and `020` becomes `015`, and
  nothing else moves. Renumbering a folder to tidy it up breaks every link into
  it, and buys nothing a reader can see.
- **Moving an existing note into an item does rename it, so give it an alias.**
  The `NNN-` prefix changes the basename, and `[[記事制作の自走化設計]]` written
  anywhere in the vault stops resolving. Add the old basename to the note's
  frontmatter:

  ```yaml
  aliases:
    - 記事制作の自走化設計
  ```

  Obsidian resolves a wikilink through an alias, so every reference keeps
  working and not one of them has to be edited. That matters more than it
  sounds: T-0263 moved twelve notes and broke 28 references, seven of them in
  **archived** tasks — historical records nobody should be rewriting, and the
  ones you are least likely to find by searching.
- Non-Markdown files (a test report, an exported image) sit directly in the
  item folder. No sub-folders: a flat item folder is one glob to an agent.

Frontmatter of the entry note:

```yaml
id: B-007
title: Mindmap
type: backlog
project: <project-slug>
status: doing        # idea | ready | doing | done | dropped
priority: medium     # low | medium | high
source:              # URL/id in an external backlog, when one owns this item
created: 2026-09-01
updated: 2026-09-10
```

Body sections, in document order:

| Section | Contents |
|---|---|
| `## What` | The work, in a sentence or two |
| `## Why` | The value or motivation |
| `## Status` | Where it stands, in one line, then a dated log, newest first |
| `## Notes` | Index of the child notes. Only once the item is a folder |

`## Status` is what answers "which of these files is current?". A number prefix
records the order things were *created*, which is not the same as which one is
*live*; the dated log is, and the numbering only keeps the folder readable.

**`source` decides who owns the priorities.** Filled in, an external backlog
(GitHub Issues, monday.com, Jira) is authoritative: leave `status` and
`priority` to it, and let the item folder be where the thinking and the outputs
live. Empty, the vault owns them and `_backlog.base` *is* the product backlog.
Same schema either way, so a project can move between the two without a
rewrite.


**The link to tasks runs one way.** A task names its item (`backlog: B-007`);
the item never lists its tasks. Two hand-maintained copies of one relationship
drift apart, and the query in the other direction is cheap — both the task
board and `_backlog.base` filter on the task's own key.
