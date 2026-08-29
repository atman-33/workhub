---
paths:
  - "src/**/*.tsx"
  - "index.html"
  - "src/index.css"
  - "src-tauri/tauri.conf.json"
  - "src-tauri/capabilities/**"
---

# Tauri WebView gotchas

- **HTML5 drag & drop requires `"dragDropEnabled": false`** on the window in
  `tauri.conf.json`. Tauri's native drag-drop handler (for OS file drops) is
  on by default and swallows the WebView's HTML5 drag events — draggable
  elements show a "blocked" cursor. workhub disables it (kanban card DnD);
  as a consequence, OS file drops onto the window emit no Tauri events. If a
  file-drop feature is ever needed, implement it without re-enabling this
  flag (e.g. a file picker), or the kanban breaks.
- The app is dark-only: `<html class="dark">` is hardcoded in `index.html`
  and `.dark` sets `color-scheme: dark` so native controls (select
  dropdowns, scrollbars) render dark. Keep both in sync if theming changes.
- **Window dragging needs an explicit ACL grant**: `start_dragging` is NOT
  part of `core:default`, so both JS `startDragging()` and the
  `data-tauri-drag-region` attribute (which issues the same IPC command)
  fail unless `core:window:allow-start-dragging` is listed in
  `src-tauri/capabilities/default.json`. ACL rejections are **silent** —
  don't discard the promise (`.catch(console.error)`), or a missing
  permission looks like a dead feature.
- **For an undecorated window's title bar, use
  `data-tauri-drag-region="deep"` — not a hand-written `onMouseDown`.**
  Calling `startDragging()` yourself gets dragging and nothing else:
  the OS takes over the gesture on the first `mousedown`, so the `mouseup`
  never reaches the WebView, no `click` completes, and **`onDoubleClick` can
  never fire** — double-click-to-maximize is silently impossible that way.
  Tauri's injected handler (`tauri/src/window/scripts/drag.js`) dodges this by
  branching on `e.detail === 2` *inside* mousedown, and hands you, for free:
  - double-click to toggle maximize, via `internal_toggle_maximize`, which
    **is** in `core:window:default` — no extra grant (`allow-toggle-maximize`
    is for the unrelated JS `toggleMaximize()` API);
  - automatic exclusion of `BUTTON` / `A` / `INPUT` / `SELECT` / `TEXTAREA` /
    `LABEL` / `SUMMARY`, anything `contenteditable`, anything with a real
    `tabindex`, and interactive ARIA roles — so header buttons keep their
    clicks with no guard of your own;
  - the macOS difference (maximize on `mouseup`, cancelled if the pointer
    moved) and the drag-region-edge bug (tauri#2549).

  `"deep"` makes the whole subtree draggable; a bare `data-tauri-drag-region`
  is self-only, which is what makes children dead zones. `"false"` opts a
  subtree out. `src/components/task-editor-form.tsx` is the worked example.
  The four older helper windows (`quick-capture`, `ink-preview`, `clips-popup`,
  `voice-indicator`) still hand-roll `onMouseDown` from before `"deep"`
  existed; their comments claiming children are unavoidably dead zones are
  stale. They work, but copy the task editor, not them.
- **Never use native `<input type="date">` / `type="datetime-local">` / `type="time">`.**
  Their popups render in the **Windows display language**, not the page's — a
  Japanese machine shows a Japanese calendar and Japanese Clear/Today buttons
  inside this otherwise English UI. `<html lang="en">` does **not** override
  this (it is already set, and the popup ignores it), and the popup is browser
  chrome: it cannot be relabeled, restyled, or partially localized from the
  page. So "keep the calendar OS-locale but force the buttons English" is not
  buildable — it is all-or-nothing.
  Use the app's own controls instead: `src/components/ui/date-picker.tsx`
  (date only) or `src/components/ui/date-time-picker.tsx` (date + time, with
  English Clear/Today buttons). The shared date arithmetic behind the latter
  lives in `src/lib/date-time.ts` and is unit-tested.
  The same trap applies to `Date#toLocaleString()` / `toLocaleDateString()`
  in UI strings — pass an explicit `"en-US"` `Intl.DateTimeFormat`.
- **Never size the window shell with `100vh`.** WebView2 can report a viewport
  a few pixels shorter than `100vh`, so a `h-screen` shell overhangs the window
  and leaves a scrollbar down its side on *every* tab. Chromium reports the two
  as equal, so this does not reproduce in a browser against the same dev server
  — only in the app. `index.html` gives `html`/`body`/`#root` a real
  `height: 100%` (plus `body { overflow: hidden }`, since every tab scrolls its
  own content), and the shell in `src/app.tsx` fills it with `h-full`. Those
  styles live in `index.html`'s inline block on purpose: it is the main
  window's own document, so the quick-capture, clips and voice-indicator
  popups — which share `src/index.css` — are unaffected.
