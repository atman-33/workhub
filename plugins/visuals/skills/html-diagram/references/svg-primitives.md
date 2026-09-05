# Diagram primitives

The palette, the connector grammar and the layout rules every diagram type
shares. Read this before drawing.

Source: [diagram-design](https://github.com/cathrynlavery/diagram-design). See
the plugin's `NOTICE.md`.

---

## 1. Palette

Diagrams use their own editorial skin rather than the document tokens in
`shared/design-system.md` — a diagram is one composition on paper, not a themed
page. Refer to the roles by name; change the hex in one place to reskin.

| Role | Purpose | Light | Dark |
|---|---|---|---|
| `paper` | Page background, default node fill | `#f5f5f5` | `#2d3142` |
| `paper-2` | Container, secondary fill | `#ececec` | `#393e53` |
| `ink` | Primary text and stroke | `#2d3142` | `#f5f5f5` |
| `muted` | Secondary text, default arrow | `#4f5d75` | `#bfc0c0` |
| `soft` | Sublabels, boundary labels | `#7a8399` | `#8e98ac` |
| `rule` | Hairlines | `rgba(45,49,66,0.12)` | `rgba(245,245,245,0.12)` |
| `accent` | Focal, 1–2 per diagram | `#eb6c36` | `#f08a59` |
| `accent-tint` | Fill behind an accent border | `rgba(235,108,54,0.08)` | `rgba(240,138,89,0.10)` |
| `link` | HTTP/API calls, external arrows | `#2e5aa8` | `#6a95d8` |

Inversion rule: an `rgba(45,49,66,X)` in light becomes `rgba(245,245,245,X)` in
dark at the same opacity.

**Focal rule.** `accent` goes on at most two elements. Everything else is
`ink` / `muted` / `soft`. Wanting to accent four things means the focal question
is still unanswered.

### Node treatment

| Node | Fill | Stroke |
|---|---|---|
| Focal (1–2 max) | `accent-tint` | `accent` |
| Service / step | white | `ink` |
| Store / state | `ink` @ 0.05 | `muted` |
| External / cloud | `ink` @ 0.03 | `ink` @ 0.30 |
| Input / user | `muted` @ 0.10 | `soft` |
| Optional / async | `ink` @ 0.02 | `ink` @ 0.20, dashed `4,3` |
| Boundary | `accent` @ 0.05 | `accent` @ 0.50, dashed `4,4` |

---

## 2. Typography

| Role | Family | Size | Weight |
|---|---|---|---|
| Page title | a serif display face | 1.75rem | 400 |
| Node name | a sans face | 12px | 600 |
| Sublabel (port, URL, type) | mono | 9px | 400 |
| Eyebrow / type tag | mono, uppercase, tracked 0.18em | 7–8px | 500 |
| Arrow label | mono, tracked 0.06em | 8px | 400 |
| Editorial aside | serif italic | 14px | 400 |

**Mono is for technical content only** — never as a blanket "developer" font.
Human-readable names go in the sans face.

Japanese labels: the Latin display faces carry no kana or kanji. Extend the
family on those `<text>` elements (Noto Sans JP / Noto Serif JP), budget one em
per full-width character when sizing boxes, and never set Japanese below 12px.

---

## 3. Background

Default is clean paper, no pattern, and no container box around the drawing:

```svg
<rect width="100%" height="100%" fill="#f5f5f5"/>
```

A dotted ground is available for a hero diagram on a page of its own. Do not use
it inside a slide or a card — the texture compounds with the surrounding chrome
and reads as noise.

```svg
<defs>
  <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse">
    <circle cx="1" cy="1" r="0.9" fill="rgba(45,49,66,0.10)"/>
  </pattern>
</defs>
<rect width="100%" height="100%" fill="#f5f5f5"/>
<rect width="100%" height="100%" fill="url(#dots)" opacity="0.6"/>
```

---

## 4. Arrow markers — define all three, always

```svg
<marker id="arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
  <polygon points="0 0, 8 3, 0 6" fill="#4f5d75"/>
</marker>
<marker id="arrow-accent" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
  <polygon points="0 0, 8 3, 0 6" fill="#eb6c36"/>
</marker>
<marker id="arrow-link" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
  <polygon points="0 0, 8 3, 0 6" fill="#2e5aa8"/>
</marker>
```

| Arrow | Stroke | When |
|---|---|---|
| Default | `muted` | Internal, generic |
| Accent | `accent` | The one relationship the diagram is about |
| Link | `link` | HTTP/API, external systems |
| Dashed | `stroke-dasharray="5,4"` on any of the above | Optional, passive, return, async |

**Draw arrows before boxes**, so z-order puts the lines behind the nodes.

---

## 5. The six connector rules

Non-negotiable. Each is an automatic fail.

### 1. Rounded right angles, never diagonals

A plain `<line>` is allowed only when the endpoints share an x or a y. Every
other connection is a two-bend elbow with `r=8` (6 in tight layouts):

```svg
<!-- right then down: (x1,y1) to (x2,y2), mid = (x1+x2)/2 -->
<path d="M x1,y1 H mid-8 Q mid,y1 mid,y1+8 V y2-8 Q mid,y2 mid+8,y2 H x2"
      fill="none" stroke="#4f5d75" stroke-width="1.2" marker-end="url(#arrow)"/>
```

Flip the vertical signs for right-then-up.

**Port selection.** When the destination is clearly above or below the source,
leave and enter through the top or bottom edge, with a single-bend L path.
Reserve the left and right ports for connections that travel mainly
horizontally — entering a node from the side on a vertical path looks like the
arrow punctures the node's face rather than arriving from above.

```svg
<!-- entering from below (destination above source) -->
<path d="M x1,y_src H x2-8 Q x2,y_src x2,y_src-8 V y_dst"
      fill="none" stroke="#4f5d75" stroke-width="1.2" marker-end="url(#arrow)"/>
```

Dashed paths follow exactly the same routing; the dash carries semantic weight,
not a different grammar.

### 2. A 6–10px gap between a label and its connector

The label never sits *on* the arrow. The opaque mask stops the stroke bleeding
through the text; the visible gap is what lets the reader still trace the line.
Never let the mask touch the stroke.

### 3. No overlapping connectors

Two connectors never share a stroke path or run on top of each other. Where two
must cross, hop the less important one:

```svg
<!-- horizontal hop over a vertical crossing at x=cx -->
<path d="M x1,y H cx-8 a 8,8 0 0,1 16,0 H x2"
      fill="none" stroke="#4f5d75" stroke-width="1.2" marker-end="url(#arrow)"/>
```

For a vertical hop over a horizontal, use `a 8,8 0 0,0 0,16`. Bridge the
passive, secondary or dashed one. Never bridge both.

Parallel connectors running the same way stay ≥12px apart along their whole
length, not only at the attach point. If you find yourself stacking connectors,
the layout has failed — two nodes are too close, or the diagram is over budget.

### 4. Fan the attach points on a shared edge

No two connectors share a single point on a box. For N connectors on an edge of
length L, attach point k sits at `L * k / (N + 1)` from the leading corner,
≥12px apart (8px on very small boxes). Route each one orthogonally from its own
point; do not merge the strokes near the box.

### 5. No connector behind a non-endpoint box

Reroute around intervening boxes. The single exception is a cross-cutting node —
a footer bar, a horizontal layer — that physically sits on the only straight
path between source and destination. In that case the stroke is **dashed** to
say "transit, not interaction", the label sits at the visible end, and no
arrowhead lands on the intervening box.

### 6. A label mask must not overlap a node drawn after it

Nodes are painted after labels, so a mask landing inside a node is covered by
the node fill and the text renders as a fragment on the node border. Put the
label on a segment running through open canvas. A mask entirely inside a node is
a badge chip and is fine; one over a zone container is fine too, because zones
are painted first.

---

## 6. Node box — the full pattern

```svg
<!-- 1. Opaque paper mask, so arrows do not show through a transparent fill -->
<rect x="X" y="Y" width="W" height="H" rx="6" fill="#f5f5f5"/>
<!-- 2. The box -->
<rect x="X" y="Y" width="W" height="H" rx="6" fill="FILL" stroke="STROKE" stroke-width="1"/>
<!-- 3. Type tag — a rectangle at rx=2, not a pill -->
<rect x="X+8" y="Y+6" width="28" height="12" rx="2" fill="transparent"
      stroke="STROKE@0.40" stroke-width="0.8"/>
<text x="X+22" y="Y+15" fill="STROKE@0.8" font-size="7" font-family="mono"
      text-anchor="middle" letter-spacing="0.08em">API</text>
<!-- 4. Node name, in the sans face -->
<text x="CX" y="CY+2" fill="#2d3142" font-size="12" font-weight="600"
      font-family="sans-serif" text-anchor="middle">Node Name</text>
<!-- 5. Technical sublabel, in mono -->
<text x="CX" y="CY+18" fill="#4f5d75" font-size="9"
      font-family="monospace" text-anchor="middle">tech:port</text>
```

## 7. Arrow labels

```svg
<!-- Mask 14px above the stroke: 8px of text plus a 6px gap -->
<rect x="MID_X-18" y="ARROW_Y-20" width="36" height="12" rx="2" fill="#f5f5f5"/>
<text x="MID_X" y="ARROW_Y-11" fill="#7a8399" font-size="8"
      font-family="monospace" text-anchor="middle" letter-spacing="0.06em">WRITE</text>
```

At most 14 characters, upper case, centred on the segment midpoint. For a
vertical segment, put the label to the side with the same 6–10px gap. Never
vertical text.

## 8. Legend

Never inside the drawing. A horizontal strip at the bottom, under a hairline,
with the items about 160px apart. Expand the `viewBox` height by roughly 60px to
hold it.

```svg
<line x1="30" y1="LEGEND_Y-8" x2="VIEWBOX_W-30" y2="LEGEND_Y-8"
      stroke="rgba(45,49,66,0.10)" stroke-width="0.8"/>
<text x="30" y="LEGEND_Y+8" fill="#4f5d75" font-size="8" font-family="monospace"
      letter-spacing="0.14em">LEGEND</text>
```

## 9. Zones

Group nodes that share a tier or a trust boundary. Z-order is background →
zones → arrows → nodes.

```svg
<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8"
      fill="rgba(45,49,66,0.02)" stroke="rgba(45,49,66,0.10)" stroke-width="0.8"/>
<rect x="{label_x}" y="{y+4}" width="{label_w}" height="12" rx="2" fill="#f5f5f5"/>
<text x="{label_cx}" y="{y+13}" fill="rgba(45,49,66,0.40)" font-size="7"
      font-family="monospace" text-anchor="middle" letter-spacing="0.14em">LAYER</text>
```

Leave ≥16px between the bottom of the zone label and the top of the first
enclosed node. Fill no stronger than a 2% ink wash. At most three zones — more
than that and it is a swimlane, so use that type instead.

---

## 10. The 4px grid

**Every value — font size, padding, node dimension, gap, x and y — divisible
by 4.** Not negotiable.

| Category | Allowed |
|---|---|
| Font size | 8, 12, 16, 20, 24, 28, 32, 40 |
| Node width / height | 80, 96, 112, 120, 128, 140, 144, 160, 180, 200, 240, 320 |
| x / y | any multiple of 4 |
| Gap between nodes | 20, 24, 32, 40, 48 |
| Padding inside a box | 8, 12, 16 |
| Corner radius | 4, 6, 8 |

Exempt: stroke widths (0.8, 1, 1.2), opacities, and the 22x22 dot pattern.

Quick check: a coordinate ending in 1, 2, 3, 5, 6, 7 or 9 is wrong.

## 11. Complexity budget

| Limit | Value |
|---|---|
| Nodes | 9 |
| Arrows | 12 |
| Accent elements | 2 |
| Lifelines (sequence) | 5 |
| Lanes (swimlane) | 5 |
| Items (quadrant) | 12 |
| Tree depth / breadth per level | 4 / 5 |
| Zones | 3 |
| Editorial callouts | 2 |

Over budget means two diagrams: an overview and a detail.

## 12. Page layout

1. **Header** — eyebrow in mono, title in the serif face, optional subtitle.
2. **Diagram** — borderless by default; the SVG sits directly on the page.
3. **Summary cards**, if any — two or three columns at *varied* widths
   (`1.1fr 1fr 0.9fr`), white fill, 1px hairline border, 6px radius, **no
   shadow**.
4. **Footer** — a colophon in mono over a hairline.

## 13. The accessible SVG contract

The checker enforces all of this.

1. `<svg>` carries `role="img"` and `aria-labelledby` naming its title then its
   description.
2. `<title>` is the **first child** of `<svg>`, before `<defs>`. Assistive
   technology may ignore one placed later.
3. The ids are prefixed per diagram: `<slug>-title` and `<slug>-desc`. Bare
   `title` / `desc` are banned — two diagrams on one page would collide and the
   second could be announced under the first one's name.
4. `<title>` is the subject's short name, about 60 characters.
5. `<desc>` is one sentence saying what the diagram shows to a reader who cannot
   see it. Describe the content, not the geometry: "Order flow from checkout
   through payment authorisation to fulfilment, with the retry path on
   timeout" — not "a box at the top with five boxes below it".
6. A decorative-only SVG carries `aria-hidden="true"` instead.

## 14. Output

A single self-contained `.html`: embedded CSS, inline SVG, no external images,
and no external resource other than a Google Fonts stylesheet. Static — no
script at all.
