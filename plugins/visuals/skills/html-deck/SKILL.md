---
name: html-deck
description: Build a presentation as one self-contained, animation-rich HTML file on a fixed 16:9 stage, and export it to PDF — the whole deck rendered here, with no external design tool in the loop. Use when the user wants slides, a deck, a talk, a pitch or a presentation, wants an existing HTML deck reworked, or asks how to hand slides over as a PDF.
allowed-tools: Read Write Edit Glob Grep Bash
---

# HTML deck

A deck is a single HTML file with inline CSS and JS. No build step, no
dependencies, no external renderer. It opens in a browser, presents with the
keyboard, and exports to PDF.

Source: [frontend-slides](https://github.com/zarazhangrui/frontend-slides). See
the plugin's `NOTICE.md`.

## Non-negotiables

1. **Fixed 16:9 stage.** Every slide is authored inside a 1920x1080 stage that
   is scaled as a whole to the viewport. It may letterbox; it must never
   reflow. No responsive breakpoints rearranging slide content — a deck looks
   the same on a phone as on a projector, only smaller.
2. **Switch slides with visibility, never `display`.** `assets/viewport-base.css`
   uses `visibility` / `opacity` / `pointer-events`. A later rule such as
   `.slide-content { display: flex }` overrides `display: none` and paints
   every slide at once — a failure that looks like the deck is broken rather
   than mis-styled.
3. **One file.** All CSS and JS inline. Images sit beside it in `assets/`, by
   relative path.
4. **Include `assets/viewport-base.css` in full** in the `<style>` block.
   Copy it; do not paraphrase it.
5. **Read `${CLAUDE_PLUGIN_ROOT}/shared/design-system.md`** before choosing
   type or colour. The rules against the default generated look apply here
   more than anywhere — a deck is the deliverable people judge on sight.

## Phase 0 — what is being asked

- **New deck** → Phase 1.
- **Rework an existing deck** → read the file first, then follow *Reworking*
  at the bottom. Fit is the risk, not taste.

## Phase 1 — content and shape

Ask everything in one go. Use the environment's structured-question UI when
there is one; otherwise one message with numbered options.

1. **Purpose** — pitch / teaching / conference talk / internal
2. **Length** — short (5–10) / medium (10–20) / long (20+)
3. **Content** — ready / rough notes / topic only
4. **Density** — see below
5. **Time budget** — how long they have to present it

### Density decides the design

| Mode | For | Behaviour |
|---|---|---|
| **Speaker-led** | Talks, keynotes, anything explained live | One idea per slide, large type, generous space, 1–3 bullets, more slides |
| **Reading-first** | Handouts, async review, internal detail | Self-contained slides, structured grids and tables, 4–8 bullets or 4–6 cards, tighter but still deliberate |

If the answer is mixed, pick the nearer of the two rather than inventing a
middle. Live persuasion is speaker-led; circulated documents are
reading-first.

Whichever mode, the baseline holds: no scrolling, no overflow, no overlapping
panels, nothing below 24px at stage size. Content that exceeds the mode gets
**split into more slides**, never shrunk until it fits.

### Draft the outline before any HTML

For each slide: a title, its content, and a speaker note — what is said aloud
and is not on the slide. Estimate the seconds each takes.

Sum the seconds and compare against the stated budget. Report the total and
adjust the slide count before generating anything. Generating first and
discovering the deck is twice the length wastes the whole render.

If the user provided images, evaluate each one (what it shows, usable or not,
what concept it carries) and build the outline around text and images
together — not slides first, images bolted on. Confirm the outline before
Phase 2.

## Phase 2 — style, shown not described

People cannot name a design preference, and asking produces a wrong answer
confidently given. Show three real title slides instead.

Read `references/style-presets.md`, then generate three single-slide previews:

- one restrained preset,
- one expressive preset,
- one wildcard — either a third preset or a design of your own, whichever
  gives the sharpest contrast for this audience.

For a conservative, high-stakes deck, make all three more restrained and let
the wildcard be authoritative rather than decorative. For an expressive deck,
keep one readable fallback and push the other two.

Save them to `.visuals/deck-previews/style-a.html`, `-b`, `-c` and open them.

**A preview is a real first slide of their deck.** Never render workflow text
on it — no "Option A", no preset or file names, no "safe option", no
"audience: ...". Style names belong in the message, not on the slide. Check
the rendered text before opening them.

Then ask which one, offering "mix elements" as a fourth answer.

## Phase 3 — generate

Read `references/deck-template.md` and `references/animations.md`, then write
the deck.

- Expand the chosen style into a system: title, section, content, comparison,
  quote and closing layouts that visibly belong together.
- Apply the density mode throughout.
- Banner-comment every stylesheet section, and say in the theme block what to
  change to restyle the deck. The user edits this file afterwards.
- Never switch to a different style partway; if a layout is missing, design it
  from the chosen system.

## Phase 4 — verify, in a browser

This is not optional and `scrollHeight` alone does not cover it: grid children
that overflow their track visually cover their neighbours while every height
measurement stays fine.

Open the deck and check, on every slide:

- no text overflowing its container or clipped at a card edge
- no panels overlapping
- no text below 24px stage size
- the stage still 16:9 at 1280x720 and at a phone viewport
- the entrance animation completing, and each slide reachable by keyboard

Fix by **cutting content first, tightening density second**. A slide that only
fits at 20px does not read from the back of a room.

## Phase 5 — hand it over

Report the file path, the style, the slide count, and the estimated time
against the budget. Say how to navigate (arrows, space, swipe) and which
`:root` values to change to restyle it.

Then offer the PDF:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/html-to-pdf/scripts/html-to-pdf.mjs" \
  --mode slides deck.html deck.pdf
```

`--mode slides` is required. `--mode page` on a deck produces A4 portrait
pages with the 16:9 composition squeezed into them, and every slide but the one
that was active comes out blank — its entrance animations never ran.

Warn that the export flattens animation to its finished state, and offer
`--compact` if the file exceeds about 10MB.

Delete `.visuals/deck-previews/` when done.

## Reworking an existing deck

Fit is the risk. Before adding anything, count what is already on the slide
against the density limits.

- Adding text: 4–6 bullets is the ceiling. Past it, split into a continuation
  slide.
- Adding an image: it has to fit the existing 1920x1080 composition. If the
  slide is already full, move the image to its own slide or cut something.
- Re-run Phase 4 after **any** change.
- If a change will overflow, split the slide and say so. Do not wait to be
  asked.
