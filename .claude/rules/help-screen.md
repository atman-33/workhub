---
paths:
  - "src/components/help-view.tsx"
  - "src/components/settings-dialog.tsx"
  - "src-tauri/src/ink/**"
  - "src-tauri/src/quick_capture.rs"
---

# Keep the in-app Help screen in sync

`src/components/help-view.tsx` renders the **Help** tab — a user-facing guide
to setup and the non-obvious operations (screen annotation / ink, quick
capture, first-run vault setup). Because these behaviors are not discoverable
from the UI alone, the guide is the only place a user learns them.

**When you change any of the following, update the matching section of
`help-view.tsx` in the same change:**

- ink gesture or shortcuts (`src-tauri/src/ink/`) — the double-press Alt hold,
  `Alt+S` color cycle, release-to-clear behavior, or its Settings toggle.
- quick capture (`src-tauri/src/quick_capture.rs`) — the default/fallback
  hotkey, the capture flow, or its Settings shortcut field.
- first-run setup or Settings fields a user must configure (vault path, plugin
  install, repo registration).

When you add a **new** user-facing operation or setup step that a user cannot
discover from the UI, add a new section to `help-view.tsx` too — don't just
ship the feature.
