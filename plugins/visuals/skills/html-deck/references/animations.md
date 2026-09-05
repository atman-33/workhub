# Deck animation reference

Motion is chosen for a feeling, not sprinkled on. One orchestrated entrance
per slide, staggered — that is the whole budget.

Source: [frontend-slides](https://github.com/zarazhangrui/frontend-slides). See
the plugin's `NOTICE.md`.

## Effect to feeling

| Feeling | Motion | Visual cues |
|---|---|---|
| Dramatic / cinematic | Slow fades (1–1.5s), scale 0.9 to 1, parallax | Dark ground, spotlight, full-bleed imagery |
| Techy / futuristic | Neon glow, text scramble, grid reveals | Particles, grid patterns, mono accents, cyan/magenta |
| Playful / friendly | Spring easing, gentle float | Rounded corners, bright colour, hand-drawn marks |
| Professional / corporate | Fast and subtle (200–300ms) | Navy/slate/charcoal, precise spacing, data first |
| Calm / minimal | Very slow, gentle fades | Whitespace, muted palette, serif type |
| Editorial / magazine | Staggered text reveals, image-text interplay | Strong hierarchy, pull quotes, grid-breaking layout |

## Entrance

Slides reveal on the `.visible` class, which the controller sets on the active
slide. Never key an entrance off scroll position — a fixed-stage deck does not
scroll.

```css
/* Fade and rise — the default */
.reveal {
    opacity: 0;
    transform: translateY(30px);
    transition: opacity 0.6s var(--ease-out-expo),
                transform 0.6s var(--ease-out-expo);
}
.slide.visible .reveal { opacity: 1; transform: none; }

/* Stagger children */
.reveal:nth-child(1) { transition-delay: 0.1s; }
.reveal:nth-child(2) { transition-delay: 0.2s; }
.reveal:nth-child(3) { transition-delay: 0.3s; }
.reveal:nth-child(4) { transition-delay: 0.4s; }

/* Variants */
.reveal-scale { opacity: 0; transform: scale(0.9); transition: opacity 0.6s, transform 0.6s var(--ease-out-expo); }
.reveal-left  { opacity: 0; transform: translateX(-50px); transition: opacity 0.6s, transform 0.6s var(--ease-out-expo); }
.reveal-blur  { opacity: 0; filter: blur(10px); transition: opacity 0.8s, filter 0.8s var(--ease-out-expo); }
```

## Backgrounds

```css
/* Layered radial gradients — depth without an image */
.gradient-bg {
    background:
        radial-gradient(ellipse at 20% 80%, rgba(120, 0, 255, 0.3) 0%, transparent 50%),
        radial-gradient(ellipse at 80% 20%, rgba(0, 255, 200, 0.2) 0%, transparent 50%),
        var(--bg-primary);
}

/* Structural grid */
.grid-bg {
    background-image:
        linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px);
    background-size: 50px 50px;
}
```

Grain goes in as an inline SVG noise data URI; never as an external image,
which would break the single-file rule.

## Reduced motion

`assets/viewport-base.css` already collapses animation under
`prefers-reduced-motion: reduce`. Do not add motion that bypasses it — no
`animation` set in script, no transitions applied through inline styles.

## PDF export

`html-to-pdf --mode slides` forces `.reveal` elements to their finished state
before capturing, so an entrance animation does not leak a half-faded element
into the PDF. Anything animating through some other class name will not be
pinned — keep entrance state on `.reveal`.

## Troubleshooting

| Problem | Fix |
|---|---|
| Fonts do not load | Check the Google Fonts / Fontshare URL and that the family names match the CSS |
| Nothing animates | The controller is not adding `.visible` to the active slide |
| Every slide is visible at once | A layout rule set `display` on `.slide`; switch with `visibility` only |
| Motion stutters | Animate `transform` and `opacity` only; use `will-change` sparingly |
| A negated `clamp()` does nothing | Wrap it: `calc(-1 * clamp(...))` |
