---
name: html-diagram
description: Draw a diagram as a self-contained HTML file with inline SVG, in an editorial style with orthogonal connectors and a hard complexity budget — for explaining a question or an answer to someone, working out a system, or organising an idea. Use when the user wants a flowchart, sequence, architecture, timeline, tree, swimlane, quadrant or cycle diagram, wants something explained visually, or is thinking a plan through and needs it laid out.
allowed-tools: Read Write Edit Glob Grep Bash
---

# HTML diagram

One `.html` file, inline SVG, embedded CSS, no external images. It opens
anywhere and travels as an attachment.

Source: [diagram-design](https://github.com/cathrynlavery/diagram-design). See
the plugin's `NOTICE.md`.

## The one rule that governs the rest

**The highest-quality move is usually deletion.**

- Every node is a distinct idea. Two nodes that always travel together are one
  node.
- Every connector carries information. If the relationship is obvious from the
  layout, remove the line.
- The accent colour is editorial, not a flag. One or two focal nodes. Accenting
  five erases the signal.
- The diagram is not finished when everything is on it. It is finished when
  nothing can come off.

Target density **4 out of 10**: technically complete, not so dense it needs its
own guide. Above nine nodes it is probably two diagrams.

## Before drawing

Ask yourself: **would the reader learn more from this than from a
well-written paragraph?** If not, write the paragraph.

Do not draw for a list of things (use a table), a simple before/after (a table),
or a single shape (write the sentence).

Then say in one short message what you are about to draw — the type, and
anything the complexity budget will force out — so the user can redirect before
you spend the render. Skip that pause only when the request already pins the
type and content exactly.

## Choose the type

Read `references/diagram-types.md` and pick one. Eight types cover almost
everything:

| Showing | Type |
|---|---|
| Decision logic with branches | Flowchart |
| Time-ordered messages between actors | Sequence |
| Components and their connections | Architecture |
| Events positioned in time | Timeline |
| Parent to children | Tree |
| A cross-functional process with handoffs | Swimlane |
| Two-axis positioning or prioritisation | Quadrant |
| A reinforcing cycle where the last step feeds the first | Loop |

If two seem to fit, pick the dominant axis. If a three-column table says the
same thing, use the table.

## Draw it

Read `references/svg-primitives.md` for the palette, the connector rules, the
node box, labels, the legend and the 4px grid. Also read
`${CLAUDE_PLUGIN_ROOT}/shared/design-system.md` for the rules against the
default generated look.

Six connector rules are non-negotiable, and each one is an automatic fail:

1. Rounded right-angle elbows between off-axis nodes. **No diagonals.**
2. A 6–10px visible gap between an arrow label and its connector.
3. No two connectors overlapping or sharing a stroke path.
4. Several connectors on one box edge get their own attach points, ≥12px apart.
5. No connector passing behind a box that is not its endpoint.
6. No label mask overlapping a node drawn after it.

They are stated in full in `references/svg-primitives.md`. Draw arrows before
boxes so the lines sit behind the nodes.

## Check it

Run the checker before handing anything over:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/html-diagram/scripts/self-check.mjs" diagram.html
```

It verifies the accessible-SVG contract, the single-file safety rules, and
catches diagonal `<line>` connectors mechanically.

Then run the taste gate by eye:

**Remove**

- Can any node come off and the reader still understand?
- Can any two nodes merge?
- Can any arrow come off — is the relationship already obvious from position?
- Can any label come off — does shape or colour already say it?

**Signal**

- Accent on two elements at most?
- Does the legend cover every treatment used, and nothing else?
- Within the budget: 9 nodes, 12 arrows, 2 accents?

**Technical**

- Every font size, coordinate, width, height and gap divisible by 4?
- Every arrow label sitting on open canvas with an opaque mask behind it?
- Legend a horizontal strip at the bottom, not floating inside the drawing?
- No vertical `writing-mode` text anywhere?
- `viewBox` height expanded by ~60px for the legend strip?

Finally open it in a browser. The checker cannot see two boxes overlapping.

## Hand it over

Report the path and the type, and say what you cut to stay inside the budget —
the user knows their own subject and will notice an omission you do not
mention.

Export with `${CLAUDE_PLUGIN_ROOT}/skills/html-to-pdf` (`--mode page`) when a
PDF is wanted.

## Anti-patterns

These mark a generated-looking diagram of any type:

| Anti-pattern | Why it fails |
|---|---|
| Dark background with cyan or purple glow | Looks "technical" in place of a design decision |
| A monospace face used for everything | Mono is for ports, commands and URLs. Names are sans. |
| Identical boxes for every node | Erases hierarchy |
| A legend floating inside the drawing | Collides with the nodes |
| An arrow label with no mask | Bleeds through the line |
| Vertical `writing-mode` text | Unreadable |
| Three equal-width summary cards | A generic grid — vary the widths |
| A shadow on anything | Shadows are out; borders are in |
| Large corner radii | 4–8px, or none |
| The accent on every "important" node | It is one or two editorial marks, not a signalling system |
| Reproducing a Mermaid render | Imports automatic routing instead of an editorial layout |

## Not carried over from upstream

Deliberately absent, so nobody goes looking: the 39-type catalogue (eight are
kept), the icon set, brand onboarding and saved client profiles, draw.io and
Mermaid import, and the animation layer. Static is the default and, here, the
only mode.
