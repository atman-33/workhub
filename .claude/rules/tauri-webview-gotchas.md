---
paths:
  - "src/**/*.tsx"
  - "src-tauri/tauri.conf.json"
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
