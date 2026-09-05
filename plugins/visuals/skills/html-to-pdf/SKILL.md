---
name: html-to-pdf
description: Convert an HTML file into a publication-quality PDF with headless Chromium — a document paginated by @page CSS with margins, bookmarks and page numbers, or a fixed-stage slide deck captured one slide per page. Use when the user wants to export, print or hand over an HTML report, one-pager or presentation as a PDF, or asks to turn a web page into a PDF.
allowed-tools: Bash Read Glob
---

# HTML to PDF

Chromium renders the file exactly as a browser would — `@page`, flexbox, grid,
webfonts, SVG, `@media print`, and JavaScript all work — and writes a PDF.

Source: the option surface and troubleshooting come from
[html-to-pdf-skill](https://github.com/yqdaddy/html-to-pdf-skill); the deck
capture from [frontend-slides](https://github.com/zarazhangrui/frontend-slides).
See the plugin's `NOTICE.md`.

## Pick the mode first

This is the only decision that matters, and getting it wrong produces a PDF
that looks plausible in the file listing and is wrong when opened.

| Input | Mode |
|---|---|
| Report, one-pager, explainer, dashboard — anything that scrolls | `--mode page` (default) |
| Slide deck whose slides carry `class="slide"` | `--mode slides` |

A deck's print stylesheet un-hides every slide and page-breaks between them,
so `--mode page` does emit one page per slide — at paper size, in portrait,
with a 1920x1080 composition squeezed into it, and with every slide but the
one that was active rendered blank, because entrance animations key off a class
the deck only sets on the current slide. Measured on a four-slide deck: A4
portrait pages, three of them empty.

`--mode slides` shows each slide in turn at stage resolution, pins the entrance
animations to their finished state, captures each one and assembles the
captures into a 16:9 PDF.

If the file's mode is not obvious, grep it: `class="slide"` on repeated
elements means a deck.

## Run it

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/html-to-pdf/scripts/html-to-pdf.mjs" report.html
```

Output defaults to the input path with a `.pdf` extension. Pass a second path
to choose the output, or several `.html` inputs to convert them in one run.

**First run installs Playwright** into `~/.workhub/visuals-playwright`, which
downloads Chromium and takes about a minute. Nothing is installed into the
project. Tell the user before starting so the pause is expected. If the
automatic install fails, fall back to:

```bash
npm install -g playwright
npx playwright install chromium
```

## Documents — `--mode page`

Read the file first. If it declares `@page`, honour it:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/html-to-pdf/scripts/html-to-pdf.mjs" \
  --prefer-css-page-size --outline report.html report.pdf
```

`--outline` builds PDF bookmarks from the headings, which is what makes a long
report navigable. Prefer it whenever the document has real heading structure.
Chromium derives the outline from the tagged structure tree, so `--outline`
turns `--tagged` on by itself; passing `--outline` alone to Playwright produces
a PDF with no bookmarks and no warning.

Without `@page` in the CSS, set the paper explicitly:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/html-to-pdf/scripts/html-to-pdf.mjs" \
  --format A4 --margin-top 20mm --margin-bottom 20mm \
  --margin-left 18mm --margin-right 18mm doc.html
```

Page numbers go in a footer template:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/html-to-pdf/scripts/html-to-pdf.mjs" \
  --footer-template '<div style="font-size:9px;width:100%;text-align:center">Page <span class="pageNumber"></span> / <span class="totalPages"></span></div>' \
  doc.html
```

Wide tables read better rotated: `--landscape`.

## Decks — `--mode slides`

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/html-to-pdf/scripts/html-to-pdf.mjs" \
  --mode slides deck.html deck.pdf
```

Each slide becomes one 1920x1080 page. Animation is flattened to its finished
state — say so when handing the PDF over, so the user is not surprised that
the motion is gone.

An 18-slide deck lands around 20MB. Past roughly 10MB, offer `--compact`
(1280x720), which typically halves the size with no visible loss at reading
distance.

## Options

```
--mode page|slides        page (default) paginates; slides captures each .slide
--format FORMAT           A4 (default), Letter, Legal, A0-A6
--landscape               landscape orientation
--prefer-css-page-size    obey @page size and margins from the CSS
--margin-top|-right|-bottom|-left DIM    e.g. 20mm, 1in, 72pt
--outline                 PDF bookmarks from h1-h6
--tagged                  accessibility tags
--scale N                 zoom factor (default 1.0)
--no-background           omit background colours and images
--header-template HTML    page header (page mode)
--footer-template HTML    page footer (page mode)
--compact                 capture decks at 1280x720
--width N / --height N    explicit capture size (slides mode)
--quiet, -q               suppress progress output
```

## Finish

Report the output path and size, and name anything that was flattened
(animation, interactivity, the theme toggle). Do not open the PDF unless the
user asked for it.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Deck pages are portrait, and all but one are blank | ran `--mode page` on a deck | use `--mode slides` |
| "no .slide elements found" | not a fixed-stage deck, or a different class name | use `--mode page`, or rename the slide class |
| Background colours missing | `--no-background` was passed, or the page has no print rules | drop the flag; add `print-color-adjust: exact` to the CSS |
| `@page` rules ignored | the flag was not passed | add `--prefer-css-page-size` |
| Fonts look wrong | the face is not installed locally | use a webfont, or embed it with `@font-face` |
| Images missing | absolute filesystem paths in `src` | make the paths relative to the HTML; the script serves that directory over HTTP |
| Blank pages | content renders after `networkidle` | have the page finish its work on load rather than on a timer |
| Text not selectable | the content is a raster image | expected; only OCR changes that |
| Install fails behind a proxy | npm or the Chromium download is blocked | install Playwright manually on a network that allows it |
