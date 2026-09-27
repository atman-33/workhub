---
paths:
  - "src/**/*.tsx"
  - "src/lib/i18n/**"
---

# UI strings go through `@/lib/i18n`

The UI can be shown in English or Japanese (`ui_locale`, T-0409). The
dictionary is hand-written and typed — no i18next: `src/lib/i18n/messages/en.ts`
is the reference, `ja.ts` is `Partial` against its keys. Each tab keeps its
strings in its own pair, `messages/<area>.en.ts` / `<area>.ja.ts`, spread into
those two files (T-0423); a new area gets a new pair rather than growing
`en.ts`.

- **New user-visible text in a translated area gets a key**, added to `en.ts`
  and `ja.ts` together, rendered with `const t = useT();`. Keys are flat and
  dotted by area (`taskEditor.field.priority`); reuse `common.*` for recurring
  words. Interpolate with `{name}`, never by concatenating translated pieces.
- **Every screen is translated except the Help tab** (`help-view.tsx`, a
  follow-up task). A missing `ja` key falls back to English, so a half-done
  area never renders a blank — which is also why a forgotten key goes
  unnoticed: give every new key its Japanese text in the same change.
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
- Every secondary window's `main.tsx` calls `initWindowLocale(titleKey)`; a
  new window entry point needs it too, or it renders English forever. The
  title key is how the OS window title gets translated: Rust's `.title(...)`
  is only the English initial value, since Rust has no locale.
