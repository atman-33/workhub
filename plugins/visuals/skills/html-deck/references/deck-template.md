# Deck template

The architecture every generated deck follows: one self-contained HTML file,
all CSS and JS inline, slides authored at 1920x1080 inside a stage that scales
as a whole.

Source: [frontend-slides](https://github.com/zarazhangrui/frontend-slides), with
the navigation controller written out in full. See the plugin's `NOTICE.md`.

## Structure

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Deck title</title>

  <!-- Display + body faces from the chosen preset. Never a system font.
       Add Noto Sans JP (or the language's face) when the deck is not Latin. -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=...&display=swap">

  <style>
    /* === THEME ===============================================
       Every value is authored at 1920x1080 stage size, in px.
       The stage scales; the numbers do not. */
    :root {
      --bg-primary: #0a0f1c;
      --bg-secondary: #111827;
      --text-primary: #ffffff;
      --text-secondary: #9ca3af;
      --accent: #00ffcc;

      --stage-bg: #000;         /* letterbox bars */
      --slide-bg: var(--bg-primary);

      --font-display: 'Display Face', sans-serif;
      --font-body: 'Body Face', sans-serif;

      --title-size: 112px;
      --subtitle-size: 34px;
      --body-size: 28px;        /* never below 24px */

      --slide-padding: 72px;
      --content-gap: 32px;

      --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
      --duration-normal: 0.6s;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    /* === PASTE THE ENTIRE CONTENTS OF assets/viewport-base.css HERE === */

    /* === ENTRANCE ============================================ */
    .reveal {
      opacity: 0;
      transform: translateY(30px);
      transition: opacity var(--duration-normal) var(--ease-out-expo),
                  transform var(--duration-normal) var(--ease-out-expo);
    }
    .slide.visible .reveal { opacity: 1; transform: none; }
    .reveal:nth-child(1) { transition-delay: 0.1s; }
    .reveal:nth-child(2) { transition-delay: 0.2s; }
    .reveal:nth-child(3) { transition-delay: 0.3s; }
    .reveal:nth-child(4) { transition-delay: 0.4s; }

    /* === SLIDE LAYOUTS ======================================= */
    /* One commented block per layout: title, section, content,
       comparison, quote, closing. */
  </style>
</head>
<body>
  <div class="deck-viewport">
    <main class="deck-stage" id="deckStage">

      <section class="slide title-slide active visible">
        <h1 class="reveal">Deck title</h1>
        <p class="reveal">Subtitle, author, date</p>
      </section>

      <section class="slide">
        <div class="slide-content">
          <h2 class="reveal">Slide title</h2>
          <p class="reveal">One idea, stated once.</p>
        </div>
      </section>

    </main>
  </div>

  <div class="deck-controls" aria-hidden="true">
    <span id="slideCounter">1 / 1</span>
  </div>

  <script>
    /* === SLIDE CONTROLLER ==================================== */
    class SlidePresentation {
      constructor() {
        this.slides = Array.from(document.querySelectorAll('.slide'));
        this.stage = document.getElementById('deckStage');
        this.counter = document.getElementById('slideCounter');
        this.current = 0;
        this.setupStageScale();
        this.setupKeyboard();
        this.setupPointer();
        this.showSlide(0);
      }

      // The whole 1920x1080 stage is scaled by one transform and centred.
      // Slide content is never re-laid out for the device.
      setupStageScale() {
        const apply = () => {
          const factor = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
          const x = (window.innerWidth - 1920 * factor) / 2;
          const y = (window.innerHeight - 1080 * factor) / 2;
          this.stage.style.transform = `translate(${x}px, ${y}px) scale(${factor})`;
        };
        apply();
        window.addEventListener('resize', apply);
      }

      setupKeyboard() {
        window.addEventListener('keydown', (e) => {
          switch (e.key) {
            case 'ArrowRight': case 'ArrowDown': case ' ': case 'PageDown':
              e.preventDefault(); this.next(); break;
            case 'ArrowLeft': case 'ArrowUp': case 'PageUp':
              e.preventDefault(); this.prev(); break;
            case 'Home': e.preventDefault(); this.showSlide(0); break;
            case 'End': e.preventDefault(); this.showSlide(this.slides.length - 1); break;
          }
        });
      }

      setupPointer() {
        let startX = 0;
        window.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
        window.addEventListener('touchend', (e) => {
          const dx = e.changedTouches[0].clientX - startX;
          if (Math.abs(dx) > 60) (dx < 0 ? this.next() : this.prev());
        }, { passive: true });

        let wheelLock = false;
        window.addEventListener('wheel', (e) => {
          if (wheelLock || Math.abs(e.deltaY) < 20) return;
          wheelLock = true;
          setTimeout(() => { wheelLock = false; }, 500);
          (e.deltaY > 0 ? this.next() : this.prev());
        }, { passive: true });
      }

      next() { this.showSlide(this.current + 1); }
      prev() { this.showSlide(this.current - 1); }

      // Visibility only. Setting display here would be overridden by layout
      // rules such as .slide-content { display: flex } and every slide would
      // paint at once.
      showSlide(index) {
        this.current = Math.max(0, Math.min(index, this.slides.length - 1));
        this.slides.forEach((slide, i) => {
          const on = i === this.current;
          slide.classList.toggle('active', on);
          slide.classList.toggle('visible', on);
        });
        if (this.counter) this.counter.textContent = `${this.current + 1} / ${this.slides.length}`;
      }
    }

    // Exposed so the PDF exporter can drive the deck directly.
    window.presentation = new SlidePresentation();
  </script>
</body>
</html>
```

## Required behaviour

1. **Stage scaling** — one transform on `.deck-stage`, recomputed on resize.
   Letterbox or pillarbox as needed; never reflow.
2. **Keyboard** — arrows, space, Page Up/Down, Home, End.
3. **Pointer** — swipe on touch, wheel with a lock so one gesture moves one
   slide.
4. **A slide counter** outside the stage, in `.deck-controls`.
5. **`window.presentation`** assigned, so `html-to-pdf --mode slides` can call
   `showSlide()`.

## Optional, matched to the style

Custom cursor, canvas particles, parallax, 3D tilt on hover, counter
animations. Add at most one per deck; two compete.

## Images

Reference images by relative path from the HTML — not base64, which bloats the
file, and not an absolute filesystem path, which breaks both the browser and
the exporter.

```html
<img src="assets/screenshot.png" alt="What it shows" class="slide-image">
```

```css
.slide-image { max-width: 100%; max-height: 100%; object-fit: contain; }
```

Resize anything over 1MB before embedding. Never repeat an image across
slides, except a logo on the title and closing slides.

## Comments

Every section of the stylesheet gets a `/* === NAME === */` banner, and the
theme block gets a line saying what to change to restyle the deck. The user
edits this file by hand afterwards; it has to be readable.
