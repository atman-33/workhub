---
paths:
  - "src/**/*.tsx"
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
  permission looks like a dead feature. Also, `data-tauri-drag-region` only
  fires when the element directly under the cursor carries the attribute
  (children are dead zones); for a fully draggable header, call
  `startDragging()` from a container-wide `onMouseDown` instead
  (see `src/quick-capture/capture-app.tsx`).
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
