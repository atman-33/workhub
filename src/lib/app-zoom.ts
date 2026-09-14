/**
 * App-wide zoom (T-0346): the whole WebView scaled through Tauri's
 * `getCurrentWebview().setZoom()`, the way a browser zooms a page.
 * Pure, so it is tested without a DOM.
 *
 * Unlike the Docs preview's text zoom (`lib/docs/zoom.ts`), this scales
 * everything — including px-sized schedule bars — because the scaling
 * happens in the native WebView, not in CSS.
 */

/** App zoom, as a factor. */
export const APP_ZOOM = { min: 0.5, max: 2, step: 0.1, initial: 1 } as const;

/**
 * localStorage key. Zoom depends on the monitor in front of the user, so it
 * stays machine-local instead of moving into the vault settings.
 */
export const APP_ZOOM_KEY = "app.zoom";

/** Snaps `value` to the step grid and clamps it into range. */
export function normalizeAppZoom(value: number): number {
  if (!Number.isFinite(value)) return APP_ZOOM.initial;
  const { min, max, step } = APP_ZOOM;
  const snapped = Math.round(value / step) * step;
  // Round again to one decimal so 1.1 + 0.1 never becomes 1.2000000000000002.
  const rounded = Math.round(snapped * 10) / 10;
  return Math.min(max, Math.max(min, rounded));
}

/**
 * Moves the app zoom one step up (`direction` 1) or down (-1).
 */
export function stepAppZoom(zoom: number, direction: 1 | -1): number {
  return normalizeAppZoom(zoom + direction * APP_ZOOM.step);
}

/** Reads a remembered app zoom; anything unreadable is the initial zoom. */
export function parseAppZoom(raw: string | null): number {
  if (!raw) return APP_ZOOM.initial;
  return normalizeAppZoom(Number(raw));
}

/** What a zoom shortcut keystroke means, if anything. */
export type ZoomKeyAction = "in" | "out" | "reset";

/**
 * Matches a keydown against the zoom shortcuts (T-0346 fix).
 *
 * `Ctrl+=` / `Ctrl+-` / `Ctrl+0` is the browser convention, but on a JIS
 * keyboard `+` lives on the `;` key: bare `Ctrl+;` is what users actually
 * press, `Ctrl+Shift+;` is the shifted `+`, and with a Japanese IME active
 * the event may further arrive as a full-width variant or just the physical
 * code. So zoom-in matches the Semicolon key in any of those guises, with or
 * without Shift. (On a US layout that claims `Ctrl+;` / `Ctrl+:`, which
 * neither browsers nor this app use.)
 */
export function matchZoomKey(e: { key: string; code: string; shiftKey: boolean }): ZoomKeyAction | null {
  const { key, code, shiftKey } = e;
  if (
    key === "=" ||
    key === "+" ||
    key === ";" ||
    key === "：" ||
    key === "；" ||
    (shiftKey && code === "Semicolon")
  ) {
    return "in";
  }
  if (!shiftKey && (key === "-" || key === "0")) {
    return key === "0" ? "reset" : "out";
  }
  return null;
}

/** True inside the Tauri WebView; a plain-browser dev server skips native calls. */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
