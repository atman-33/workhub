# Visual design system

Shared by every skill in this plugin. Read it before generating any HTML.

Sources: the design system of
[visualize](https://github.com/careerhackeralex/visualize) and the design
aesthetics section of
[frontend-slides](https://github.com/zarazhangrui/frontend-slides). See
[NOTICE.md](../NOTICE.md).

---

## 1. Avoid the default look

Left alone, generated frontends converge on one recognisable house style, and
readers read that style as "nobody chose this". Every deliverable this plugin
produces has to look authored.

**Do not ship:**

- Inter, Roboto, Arial, or the system font stack as the display face
- A purple-to-blue gradient on white
- Evenly distributed pastel palettes where nothing dominates
- Card grids with uniform 8px radii and a single drop shadow, repeated down
  the page
- Emoji standing in for iconography in a formal deliverable

**Do instead:**

- **Typography.** Pick a display face with a point of view and pair it with a
  quiet body face. Google Fonts and Fontshare are both fine. Commit: one
  display face, one body face, at most one accent face.
- **Colour.** One dominant colour carrying most of the surface area, one sharp
  accent used two or three times per view. A palette where every colour gets
  equal space reads as indecision.
- **Motion.** One well-orchestrated entrance with staggered delays beats a
  dozen scattered micro-interactions. Always honour
  `prefers-reduced-motion`.
- **Background.** Layered gradients, a grid, or grain — atmosphere rather than
  a flat fill. Keep it behind the content, never competing with it.

Vary between deliverables. Converging on the same distinctive choice every
time is the same failure as converging on the generic one.

---

## 2. Colour tokens

Every document-shaped deliverable (`html-doc`, reports, one-pagers) uses these
exact custom property names. They are fixed so that skills, shared snippets and
future tooling can rely on them:

```
--bg  --surface  --surface-hover  --border
--text  --text-secondary
--accent  --accent-secondary
--positive  --negative  --warning
```

Do not rename them (`--bg-primary`, `--text-primary` and friends are wrong).
Add extra properties freely; just keep these eleven.

Slide decks are the exception. A deck commits to one style and does not carry
a theme toggle, so `skills/html-deck` uses its own preset variables.

### Themes are classes, not media queries

Define both themes as classes on `<html>` and switch by swapping the class:

```css
html.theme-dark  { --bg: #0A0A0A; --surface: #141414; /* ... */ }
html.theme-light { --bg: #FAFAF9; --surface: #FFFFFF; /* ... */ }
```

Pick the initial theme from `prefers-color-scheme` in script, then let the
user's choice persist in `localStorage`. Do not define the palette only inside
`@media (prefers-color-scheme: dark)` — the toggle then has nothing to switch,
and printing is unpredictable.

Never give a colour its only definition inside one theme block. Both classes
define the full set.

---

## 3. Typography scale

- Headings: `line-height: 1.08`, `letter-spacing: -0.03em`,
  `text-wrap: balance`.
- Body: `line-height: 1.6`, `letter-spacing: -0.01em`.
- Measure: 60–75 characters for running prose. Wider than that and the reader
  loses the line.
- Never set body copy below 14px in a document, or below 24px at 1920x1080
  stage size in a deck.

Load language fonts explicitly when the content needs them — Noto Sans JP for
Japanese, Noto Sans KR for Korean. A Latin-only webfont silently falls back
mid-paragraph and the result looks broken.

---

## 4. Minimum sizing

| Element | Minimum |
|---|---|
| Body text (document) | 14px |
| Secondary/caption text | 12px |
| Body text (deck, at 1920x1080) | 24px |
| Chart container height | 300px |
| Touch target | 44x44px |

Anything that only fits by going below these limits does not fit. Cut content
or split the view instead of shrinking.

---

## 5. Text visibility

- Contrast: at least 4.5:1 for body text, 3:1 for large text, in **both**
  themes. Check the light theme too; a palette tuned on dark routinely fails
  in light.
- Text over an image or gradient needs a scrim, not hope.
- Never rely on colour alone to carry meaning. Pair it with a label, an icon
  or a position.

---

## 6. Anti-patterns

- Content that scrolls when it was supposed to fit
- Panels that overlap because a grid child overflowed its track
- A legend explaining colours that could have been labelled directly
- Decoration that repeats identically in every section — variation is what
  signals that a human made a decision
- Charts without tooltips, canvases without `role="img"` and an `aria-label`
- Fabricated data. If a number was not read from a real source, it does not go
  in the deliverable.
