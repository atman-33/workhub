/**
 * Color theme (T-0661): light, dark, or follow the OS.
 *
 * The preference lives in localStorage like the app zoom: it describes how
 * this machine's screen is set up, so it stays out of the vault settings.
 * `public/theme-boot.js` repeats `resolveTheme` before first paint; keep the
 * key and the rule in sync with it.
 */

import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_KEY = "app.theme";

/** Matches the look before the setting existed. */
export const DEFAULT_THEME: ThemePreference = "dark";

export const THEME_PREFERENCES: ThemePreference[] = ["light", "dark", "system"];

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/** A remembered preference; anything unreadable is the default. */
export function parseTheme(raw: string | null): ThemePreference {
  return isThemePreference(raw) ? raw : DEFAULT_THEME;
}

/** The theme to paint for `preference`, given whether the OS prefers dark. */
export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === "system") return systemDark ? "dark" : "light";
  return preference;
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function readThemePreference(): ThemePreference {
  try {
    return parseTheme(localStorage.getItem(THEME_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

/** Paints `preference` on the document: the `dark` class and `color-scheme`. */
export function applyTheme(preference: ThemePreference): void {
  const resolved = resolveTheme(preference, window.matchMedia(DARK_QUERY).matches);
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  // Native title bar; `null` hands it back to the OS for `system`.
  if (isTauri()) {
    void getCurrentWindow()
      .setTheme(preference === "system" ? null : resolved)
      .catch(() => {});
  }
}

/** Stores and applies a new preference; the other windows follow via `storage`. */
export function setThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_KEY, preference);
  } catch {
    // Persistence is a nicety; never break switching over storage.
  }
  applyTheme(preference);
}

/**
 * Applies the stored theme and keeps it current: when the preference changes
 * in another window, and when the OS flips while the preference is `system`.
 * Call once per window entry point.
 */
export function initTheme(): void {
  applyTheme(readThemePreference());
  window.addEventListener("storage", (e) => {
    if (e.key === THEME_KEY) applyTheme(readThemePreference());
  });
  window.matchMedia(DARK_QUERY).addEventListener("change", () => {
    applyTheme(readThemePreference());
  });
}
