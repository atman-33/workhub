/**
 * UI display language (T-0409).
 *
 * A hand-written, typed dictionary rather than i18next: two languages do not
 * earn a dependency, and the flat `t("key")` call shape keeps a later move to
 * a library a matter of moving files. Deliberately not `Intl` either — that
 * follows the *OS* display language, not the setting
 * (`.claude/rules/tauri-webview-gotchas.md`).
 *
 * Display only: nothing written to a file is ever localized. Frontmatter
 * values (`todo`, `high`, ...) stay English on disk and only their labels are
 * translated.
 *
 * Each window is its own webview with its own copy of this module: every
 * secondary window's entry point calls `initWindowLocale()`, and the main
 * window applies `ui_locale` whenever its settings change.
 */
import { create } from "zustand";
import { api } from "@/lib/api";
import { en, type MessageKey } from "./messages/en";
import { ja } from "./messages/ja";

export type { MessageKey } from "./messages/en";

export type Locale = "en" | "ja";

export const LOCALES: { id: Locale; label: string }[] = [
  { id: "en", label: "English" },
  { id: "ja", label: "日本語" },
];

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "ja";
}

/** A stored value as a usable locale; anything unknown reads as English. */
export function toLocale(value: unknown): Locale {
  return isLocale(value) ? value : "en";
}

export type TranslateVars = Record<string, string | number>;

/**
 * The text for `key` in `locale`, with `{name}` placeholders filled from
 * `vars`. A key missing from the Japanese dictionary falls back to English; a
 * placeholder with no matching var is left as written, so a mistake shows up
 * on screen instead of rendering as an empty gap.
 */
export function translate(locale: Locale, key: MessageKey, vars?: TranslateVars): string {
  const text = (locale === "ja" ? ja[key] : undefined) ?? en[key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: "en",
  setLocale: (locale) => {
    if (typeof document !== "undefined") document.documentElement.lang = locale;
    set({ locale });
  },
}));

/** Applies a stored `ui_locale` value to this window. */
export function applyLocale(value: unknown): void {
  const locale = toLocale(value);
  if (useLocaleStore.getState().locale !== locale) {
    useLocaleStore.getState().setLocale(locale);
  }
}

/** Reads the configured locale and applies it; for window entry points. A
 * config that cannot be read leaves the window in English. */
export async function loadLocale(): Promise<void> {
  try {
    applyLocale((await api.getConfig()).settings.ui_locale);
  } catch {
    // English is always a complete UI.
  }
}

/** Entry-point setup for a secondary window: load the locale now and again
 * whenever the window regains focus. Several of these windows are hidden and
 * re-shown rather than recreated, so a load at startup alone would keep the
 * language they were first opened in. */
export function initWindowLocale(): void {
  void loadLocale();
  window.addEventListener("focus", () => void loadLocale());
}

/** The current locale; re-renders the caller when it changes. */
export function useLocale(): Locale {
  return useLocaleStore((s) => s.locale);
}

/** A `t(key, vars?)` bound to the current locale; re-renders on change. */
export function useT(): (key: MessageKey, vars?: TranslateVars) => string {
  const locale = useLocale();
  return (key, vars) => translate(locale, key, vars);
}

/** `t()` outside React (module-level helpers, toasts built in callbacks). */
export function t(key: MessageKey, vars?: TranslateVars): string {
  return translate(useLocaleStore.getState().locale, key, vars);
}
