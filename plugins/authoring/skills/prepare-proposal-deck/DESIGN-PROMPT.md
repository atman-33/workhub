# Claude Design prompt template

Claude Design renders the slides; this file is the instruction it renders from.
Write the prompt in the user's language, and fill every placeholder from the
brief — a placeholder that reaches Claude Design becomes a blank slide.

## Choosing the design system

Ask which design-system project to target, and state the default with its
reason rather than asking cold:

- **Modernist** (default for proposals) — Archivo, flat, modular grid, 2px
  rules, single red accent. Structure reads at a glance from the back of a
  meeting room.
- **Classical** — Cormorant Garamond over Lora, hairline rules, gold accent.
  Editorial and quiet; better for a document people read alone than for a deck
  argued over in a room.

Name the chosen system in the prompt's first line. Claude Design applies the
project's own deck template and tokens from there — do not restate colors,
fonts, or spacing in the prompt.

## The prompt

```markdown
Build a proposal deck using the <design system name> design system and its
deck template.

Audience: <who is in the room>
Purpose: this meeting must reach one decision, and the deck exists to get
there without the discussion drifting.

Produce these slides, in this order. One idea per slide; do not add slides
beyond this list.

1. Title — "<proposal title>", and beneath it the decision in one sentence:
   "<the decision>". Decider: <name or role>.

2. Not decided here — <out of scope item>, <out of scope item>.
   Set this slide so it can be pointed at mid-discussion: short lines,
   large type, no prose.

3. Background — <the problem, and why now>.

4. Proposal — <what is proposed>.
   Carry this slide with a diagram: <what the diagram must show>.
   Keep the text to a caption.

5. Alternatives — a two-column comparison of option against why it was
   rejected:
   - <alternative>: <reason rejected>
   - Do nothing: <what it costs>

6. Impact — cost/effort <...>, risk <...>, if it goes wrong <...>.

7. The ask — the decision restated verbatim, then the next action:
   <action> — <owner> — <when>.
   Then, under a separate heading, the open questions the user cannot yet
   answer: <open question>. Say them out loud on the slide rather than
   waiting to be caught by them.

8. Appendix, Q&A — one row per pair, held back until asked:
   - Q. <question> / A. <answer>

<Drop any numbered slide whose section was cut from the brief, and renumber.>
```
