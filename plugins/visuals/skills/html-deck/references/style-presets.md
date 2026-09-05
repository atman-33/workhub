# Deck style presets

Twelve starting points for the three previews in Phase 2. Each is a real
design position, not a colour swatch: the layout, the type pairing and the
signature element together make the deck look authored.

A preset is a starting point, not a template. Adapt it to the subject; do not
reproduce the demo layout literally.

Abstract CSS shapes only — no illustrations.

Source: [frontend-slides](https://github.com/zarazhangrui/frontend-slides). See
the plugin's `NOTICE.md`.

---

## Dark

### 1. Bold Signal — confident, high impact

Layout: a saturated colour card on a dark gradient; section number top-left,
navigation top-right, title bottom-left.
Type: `Archivo Black` (900) + `Space Grotesk` (400/500).

```css
--bg-primary: #1a1a1a;
--bg-gradient: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 50%, #1a1a1a 100%);
--card-bg: #FF5722;
--text-primary: #ffffff;
--text-on-card: #1a1a1a;
```

Signature: one bold colour card as the focal point, large section numerals
(01, 02), breadcrumb navigation with opacity states, strict grid alignment.

### 2. Electric Studio — clean, professional, high contrast

Layout: split panel, white above, blue below; brand marks in the corners.
Type: `Manrope` (800 / 400).

```css
--bg-dark: #0a0a0a;
--bg-white: #ffffff;
--accent-blue: #4361ee;
--text-dark: #0a0a0a;
--text-light: #ffffff;
```

Signature: two-panel vertical split, accent bar on the panel edge, quotes set
as the hero element, confident spacing.

### 3. Creative Voltage — energetic, retro-modern

Layout: split panels, electric blue left, dark right.
Type: `Syne` (700/800) + `Space Mono` (400/700).

```css
--bg-primary: #0066ff;
--bg-dark: #1a1a2e;
--accent-neon: #d4ff00;
--text-light: #ffffff;
```

Signature: electric blue against neon yellow, halftone texture, neon badges.

### 4. Dark Botanical — elegant, premium

Layout: centred content on near-black, soft abstract shapes in one corner.
Type: `Cormorant` (400/600) + `IBM Plex Sans` (300/400).

```css
--bg-primary: #0f0f0f;
--text-primary: #e8e4df;
--text-secondary: #9a9590;
--accent-warm: #d4a574;
--accent-pink: #e8b4b8;
--accent-gold: #c9b896;
```

Signature: blurred overlapping gradient circles, warm accents, thin vertical
rules, italic signature type. Abstract CSS shapes only.

---

## Light

### 5. Notebook Tabs — editorial, tactile

Layout: a cream paper card on a dark ground, colourful tabs down the right
edge.
Type: `Bodoni Moda` (400/700) + `DM Sans` (400/500).

```css
--bg-outer: #2d2d2d;
--bg-page: #f8f6f1;
--text-primary: #1a1a1a;
--tab-1: #98d4bb;  /* mint */
--tab-2: #c7b8ea;  /* lavender */
--tab-3: #f4b8c5;  /* pink */
--tab-4: #a8d8ea;  /* sky */
--tab-5: #ffe6a7;  /* cream */
```

Signature: paper container with a soft shadow, vertical tab text, binder holes
on the left.

### 6. Pastel Geometry — friendly, organised

Layout: a white card on a pastel ground, vertical pills down the right edge.
Type: `Plus Jakarta Sans` (700/800 and 400/500).

```css
--bg-primary: #c8d9e6;
--card-bg: #faf9f7;
--pill-pink: #f0b4d4;
--pill-mint: #a8d4c4;
--pill-sage: #5a7c6a;
--pill-lavender: #9b8dc4;
--pill-violet: #7c6aad;
```

Signature: rounded card, pills of one width and varying heights
(short, medium, tall, medium, short).

### 7. Split Pastel — playful, modern

Layout: two-colour vertical split, peach left, lavender right.
Type: `Outfit` (700/800 and 400/500).

```css
--bg-peach: #f5e6dc;
--bg-lavender: #e4dff0;
--text-dark: #1a1a1a;
--badge-mint: #c8f0d8;
--badge-yellow: #f0f0c8;
--badge-pink: #f0d4e0;
```

Signature: split background, badge pills, a grid overlay on one panel, rounded
call-to-action buttons.

### 8. Vintage Editorial — witty, personality-driven

Layout: centred content on cream with abstract geometric accents.
Type: `Fraunces` (700/900) + `Work Sans` (400/500).

```css
--bg-cream: #f5f3ee;
--text-primary: #1a1a1a;
--text-secondary: #555555;
--accent-warm: #e8d4c0;
```

Signature: circle outline plus line plus dot, bold bordered boxes,
conversational copy. Geometric CSS shapes only.

---

## Specialty

### 9. Neon Cyber — futuristic

`Clash Display` + `Satoshi` (Fontshare). Deep navy `#0a0f1c`, cyan `#00ffcc`,
magenta `#ff00aa`. Particle background, neon glow, grid patterns.

### 10. Terminal Green — developer, hacker

`JetBrains Mono` throughout. GitHub dark `#0d1117`, terminal green `#39d353`.
Scan lines, blinking cursor, syntax-styled code.

### 11. Swiss Modern — precise, Bauhaus

`Archivo` (800) + `Nunito` (400). Pure white, pure black, red `#ff3300`.
Visible grid, asymmetric layout, geometric shapes.

### 12. Paper & Ink — literary, considered

`Cormorant Garamond` + `Source Serif 4`. Warm cream `#faf9f7`, charcoal
`#1a1a1a`, crimson `#c41e3a`. Drop caps, pull quotes, elegant rules.

---

## Font pairings at a glance

| Preset | Display | Body | Source |
|---|---|---|---|
| Bold Signal | Archivo Black | Space Grotesk | Google |
| Electric Studio | Manrope | Manrope | Google |
| Creative Voltage | Syne | Space Mono | Google |
| Dark Botanical | Cormorant | IBM Plex Sans | Google |
| Notebook Tabs | Bodoni Moda | DM Sans | Google |
| Pastel Geometry | Plus Jakarta Sans | Plus Jakarta Sans | Google |
| Split Pastel | Outfit | Outfit | Google |
| Vintage Editorial | Fraunces | Work Sans | Google |
| Neon Cyber | Clash Display | Satoshi | Fontshare |
| Terminal Green | JetBrains Mono | JetBrains Mono | Google |
| Swiss Modern | Archivo | Nunito | Google |
| Paper & Ink | Cormorant Garamond | Source Serif 4 | Google |

## Never ship

- **Fonts:** Inter, Roboto, Arial or a system stack as the display face
- **Colour:** `#6366f1` and its neighbours; purple gradients on white
- **Layout:** everything centred, generic hero sections, identical card grids
- **Decoration:** realistic illustration, gratuitous glassmorphism, shadows
  with no purpose

## CSS gotcha: negating a function

A leading `-` in front of a CSS function is invalid. The browser discards the
whole declaration with no console error, and the element silently lands in the
wrong place.

```css
/* wrong — silently ignored */
right: -clamp(28px, 3.5vw, 44px);
margin-left: -min(10vw, 100px);

/* right */
right: calc(-1 * clamp(28px, 3.5vw, 44px));
margin-left: calc(-1 * min(10vw, 100px));
```
