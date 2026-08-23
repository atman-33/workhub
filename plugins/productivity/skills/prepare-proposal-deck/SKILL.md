---
name: prepare-proposal-deck
description: Turn a proposal into a decision-driven deck brief plus a ready-to-paste Claude Design prompt. Use when the user is preparing to pitch, review, or get sign-off on a proposal with their team, or asks how to structure the explanation so the meeting does not drift.
---

# Prepare a proposal deck

A proposal meeting fails by **drift** — the room wanders, the hour ends, nothing
is decided. Drift is not cured by talking better; it is cured by a deck built
around one decision, with everything that does not serve it cut before the
meeting starts.

This skill produces the two artifacts that do that: a brief the user keeps, and
a prompt they paste into [Claude Design](https://claude.ai/design) to render the
slides. It does not render slides itself — Claude Code cannot drive Claude
Design's generation.

## Steps

1. **Fix the decision, then raise the fence.**

   Ask what the meeting must decide, and compress the answer to **one
   sentence** in the form *"<who> decides whether/which <what>, by <when>"*.
   Push back on anything that is a topic ("the new API") rather than a decision
   ("we decide whether to adopt gRPC for the internal API this sprint").

   Then raise **the fence**: the things this meeting deliberately does *not*
   decide. Ask for adjacent questions the room will reach for, and list them as
   out of scope. The fence becomes a slide, so the deck itself can pull a
   drifting discussion back.

   *Done when:* the decision is one sentence naming a decider, and the fence
   holds at least two out-of-scope items.

2. **Collect the material, and make every section pay its way.**

   Work through the sections below, asking for the user's content one at a time.
   For each, also ask for a single line: **how does this move the decision?**
   A section whose line cannot be written is cut from the deck — say so and
   drop it. Sections 1, 2, and 7 are never cut.

   1. The decision — the one sentence, and who decides
   2. The fence — what this meeting does not decide
   3. Background — the problem, and why now rather than later
   4. The proposal — what is being proposed, carried by a diagram
   5. Alternatives — what else was considered, and why each was rejected
   6. Impact — cost, effort, risk, and what breaks if it goes wrong
   7. The ask — the decision restated, plus the next action and its owner

   Section 5 is the one users skip and the room always asks about. If the user
   has no alternatives, treat that as unfinished material, not an empty
   section: ask what the do-nothing option costs, at minimum.

   *Done when:* every surviving section has content and its one-line
   justification, and section 5 names at least one rejected alternative with a
   reason.

3. **Grill it.**

   Invoke the `grilling` skill against the material from step 2. Take the
   objections it lands and turn each into a Q&A entry: the question as the room
   would ask it, and the answer the user can actually give.

   Where an objection has no answer, do not invent one — mark it as an open
   question and put it on the fence slide or the ask slide, whichever fits.

   *Done when:* every objection raised by `grilling` is either answered in the
   Q&A or recorded as an open question. None are silently dropped.

4. **Prove the structure before writing the prompt.**

   Invoke the `draft-deck` skill, handing it the surviving sections as the
   structure. It builds an HTML proof that steps through the slides in
   wireframe, so the deck's order, its length against the meeting slot, and
   whether each slide's text actually fits are settled in this session rather
   than through rounds of regeneration in Claude Design.

   A section that overflows its slide gets cut or split here, not later.

   *Done when:* the user has stepped through the proof and calls the structure
   settled, and no slide overflows.

5. **Write the two outputs.**

   Ask where they should go. Default to `projects/<project>/deliverables/` when
   a project is identifiable, otherwise ask outright.

   The design prompt is written out of the proof, which stays the single source
   of truth: a later change goes into the proof first, then the prompt is
   rewritten from it.

   - `<slug>-brief.md` — the material from steps 1–3, following
     [BRIEF.md](BRIEF.md). This is what the user rereads before the meeting and
     reuses next time.
   - `<slug>-design-prompt.md` — the paste-ready prompt, following
     [DESIGN-PROMPT.md](DESIGN-PROMPT.md).

   Report both paths, and tell the user to open Claude Design, select the design
   system, and paste the second file.

   *Done when:* both files exist, and the design prompt carries one slide
   instruction per surviving section — no placeholders left behind.
