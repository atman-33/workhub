---
name: html-doc
description: Build a self-contained HTML document people actually read — an explainer for a customer or a colleague, a one-pager, a status or research report, a dashboard, a comparison — with a real design system behind it and a PDF to hand over. Use when a Markdown document would be too long or too flat for its audience, when answering an enquiry with something readable, or when the user asks for a report, a summary or a one-pager.
allowed-tools: Read Write Edit Glob Grep Bash WebFetch
---

# HTML doc

One `.html` file with inline CSS and JS. It opens in any browser, works
offline, and travels as an attachment or a PDF.

Source: [visualize](https://github.com/careerhackeralex/visualize). See the
plugin's `NOTICE.md`.

## When it is worth it

HTML costs more to produce than Markdown. It earns that back when the document
would run past roughly 100 lines, or needs a table, a diagram, a side-by-side
comparison, colour coding, or an interaction. Below that, write the Markdown.

Two more cases where Markdown wins even when it is long: a document that is
reviewed as text in a pull request, and one that has to diff cleanly in version
control.

## Non-negotiables

1. **Start from `${CLAUDE_PLUGIN_ROOT}/shared/html-skeleton.md`.** Copy the
   whole skeleton, then add content. It carries the themes, the utility menu,
   the print rules and the accessibility scaffolding.
2. **Read `${CLAUDE_PLUGIN_ROOT}/shared/design-system.md`** before choosing
   type or colour. Keep the eleven token names exactly.
3. **Never fabricate.** No lorem ipsum, no invented figures, no placeholder
   chart data. If a number was not read from a real source, it does not go in.
   Where the source matters, cite it in the document.
4. **One file.** Inline CSS and JS. A CDN script is allowed when it does real
   work — a chart library — and not for a CSS framework.

## 1. Pick the shape

| Shape | For | Spine |
|---|---|---|
| **Explainer** | Answering an enquiry, walking someone through a decision or a mechanism | The question at the top, the answer, then the reasoning |
| **One-pager** | A single proposal, feature or offer | A hero line, three or four sections, one conclusion |
| **Report** | Research, status, an investigation | Findings first, method after |
| **Dashboard** | Numbers people check | KPI row, then charts and tables |
| **Comparison** | Choosing between options | A matrix, with the recommendation marked |

Read `references/doc-types.md` for the layout grammar of the one you picked.
If nothing fits cleanly, write a report.

## 2. Gather before writing

Read what the shape needs before a line of HTML: the source files, `git log` and
`git diff`, whatever MCP servers are connected in this session, the web. Never
write around a gap — either fill it or say in the document that it is open.

Data the user pastes: CSV parsed to a table or chart, JSON keys as labels,
numbers in prose lifted out into stat cards.

## 3. Build it

Copy the skeleton, then:

- **One dominant element per view.** A hero number, the key chart, the
  recommendation. Everything at equal weight reads as a list of things nobody
  ranked.
- **Vary the rhythm.** Alternate full-width sections, card grids and
  single-focus blocks. A page that is the same three-card grid five times over
  reads as a template with the text swapped.
- **Density is professional.** A dashboard with eight KPIs and four charts looks
  real; four KPIs and two charts looks like a demo. Sparse content at large
  sizes is the most common way an HTML document looks unfinished.
- **No orphaned grid item.** When the last row of a grid holds one card, span
  it or change the column count.
- **Responsive.** `repeat(auto-fit, minmax(320px, 1fr))`, collapsing to one
  column at 768px. Test at 768px and 375px — no horizontal overflow.

### One real interaction

Every document gets at least one interaction beyond the theme toggle, chosen
for the shape: a filter on a dashboard, `<details>` sections on a report, search
on a reference sheet, a category toggle on a comparison. A page with none reads
as a screenshot of a document.

`<details name="group">` gives an exclusive accordion with no script at all;
the Popover API gives tooltips and detail panels the same way. Reach for those
before writing JavaScript.

### Charts

Only when a number is the point. Chart.js from a CDN is fine.

- Theme-aware colours read from the CSS custom properties, never hard-coded
  hex, and re-read on theme change — define `onThemeChange()` for that.
- `maintainAspectRatio: false`, an explicit container height of at least 300px,
  tooltips left enabled.
- `role="img"` and a descriptive `aria-label` on every canvas.
- Turn the load animation off (`Chart.defaults.animation = false`) so the PDF
  export does not catch a half-drawn chart.

## 4. Check it

- Open it. Check both themes — a palette tuned on dark routinely fails contrast
  in light.
- 768px and 375px: no horizontal overflow, no clipped table.
- Print preview, or the PDF: the menu hidden, cards not split across a page
  break, backgrounds surviving.
- Body text at 14px or above, captions at 12px or above.
- No fabricated content anywhere.

## 5. Hand it over

Report the path and the shape, and offer the PDF:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/html-to-pdf/scripts/html-to-pdf.mjs" \
  --prefer-css-page-size --outline report.html
```

`--outline` builds bookmarks from the headings, which is what makes a long
document navigable. Say what the PDF loses: the theme toggle, the filters, and
any interaction.

## Anti-patterns

- Walls of text. If it reads like a document rather than something designed,
  Markdown would have done the job for less.
- Rainbow colour. Two or three colours plus neutrals.
- Everything centred at equal weight, with nothing dominant.
- A legend explaining colours that could have been labelled directly.
- Cramped layouts. When unsure, add whitespace.
- A missing `@media print` block — the document will be printed.

## Diagrams

Use `${CLAUDE_PLUGIN_ROOT}/skills/html-diagram` and paste its SVG in. That skill
carries the connector rules and the complexity budget; a diagram improvised
inside a document reliably ends up with diagonal arrows and nine unranked boxes.
