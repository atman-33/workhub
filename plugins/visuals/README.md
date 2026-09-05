# visuals

Visual deliverables as self-contained HTML, and the PDF you hand over.

Everything this plugin produces is one HTML file with inline CSS and JS: it
opens in any browser, travels as an email attachment, and needs no build step
and no external design tool. The rendering happens here, in the session.

Tier: **optional**. Scope: **user**. See
[docs/plugins.md](../../docs/plugins.md).

## Skills

| Skill | Use |
|---|---|
| `html-deck` | A presentation on a fixed 16:9 stage — content shape, three style previews, generation, browser verification, PDF |
| `html-diagram` | A diagram in inline SVG: flowchart, sequence, architecture, timeline, tree, swimlane, quadrant, loop. Orthogonal connectors, a hard complexity budget, a checker |
| `html-doc` | A document people read: an explainer, a one-pager, a report, a dashboard, a comparison |
| `html-to-pdf` | Publication-quality PDF via headless Chromium. `--mode page` for documents, `--mode slides` for decks |

The four are one plugin because they are wanted in the same session — a deck
with a diagram on slide three, exported to PDF — and because splitting them
would copy the design system three times.

## Shared

`shared/` holds what the skills have in common, so the design rules are
written once:

- `design-system.md` — colour tokens, themes, type scale, minimum sizes, and
  the rules against the default generated look. Read before generating
  anything.
- `html-skeleton.md` — the single-file skeleton for document-shaped
  deliverables: class-based themes, utility menu (theme, PNG, print), scroll
  reveal, counters.

Reach them from a skill as `${CLAUDE_PLUGIN_ROOT}/shared/<file>.md`.

## Relationship to `authoring`

`authoring` writes text deliverables — README, CLAUDE.md, release notes, work
logs — and delivers them. `visuals` produces the visual ones. There is no
overlap: a skill that emits HTML or PDF belongs here, a skill that emits
Markdown or prose belongs there.

## Dependencies

Only `html-to-pdf` has one: Playwright, which it installs once into
`~/.workhub/visuals-playwright` on first use. Nothing is installed into the
project being worked on; the other three skills need nothing but node, and
`html-diagram`'s checker is dependency-free.

## Attribution

Derived from four MIT-licensed upstream projects. See [NOTICE.md](NOTICE.md).
