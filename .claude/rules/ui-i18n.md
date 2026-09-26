---
paths:
  - "src/**/*.tsx"
  - "src/lib/i18n/**"
---

# UI strings go through `@/lib/i18n`

The UI can be shown in English or Japanese (`ui_locale`, T-0409). The
dictionary is hand-written and typed — no i18next: `src/lib/i18n/messages/en.ts`
is the reference, `ja.ts` is `Partial` against its keys.

- **New user-visible text in a translated area gets a key**, added to `en.ts`
  and `ja.ts` together, rendered with `const t = useT();`. Keys are flat and
  dotted by area (`taskEditor.field.priority`); reuse `common.*` for recurring
  words. Interpolate with `{name}`, never by concatenating translated pieces.
- **Areas not yet translated stay literal English** until their own task
  converts them. A missing `ja` key falls back to English, so a half-done area
  never renders a blank. Translated so far: app shell and banners, Tasks tab,
  task editor, quick capture, Settings dialog, and the schedule calendar's
  date labels (`src/lib/schedule/i18n.ts`, which reads the same locale).
- **Display only.** Values written to files or sent to the backend stay
  English — frontmatter (`todo`, `high`, `claude-code`), setting ids, and the
  `## Description` / `## Plan` / `## Results` headings. Translate their labels
  through a lookup such as `src/lib/i18n/labels.ts`. Agent launch prompts,
  product names and Rust-side error messages are not translated.
- **Inside a callback that outlives a render** (`useCallback` with stale deps,
  event listeners, toasts built later), call the non-hook `t()` — it reads the
  current locale when called. The hook's `t` is bound to the render it came
  from.
- **Never `Intl` / `toLocaleString` for UI text**: they follow the OS display
  language, not the setting.
- Every secondary window's `main.tsx` calls `initWindowLocale()`; a new window
  entry point needs it too, or it renders English forever.
