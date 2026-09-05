# NOTICE

The `visuals` plugin is a derivative work. Its skills were written for this
repository, but their design systems, layout rules and export mechanics are
taken from four upstream projects, all used under the MIT License.

## Upstream projects

### frontend-slides — https://github.com/zarazhangrui/frontend-slides

Source of everything in `skills/html-deck`:

- the fixed 16:9 stage model (slides authored at 1920x1080, the whole stage
  scaled by one transform, never reflowed per device)
- `assets/viewport-base.css`, taken essentially verbatim
- the visibility-based slide switching rule and the reason for it
- the density modes (speaker-led / reading-first)
- the "show, don't tell" style discovery flow (three real previews)
- the style presets in `references/style-presets.md` and the animation
  reference in `references/animations.md`
- the deck-to-PDF mechanism ported into `--mode slides` of the export script

Not carried over: the bold template pack, PowerPoint conversion, Vercel
deployment.

### html-to-pdf-skill — https://github.com/yqdaddy/html-to-pdf-skill

Source of `--mode page` in `skills/html-to-pdf/scripts/html-to-pdf.mjs`: the
Playwright `page.pdf()` option surface (paper format, margins, `@page` CSS,
bookmarks, accessibility tags, header/footer templates, batch conversion) and
the troubleshooting table. The upstream script is Python and written in
Chinese; this plugin's port is Node ESM and English, because
`.claude/rules/plugin-authoring.md` requires plugin scripts to run on node.

### visualize — https://github.com/careerhackeralex/visualize

Source of `shared/html-skeleton.md` and parts of `shared/design-system.md`:
the single-file HTML skeleton, the fixed CSS custom property names, the
class-based `.theme-light` / `.theme-dark` themes, the utility menu (theme
toggle, PNG download, print), the scroll-reveal and counter patterns, and the
minimum sizing / text visibility rules.

Also the source of `skills/html-doc`: the document shapes in
`references/doc-types.md` (one-pager, dashboard, comparison, timeline), the
layout-variation rules, the required-interaction table, the Chart.js
essentials, and the anti-patterns.

Not carried over: the upstream evaluation-harness instructions, the Chart.js
troubleshooting appendix, the bundled examples.

### diagram-design — https://github.com/cathrynlavery/diagram-design

Source of everything in `skills/html-diagram`:

- the editorial philosophy — deletion as the highest-quality move, a target
  density of 4/10, and the complexity budget
- the semantic palette (`paper` / `ink` / `muted` / `soft` / `rule` /
  `accent` / `link`) and the node-treatment table
- the six mandatory connector rules, the elbow-path and bridge/hop formulas,
  the node-box pattern, the masked arrow label, the legend strip and the
  zone grouping
- the 4px grid and the page layout
- the accessible-SVG contract and the pre-output taste gate
- eight of the type references, condensed into `references/diagram-types.md`
- `scripts/self-check.mjs`, ported from the upstream `scripts/self_check.py`
  because plugin scripts in this repository run on node. The port keeps the
  accessible-SVG and single-file-safety checks, drops the motion contract
  (these diagrams are static), and adds a mechanical diagonal-connector check.

Not carried over: 31 of the 39 type references, the icon set, brand onboarding
and saved client profiles, the draw.io and Mermaid importers, the animation
layer, and the bundled example HTML.

## The original license text

The same MIT terms apply to all four projects.

- Copyright (c) 2025 Zara Zhang (frontend-slides)
- Copyright (c) 2026 码孖AI (html-to-pdf-skill)
- Copyright (c) 2025 SangHyeon (Alex) Ahn (visualize)
- Copyright (c) 2025 Cathryn Lavery (diagram-design)

---

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
