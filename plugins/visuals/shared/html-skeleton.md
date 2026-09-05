# Single-file HTML skeleton

The starting point for every document-shaped deliverable: reports, one-pagers,
explainers, dashboards. Copy the whole skeleton, then add content.

Slide decks do **not** use this file — see `skills/html-deck`, which has its
own fixed-stage template.

Source: the skeleton of
[visualize](https://github.com/careerhackeralex/visualize), with the duplicated
`<main>` element and duplicated skip link removed. See [NOTICE.md](../NOTICE.md).

## Principles

- **One file.** Inline `<style>` and `<script>`. The deliverable is something
  a person can mail, drop in Slack, or open from a USB stick.
- **CSS first, JS minimal.** Animation is `@keyframes` and `transition`.
  Script exists only for the menu, the theme toggle, the scroll observer,
  counters and the PNG download.
- **No CDN unless it earns it.** A chart library is worth a script tag; a CSS
  framework is not. The `html-to-image` tag below is required by the menu.

## Skeleton

```html
<!DOCTYPE html>
<html lang="en" class="theme-dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>YOUR TITLE HERE</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <!-- Pick display + body faces per shared/design-system.md. Add a language
       font when the content needs one (Noto Sans JP, Noto Sans KR, ...). -->
  <link href="https://fonts.googleapis.com/css2?family=YOUR+FONT:wght@400;600;800&display=swap" rel="stylesheet">
  <!-- Required by the Download PNG menu item -->
  <script src="https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    /* ===== THEMES — class based, both fully defined ===== */
    html.theme-dark {
      --bg: #0A0A0A; --surface: #141414; --surface-hover: #1C1C1C;
      --border: rgba(255,255,255,0.08);
      --text: #EDEDED; --text-secondary: #888888;
      --accent: #3b82f6; --accent-secondary: #8b5cf6;
      --positive: #10b981; --negative: #f43f5e; --warning: #f59e0b;
    }
    html.theme-light {
      --bg: #FAFAF9; --surface: #FFFFFF; --surface-hover: #F5F5F4;
      --border: rgba(0,0,0,0.08);
      --text: #0f172a; --text-secondary: #64748b;
      --accent: #2563eb; --accent-secondary: #7c3aed;
      --positive: #059669; --negative: #e11d48; --warning: #d97706;
    }

    body {
      font-family: 'YOUR BODY FONT', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--bg); color: var(--text);
      line-height: 1.6; letter-spacing: -0.01em;
      -webkit-font-smoothing: antialiased;
      transition: background 0.3s, color 0.3s;
      scrollbar-gutter: stable;
    }
    h1, h2, h3, h4, h5, h6 {
      color: var(--text); line-height: 1.08;
      letter-spacing: -0.03em; text-wrap: balance;
    }
    .text-secondary { color: var(--text-secondary); }

    /* ===== CARD ===== */
    .card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 8px; padding: 24px;
      transition: box-shadow 0.2s ease;
    }
    .card:hover { box-shadow: 0 8px 16px rgba(0,0,0,0.10); }

    /* ===== ANIMATION ===== */
    @keyframes fadeInUp { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: none; } }
    .animate { animation: fadeInUp 0.6s ease-out both; }
    .animate.delay-1 { animation-delay: 0.1s; }
    .animate.delay-2 { animation-delay: 0.2s; }
    .animate.delay-3 { animation-delay: 0.3s; }
    .animate.delay-4 { animation-delay: 0.4s; }

    /* Scroll reveal. Content is visible without script; the observer only
       adds .visible. Never hide content that script has to un-hide. */
    .reveal { opacity: 0; transform: translateY(24px); transition: opacity 0.6s ease, transform 0.6s ease; }
    .reveal.visible { opacity: 1; transform: none; }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation: none !important; transition: none !important; }
      .reveal { opacity: 1; transform: none; }
    }

    /* ===== PRINT ===== */
    @media print {
      body { background: #fff !important; color: #000 !important; }
      .viz-menu { display: none !important; }
      .reveal { opacity: 1 !important; transform: none !important; }
      .card { break-inside: avoid; border: 1px solid #ddd; box-shadow: none; }
      * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    }
    @page { margin: 1in; }

    /* ===== UTILITY MENU ===== */
    .viz-menu { position: fixed; top: 16px; right: 16px; z-index: 9999; }
    .viz-menu-toggle {
      width: 44px; height: 44px; border-radius: 12px;
      background: var(--surface); border: 1px solid var(--border);
      color: var(--text); cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.2s;
    }
    .viz-menu-toggle:hover { background: var(--surface-hover); }
    .viz-menu-dropdown {
      position: absolute; top: 52px; right: 0; min-width: 200px;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 12px; padding: 8px;
      opacity: 0; visibility: hidden; transform: translateY(-8px);
      transition: opacity 0.2s, visibility 0.2s, transform 0.2s;
    }
    .viz-menu-dropdown.open { opacity: 1; visibility: visible; transform: none; }
    .viz-menu-dropdown button {
      width: 100%; padding: 10px 14px; border: none; border-radius: 8px;
      background: transparent; color: var(--text);
      font: inherit; font-size: 14px; cursor: pointer; text-align: left;
      display: flex; align-items: center; gap: 10px;
    }
    .viz-menu-dropdown button:hover { background: var(--surface-hover); }

    /* ===== SKIP LINK ===== */
    .skip-to-content {
      position: fixed; top: -60px; left: 16px; z-index: 10000;
      background: var(--accent); color: #fff;
      padding: 8px 12px; border-radius: 4px; text-decoration: none;
      transition: top 0.2s;
    }
    .skip-to-content:focus { top: 16px; }

    /* ===== ADD YOUR STYLES BELOW ===== */
  </style>
</head>
<body>
  <a href="#main-content" class="skip-to-content">Skip to content</a>

  <div class="viz-menu">
    <button class="viz-menu-toggle" onclick="toggleMenu()" aria-label="Menu" aria-expanded="false">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <line x1="3" y1="5" x2="17" y2="5"/><line x1="3" y1="10" x2="17" y2="10"/><line x1="3" y1="15" x2="17" y2="15"/>
      </svg>
    </button>
    <div class="viz-menu-dropdown" id="vizMenuDropdown">
      <button onclick="cycleTheme()"><span id="themeIcon">D</span><span id="themeLabel">Dark</span></button>
      <button onclick="downloadImage()"><span>PNG</span><span>Download PNG</span></button>
      <button onclick="window.print()"><span>PDF</span><span>Print / PDF</span></button>
    </div>
  </div>

  <main id="main-content">
    <!-- YOUR CONTENT HERE. Use <section>, <header>, <article> for structure. -->
  </main>

  <script>
    // Use var at top level: functions are referenced from inline handlers
    // that may run before a let/const declaration is evaluated.

    // === Menu ===
    function toggleMenu() {
      var dropdown = document.getElementById('vizMenuDropdown');
      var open = dropdown.classList.toggle('open');
      document.querySelector('.viz-menu-toggle').setAttribute('aria-expanded', String(open));
    }
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.viz-menu')) document.getElementById('vizMenuDropdown').classList.remove('open');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') document.getElementById('vizMenuDropdown').classList.remove('open');
    });

    // === Theme ===
    var savedTheme = null;
    try { savedTheme = localStorage.getItem('viz-theme'); } catch (e) {}
    var currentTheme = savedTheme || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    function applyTheme(t) {
      document.documentElement.className = 'theme-' + t;
      document.getElementById('themeIcon').textContent = t === 'dark' ? 'D' : 'L';
      document.getElementById('themeLabel').textContent = t === 'dark' ? 'Dark' : 'Light';
      try { localStorage.setItem('viz-theme', t); } catch (e) {}
      currentTheme = t;
      if (typeof onThemeChange === 'function') onThemeChange();
    }
    function cycleTheme() { applyTheme(currentTheme === 'dark' ? 'light' : 'dark'); }
    applyTheme(currentTheme);

    // === Scroll reveal — opt in with data-reveal ===
    document.querySelectorAll('[data-reveal]').forEach(function (el) { el.classList.add('reveal'); });
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('visible'); revealObserver.unobserve(e.target); }
      });
    }, { threshold: 0.15 });
    document.querySelectorAll('.reveal').forEach(function (el) { revealObserver.observe(el); });

    // === Number counters — data-count="77" data-suffix="%" ===
    function animateCounters() {
      document.querySelectorAll('[data-count]').forEach(function (el) {
        if (el.dataset.counted) return;
        el.dataset.counted = '1';
        var target = parseFloat(el.dataset.count);
        var prefix = el.dataset.prefix || '', suffix = el.dataset.suffix || '';
        var start = performance.now(), duration = 1200;
        (function tick(now) {
          var p = Math.min((now - start) / duration, 1);
          var eased = 1 - Math.pow(1 - p, 3);
          el.textContent = prefix + Math.round(target * eased).toLocaleString() + suffix;
          if (p < 1) requestAnimationFrame(tick);
        })(start);
      });
    }
    var counterEl = document.querySelector('[data-count]');
    if (counterEl) {
      var counterObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) { animateCounters(); counterObserver.disconnect(); } });
      }, { threshold: 0.3 });
      counterObserver.observe(counterEl);
    }

    // === Download PNG ===
    async function downloadImage() {
      var menu = document.querySelector('.viz-menu');
      menu.style.display = 'none';
      try {
        var url = await htmlToImage.toPng(document.body, { quality: 1, pixelRatio: 2 });
        var a = document.createElement('a');
        a.href = url;
        a.download = document.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.png';
        a.click();
      } catch (err) {
        console.error('Download failed:', err);
      }
      menu.style.display = '';
    }

    // === Define onThemeChange() if charts need to re-render on theme switch ===

    // === YOUR SCRIPTS BELOW ===
  </script>
</body>
</html>
```

## Rules

**Do**

- Keep top-level script variables as `var`.
- Opt into scroll reveal with `data-reveal` rather than hiding content in CSS
  that script must undo — a script error then leaves a blank page.
- Use `<section>`, `<header>`, `<article>` so the outline is real.
- Give every canvas `role="img"` and an `aria-label`.
- Define `onThemeChange()` when charts need theme-aware colours.

**Don't**

- Don't rename the eleven colour properties.
- Don't define a palette only under `@media (prefers-color-scheme: ...)`.
- Don't reach for an animation library; the CSS above covers it.
- Don't let a `localStorage` failure break the page — every access is wrapped.

## Handing it over

Export with `skills/html-to-pdf` (`--mode page`), which honours the `@page`
rule above and can add bookmarks from the headings.
