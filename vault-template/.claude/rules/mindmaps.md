---
paths:
  - "projects/*/mindmaps/**"
---

# Mindmap notes

Format of a project's `mindmaps/` notes. The `mindmap-edit` skill follows this file; the spec lives here, not in the skill.

`mindmaps/` holds the project's idea maps. One file is one map; the app's
**Mindmap** tab renders it as a mindmap and writes changes straight back, so
the note stays editable in Obsidian at the same time.

Frontmatter is flat (`type: mindmap`, `title`, `created`, `updated`, and the
optional `node_width` / `stickies` / `attr_chips` / `attr_color` /
`attr_filter`); the content lives in two managed sections — `## Nodes` and the
optional `## Stickies` — plus a `## Memo` section neither the app nor the AI
ever rewrites:

```markdown
## Nodes

- N-001 workhub #blue
  - N-002 tasks #green task:T-0042 prio:high
    - N-003 kanban ^collapsed
  - N-004 schedule #amber tags:検討中,見積り
    lead times are still guesses

## Stickies

- S-001 node:N-004 @96,24 #amber re-check the dates after the vendor call
```

Node line:
`- <id> <title> [#<color>] [task:<task-id>] [<key>:<value> ...] [^collapsed] [^left|^right]`

- Nesting is indentation, two spaces per level — an ordinary nested bullet
  list, which is what makes the file editable by hand.
- `<id>` is `N-` + a number, unique in the file. **Never change or reuse one** —
  it is how the app and the AI identify a node across edits. A node typed by
  hand without an id gets one the next time the app reads the file.
- `#<color>` is one of `blue`, `green`, `amber`, `red`, `purple`, `gray`. A
  branch inherits the nearest coloured ancestor's colour, so colour the branch
  head rather than every node.
- `task:<task-id>` links the node to a task in `tasks/`.
- `<key>:<value>` is a free-form **attribute** — importance, priority, an
  owner, a grouping label, whatever the map is being sorted by. Any number of
  them, in any order. The keys are not configured anywhere: the map's
  vocabulary is whatever its nodes use, and the app offers the keys and values
  already in the file as suggestions.
  - A key is either lowercase ASCII (`[a-z][a-z0-9_-]*`) or Japanese
    (hiragana, katakana or kanji, optionally mixed with that same lowercase
    ASCII) — so `prio:high` and `優先度:高` are both attributes. Either way it
    is 24 characters at most, and a value carries no spaces, since the line is
    split on whitespace. Use `_` where a value needs one.
  - Anything that does not fit those rules stays part of the title, which is
    what keeps `15:00`, `https://example.com` and `Q3:目標` safe to write in a
    node. Only the ASCII colon separates a key from its value, so a title
    written with the full-width `：` — `目標：達成` — is never read as one.
  - `tags:` is the one key the app treats as a list: its value is
    comma-separated (`tags:検討中,要調査`), each tag gets its own chip, and
    colouring or filtering by `tags` works on individual tags.
  - The app draws attributes as chips under the node's title, can colour the
    boxes by one key, and can dim every node that does not carry a given
    `key=value`. All three are display settings — see the frontmatter keys
    below. Right-clicking a chip on the map offers those commands, plus
    removing that attribute from the node.
- `^collapsed` hides the node's children **in the app**; the subtree itself is
  untouched.
- `^left` / `^right` pins a branch to one side of the root (only meaningful on
  a child of a root). Without it, branches alternate by their position in the
  list. The app writes it whenever an action implies a side — adding a branch
  beside another, or dragging one across the root — so branches never swap
  sides while the map is being edited.
- A node may carry extra lines of text on **indented continuation lines**
  beneath it, which the app shows on hover.

Sticky line: `- <id> node:<node-id> @<dx>,<dy> [#<color>] [<text>]`

A sticky is a note pinned to a node and drawn on the map beside it — always
visible, unlike a node's own continuation lines, which only appear on hover.

- `<id>` is `S-` + a number, unique in the file. **Never change or reuse one.**
- `node:<node-id>` is required: it is what the sticky is pinned to. Deleting a
  node deletes its stickies.
- `@<dx>,<dy>` is an integer offset in pixels from the pinned node's **centre**
  to the sticky's top-left corner — the only coordinate in the file, and a
  relative one, so a sticky follows its node through any re-layout. Omitted, it
  defaults to `@32,24`.
- `#<color>` is from the same palette as a node's; absent means `amber`.
- Longer text continues on **indented continuation lines**, like a node's note.
- `## Stickies` goes between `## Nodes` and `## Memo`, and a map with no
  stickies carries no such section at all.
- The frontmatter key `stickies: hidden` hides every sticky on the map at once
  (the Mindmap tab's sticky button). It is a display setting; it hides them in
  the exports too, so a hand-out matches the screen.

Three more frontmatter keys say how the attributes are being looked at. They
live in the note for the same reason `node_width` does — the right answer
differs per map, and an export has to look like what was on screen when it was
made — and each one is written as the absence of the key when it is at its
default:

- `attr_chips: tags,prio` says **which** chips are drawn and **in what order**;
  `none` turns them off entirely. Absent means every attribute is shown,
  alphabetically — which is why a map that uses no attributes looks exactly as
  it did before they existed. Alphabetical is only the fallback: `tags` sorts
  last because of how it is spelled, not because it matters least, so a map
  that cares about the order says so. The Mindmap tab's chip button edits this.
  Within one key the order is the file's own — the order the tags were typed
  in, which you can drag into shape in the node panel.
- `attr_color: prio` colours the boxes by that attribute's value instead of by
  `#<color>`. A node without the attribute is left uncoloured — "not labelled
  yet" is usually the thing you are looking for — and branch colour inheritance
  is off while it is on. The value → colour mapping is derived from the value
  itself, so it is stable across maps and exports, and arbitrary: the colours
  separate values, they do not rank them.
- `attr_filter: prio=high` dims every node that does not carry it. Dims, never
  hides: a mindmap is read through its shape, so removing the non-matching
  nodes would re-flow the map out from under you. For `tags`, the match is
  membership of the list.

Node positions are deliberately **not** stored: the app lays the map out from
the tree every time it draws it, anchored on the root — so collapsing a branch
re-flows that branch without moving the centre of the map. The tab's "mermaid"
button copies the map as a mermaid `mindmap` code block for pasting into a
document — that export is one-way, since mermaid cannot carry ids, colours or
task links.

`node_width` decides how wide the boxes are drawn, and is set from the picker
in the Mindmap tab. It belongs to the note rather than to the app because the
right answer differs per map, and because an export has to look like what was
on screen when it was made:

- `auto` (the default, written as the absence of the key) sizes every box to
  its own text;
- `siblings` gives the children of one parent a common width;
- `depth` gives every node at the same distance from the root a common width,
  which lines the map up in columns at the cost of one long title widening
  every box on its level.
