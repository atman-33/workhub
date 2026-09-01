# Pitfalls

Traps that cost time when building or editing a proof. Each one was hit for
real; none is obvious from the code.

## Measuring the fit

Run this in the page and read the report. It renders every slide off-screen at
full 1280×720, so the numbers do not depend on the viewport size.

```js
JSON.stringify(window.measure(), null, 1)
```

Per slide it returns `fill` — how much of the body box the content occupies —
and `overflow`. Anything over 100% is clipped and the reader never sees the tail.

**`scrollHeight > clientHeight` does not work here.** A `.body` whose content is
shorter than its box reports the two as equal, so the test cannot separate
"fits with room to spare" from "just fits". `window.measure()` instead compares
the bottom of the last child against the box. Use it rather than rolling a
check by hand.

Aim to leave headroom: a slide at 95% has no room for the revision that always
comes.

## The preview pane serves a stale snapshot

The browser pane holds a `data:` snapshot taken when the file was written
through the editing tools. Rewriting the file from a script — anything that is
not a tracked file edit — leaves the pane showing the **old** content, and a
measurement taken then reports the old numbers.

Re-open the file with a forced navigation before measuring after any
out-of-band write. A measurement that comes back suspiciously unchanged after a
real edit is this, not a no-op edit.

## Scaling breaks centring

`transform: scale()` shrinks what is painted, not the element's layout box: the
slide still occupies 1280×720 in layout. Centring it with flex or grid
therefore only works while the viewport is wider than 1280px; below that the
slide drifts off to one side.

The template pins the stage with `position:absolute; left:50%; top:50%` and
scales with `translate(-50%,-50%) scale(k)`, which centres regardless of the
scaled size. Keep that pair together if the layout is ever reworked.

## Editing the SLIDES array from a script

Long revisions are easier to apply as a script than as many small edits. Two
things bite:

- **Splitting and rejoining the array loses a brace.** Splitting on the
  separator between entries leaves the last entry holding its closing `}` while
  the others do not. Rejoining with the separator then produces either a stray
  or a missing brace, and the page dies with `SLIDES is not defined`. After any
  such rewrite, load the page and confirm `window.measure()` still answers.
- **Write the script to a file and run it**, rather than piping a long heredoc
  through the shell. Long non-ASCII heredocs get mangled by shell quoting.
  Node ESM (`.mjs`) is the runtime to reach for — it is the one guaranteed to
  be present.

Read and write the HTML as UTF-8 explicitly, and do not let the writer
translate newlines; the proof carries the user's own language.

## Density is the second lever, not the first

When a slide overflows, cut content first. Reaching for a smaller font buys
about 15% and costs legibility — below roughly 12px a table stops reading from
the back of a room, which is the one thing the proof exists to prevent.

The template ships a `dense` class for the cases where the content genuinely
cannot be cut (a KPI table the user has approved line by line). Apply it to the
`.body` of that slide only, never deck-wide.

## Keep the harness out of the deck

The chrome — stepping, measurement, notes, grid — is scaffolding for the
session. It is not part of what Claude Design receives, and the wireframe
styling is not either. When the proof is attached to Claude Design as a
reference, say "layout intent only; styling follows the design system", or the
generator will faithfully reproduce a greyscale wireframe.
