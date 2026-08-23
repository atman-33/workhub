---
name: draft-deck
description: Build a proof of a slide deck — one HTML file that steps through the slides in wireframe so structure, wording, and whether the text actually fits can be settled before any design is generated. Use when the user is preparing slides they will render in Claude Design, wants to iterate on a deck's contents, asks whether a slide is too full, or needs a paste-ready Claude Design prompt written from a settled structure.
---

# Draft a deck

A deck is revised a dozen times before it is right. Revising it inside Claude
Design is expensive: every round is a regeneration, and each regeneration renders
design nobody is judging yet.

This skill builds a **proof** instead — one self-contained HTML file that steps
through the slides in wireframe, so the content and the fit are settled in the
session. Claude Design renders the design afterwards, from a prompt written out
of the finished proof.

## The proof is not a design

Wireframe fidelity only: greyscale, one accent, real text at real size, no
attempt at the target design system. Two reasons. The design belongs to Claude
Design, and a proof that looks finished stops getting edited. If you catch
yourself picking colours, stop.

What the proof settles:

- **Fit** — does the text actually fit a 16:9 slide, or is it silently clipped
- **Order** — is the sequence right, are related slides adjacent
- **Length** — does the deck fit the time the user has
- **Message** — does each slide carry one idea

## This skill carries no slide template

The structure comes from whoever called: the user, or another skill such as
`prepare-proposal-deck`. If no structure has been given, ask for one. Do not
supply a default shape — a proposal skeleton imposed on a status review produces
slides the user deletes one by one.

## Steps

1. **Draft the slides.**

   Write out the deck as a list before touching HTML: for each slide, a title,
   its content, and a speaker note — what the user says out loud that is not on
   the slide. Estimate the seconds each slide takes to explain.

   *Done when:* every slide has all four, and the seconds sum to something the
   user can compare against their time budget.

2. **Fill the proof.**

   Copy [TEMPLATE.html](TEMPLATE.html) next to the user's other material for
   this deck, and edit **only the `SLIDES` array**. The chrome around it —
   stepping, measurement, notes, the grid — is the harness; leave it alone.

   *Done when:* the file holds every slide from step 1.

3. **Measure.**

   Open the file and run the measurement snippet from [PITFALLS.md](PITFALLS.md).
   It reports, per slide, how much of the body the content fills.

   Over 100% means the slide **overflows** and its tail is silently clipped —
   the reader never sees it. Fix by cutting content first and tightening density
   second; a slide that only fits at 11px will not read from the back of a room.

   Check the time total against the budget in the same pass.

   *Done when:* no slide overflows and the total is inside the budget.

4. **Iterate with the user.**

   Send them the file and take their revisions. Every revision edits the `SLIDES`
   array — never a side document, never a summary of the change. **The proof is
   the single source of truth.** Re-measure after each round, since a two-line
   edit is enough to push a slide over.

   *Done when:* the user says the structure is settled.

5. **Write the Claude Design prompt out of the proof.**

   Convert the settled proof into prose instructions — one block per slide,
   naming the design system on the first line. Carry across the exact wording
   the user approved; this is transcription, not a rewrite.

   Keep the speaker notes out of the prompt. They go in a separate section of
   the same file, for the user to hold during the meeting.

   Warn the user about attaching the proof HTML to Claude Design: it makes the
   generator imitate the wireframe. If they attach it anyway, tell them to add
   "layout intent only; styling follows the design system".

   *Done when:* the prompt covers every slide in the proof, with no placeholder
   left behind.

## Single source

The proof is the source; the prompt is generated from it. Once the prompt exists,
a change still goes into the proof first and the prompt is rewritten from it.
Editing the prompt alone makes the two drift inside a single round, and the drift
is invisible until the generated deck contradicts the brief.
