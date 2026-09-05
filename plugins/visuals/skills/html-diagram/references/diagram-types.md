# Diagram types

Eight types. Read the one you picked; the layout grammar below sits on top of
the shared rules in `svg-primitives.md`.

Source: [diagram-design](https://github.com/cathrynlavery/diagram-design),
narrowed from 39 types to the eight that cover ordinary work. See the plugin's
`NOTICE.md`.

If a three-column table would say the same thing, use the table.

---

## Flowchart

**For:** decision logic, algorithms, "should I…?" routing, support triage.

- Shape carries the type, colour does not:
  - **Oval** (`rx=20`) — start and end
  - **Rectangle** (`rx=6`) — step or action
  - **Diamond** — decision, at most 3 exits
  - **Small filled ink dot** (`r=4`) — where branches rejoin
- Flow runs top to bottom. From a diamond, yes to the right and no below by
  convention — but label **every** outgoing arrow regardless.
- Accent the happy path *or* the single most consequential decision. Never every
  decision.

**Anti-patterns:** fill colour signalling node type (shape does that); a diamond
with four exits (nest them); an unlabelled branch.

---

## Sequence

**For:** time-ordered messages between actors — a request path, a handshake, an
incident.

- Actors across the top, each with a vertical lifeline hairline dropping from
  its box.
- Messages are horizontal arrows between lifelines, ordered top to bottom.
  Labels above the line, in mono, with the usual 6–10px gap.
- Returns are dashed. A self-call is a small elbow leaving and re-entering the
  same lifeline.
- Activation bars — narrow rectangles on the lifeline — only where the reader
  needs to see how long something is busy. Usually they can go.
- Max 5 lifelines. Max 1 combined fragment (`opt` / `loop` / `alt`), never
  nested.

**Anti-patterns:** a message with no label; a sixth lifeline squeezed in; using
sequence for something that is really a flowchart.

---

## Architecture

**For:** components and how they connect — services, stores, external systems.

- Group by tier or trust boundary with zones (see `svg-primitives.md` §9), not
  by drawing everything in rows.
- Node treatment carries the kind (service, store, external, user); the type tag
  in the corner carries the detail.
- The accent goes on the component the diagram is *about* — usually the one the
  change touches.
- Connector direction is data direction. If a call and its response both matter,
  draw the response dashed rather than adding a second solid arrow.

**Anti-patterns:** every box the same width; a legend inside the drawing; a
fourth zone (use a swimlane instead).

---

## Timeline

**For:** release history, milestones, an incident, a roadmap.

- A horizontal hairline baseline across the middle, with ticks at the time
  boundaries and dates below in mono.
- Events are filled circles (`r=4`) on the baseline, labels alternating above
  and below to avoid collision, each joined to its circle by a hairline drop.
- A milestone is an accent circle (`r=6`) with a bolder label.
- **The scale must be honest.** Unequal intervals are spaced unequally. Break
  the axis visibly where a region is too dense rather than faking linear
  spacing.

**Anti-patterns:** equal spacing for unequal intervals; no unit on the axis;
labels crowded onto one side.

---

## Tree

**For:** hierarchy, taxonomy, an org chart, a breakdown.

- Root at the top, children fanning below (or root left, children right).
- Nodes are small rectangles (`rx=6`), 120–180px wide, 40–52px tall, at most two
  distinct widths in one diagram.
- Connectors are orthogonal: a short vertical drop from the parent, a horizontal
  bus across the siblings, then a short drop into each child's top edge.
- Max depth 4, max breadth 5 per level.
- Accent **one** node: the root or a critical leaf, not both.

**Anti-patterns:** five levels on one page (split it); diagonal connectors;
a skipped level joining a parent to a grandchild.

---

## Swimlane

**For:** a cross-functional process, a handoff chain, a RACI-style flow.

- One lane per actor, labelled in the left margin with a mono eyebrow. Lane
  dividers are hairlines.
- Steps sit inside the lane of whoever performs them.
- **The handoffs are the point.** Accent the crossing that introduces the most
  coupling or the longest wait.
- Unequal step counts per lane are fine; a lane with one step is fine.
- Max 5 lanes.

**Anti-patterns:** an unlabelled lane; a step straddling two lanes (pick one
owner); arrows snaking back and forth (reorder the steps).

---

## Quadrant

**For:** two-axis positioning — effort against impact, reach against cost.

- Two axes crossing at the centre, each end labelled with a mono eyebrow. Label
  the axes themselves, not only the poles.
- Items are small dots or short labelled chips, placed by judgement; say in the
  `<desc>` what the placement is based on.
- Name the quadrants only when the names carry meaning ("quick wins", "money
  pit"). Four generic names are noise.
- Max 12 items. Accent at most two.

**Anti-patterns:** unlabelled axes; items placed to fill the space evenly rather
than where they belong; a third dimension smuggled in as dot size without saying
so.

---

## Loop

**For:** a reinforcing cycle where the last step feeds the first — a flywheel, a
feedback loop, a retention cycle.

- Steps arranged around a circle, connected by curved arrows all running the
  same way. The direction must be unmistakable at a glance.
- A hub in the centre only when something genuinely accumulates there; otherwise
  leave it empty.
- 4–6 steps. Three is a triangle and reads as a process; more than six and the
  labels collide.
- Accent the step where the loop is currently weakest — that is usually why the
  diagram exists.

**Anti-patterns:** arrows in mixed directions; a hub with a label that just
repeats the title; a "cycle" whose last step does not actually feed the first
(that is a process — use a flowchart or a swimlane).
