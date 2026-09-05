# Document shapes

Read the one you picked. Each sits on top of the skeleton in
`shared/html-skeleton.md`.

Source: [visualize](https://github.com/careerhackeralex/visualize). See the
plugin's `NOTICE.md`.

---

## Explainer

**For:** answering an enquiry, walking a colleague or a customer through a
decision, making a mechanism understandable.

**Spine:** the question, the answer, then the reasoning. Not the reverse — a
reader who has to reach paragraph six for the answer stops at paragraph three.

- Open with the question in the reader's own words, then the answer in one or
  two sentences, set larger than body copy.
- Then the reasoning, in sections that each carry one step.
- A diagram earns its place wherever the relationship between things is the
  hard part. Build it with `html-diagram` and paste the SVG in.
- Close with what the reader should do, or what happens next. An explainer that
  ends on the last piece of reasoning leaves them holding it.
- Anything you were unsure of goes in the document as an open question, not
  quietly smoothed over.

**Interaction:** `<details>` on the deeper reasoning, so the short version can
be read in a minute and the long one is a click away.

---

## One-pager

**For:** a single proposal, feature or offer — the thing someone forwards.

**Spine:** a hero line, three or four sections, one conclusion. It should feel
complete in about one screen, with minimal scroll.

- Hero text large (48px and up), a subline under it, then the body.
- Icon-and-text pairs for features, at a maximum of four. Five is a list.
- Max width around 960px, centred.
- One bold design decision — a colour, a type choice, a single graphic device.
  Professional does not mean anonymous.
- It has to survive being screenshotted or printed, since that is what happens
  to it.

**Interaction:** minimal. A one-pager is mostly read, not operated.

---

## Report

**For:** research, status, an investigation, a post-mortem.

**Spine:** findings first, method after. The reader wants the conclusion; the
method is there so they can check it.

- Lead with a summary block: what was found, in three or four lines.
- Then findings, one section each, with the evidence attached to the claim it
  supports rather than pooled at the end.
- Tables for anything comparable. A real `<table>`, not a grid of cards.
- Method, scope and limits in their own section near the bottom.
- Sources at the end, cited where the claim is made.
- A status report shows progress against something stated — a target, a
  baseline, a previous run. Progress with nothing to measure it against is a
  narrative, not a status.

**Interaction:** `<details>` per finding for the supporting detail; progress
bars that animate on scroll if there is a target.

---

## Dashboard

**For:** numbers people come back to check.

**Spine:** a KPI row, then charts and tables below.

- Header with the title and, crucially, **what period the data covers and when
  it was taken**. A dashboard without that is unreadable a week later.
- 3–5 KPI cards: label, value, and the change against the previous period.
  Colour the change positive or negative, and pair the colour with a sign or an
  arrow so it is not the only signal.
- Charts in a CSS grid below, `repeat(auto-fit, minmax(320px, 1fr))`, container
  height 300px or more.
- A sparkline inside a KPI card carries the trend without spending a chart slot.
- Eight KPIs and four charts looks real. Four and two looks like a demo.

**Interaction:** required. A date-range or category filter at minimum.

---

## Comparison

**For:** choosing between options.

**Spine:** a matrix, with the recommendation marked and the reason given.

- Rows are the criteria, columns the options. Four columns at most.
- Sticky header row, alternating row backgrounds.
- Inline SVG check and cross marks rather than the words "yes" and "no", but
  keep an `aria-label` on each so the table is readable aloud.
- Mark the recommended column with an accent border and a badge — and state
  *why* in prose underneath. A matrix that leaves the reader to add up the ticks
  has not made the decision it exists to make.
- Highlight the criteria that actually differ. Rows where every option scores
  the same are noise; cut them or group them under "equivalent".

**Interaction:** toggling criteria groups on and off, or highlighting the winner
per row.

---

## Timeline (as a section, not a document)

A timeline is usually a section inside one of the shapes above.

- Vertical, with the line down the middle and events alternating left and
  right, is the most readable at length.
- Dates prominent, in mono.
- A "now" marker on a roadmap.
- Entrance animation on scroll via the skeleton's `data-reveal`.

For a timeline that *is* the deliverable, use `html-diagram` — it enforces
honest spacing, which a CSS timeline quietly does not.
