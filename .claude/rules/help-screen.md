---
paths:
  - "src/components/help-view.tsx"
  - "src/lib/i18n/help/**"
  - "src/components/settings-dialog.tsx"
  - "src-tauri/src/ink/**"
  - "src-tauri/src/quick_capture.rs"
---

# Keep the in-app Help screen in sync

`src/components/help-view.tsx` renders the **Help** tab — a user-facing guide
to setup and the non-obvious operations (screen annotation / ink, quick
capture, first-run vault setup). Because these behaviors are not discoverable
from the UI alone, the guide is the only place a user learns them.

**The guide's text is Markdown in `src/lib/i18n/help/`** — `help.en.ts` and
`help.ja.ts`, one section per id in `types.ts` (T-0428). The same Markdown is
rendered in the tab and put on the clipboard by its copy buttons, so there is
exactly one text per language; `help-view.tsx` holds no prose. Edit a section
in **both** files in the same change, keeping the Japanese bullet-for-bullet
with the English — `help.test.ts` fails when their list items, numbered steps
or code blocks stop lining up. Write button and setting names in the Japanese
file the way the Japanese UI shows them (the `ja` dictionary), since that is
what the reader looks for on screen.

**When you change any of the following, update the matching section in the
same change:**

- ink gesture or shortcuts (`src-tauri/src/ink/`) — the double-press Alt hold,
  `Alt+S` color cycle, release-to-clear behavior, or its Settings toggle.
- the clips picker (`src-tauri/src/clips/`) — the double-tap gesture, the
  popup's keys, or where snippets are stored.
- quick capture (`src-tauri/src/quick_capture.rs`) — the default/fallback
  hotkey, the capture flow, or its Settings shortcut field.
- first-run setup or Settings fields a user must configure (vault path, plugin
  install, repo registration).

When you add a **new** user-facing operation or setup step that a user cannot
discover from the UI, add a new section too — its id in `types.ts`, an icon in
`help-view.tsx`, and its text in both language files. Don't just ship the
feature.
