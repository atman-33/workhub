/**
 * Zoom arithmetic for the Docs tab (T-0279): the preview's text zoom and the
 * figure viewer's pan/zoom. Pure, so it is tested without a DOM.
 */

/** Text zoom of the preview, as a factor. */
export const PREVIEW_ZOOM = { min: 0.7, max: 2, step: 0.1, initial: 1 } as const;

/** Figure viewer zoom, as a factor. Wide enough to read a large diagram's labels. */
export const FIGURE_ZOOM = { min: 0.1, max: 8 } as const;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Moves the preview zoom one step up (`direction` 1) or down (-1), snapped to
 * the step grid so repeated steps never drift into 0.7999….
 */
export function stepPreviewZoom(zoom: number, direction: 1 | -1): number {
  const { min, max, step } = PREVIEW_ZOOM;
  const next = Math.round((zoom + direction * step) * 10) / 10;
  return clamp(next, min, max);
}

/** Reads a remembered preview zoom; anything unreadable is the initial zoom. */
export function parsePreviewZoom(raw: string | null): number {
  const value = Number(raw);
  if (!raw || !Number.isFinite(value)) return PREVIEW_ZOOM.initial;
  return clamp(Math.round(value * 10) / 10, PREVIEW_ZOOM.min, PREVIEW_ZOOM.max);
}

/** Where a figure sits in its viewport: scaled by `scale`, then shifted by `x`/`y` pixels. */
export interface View {
  scale: number;
  x: number;
  y: number;
}

/**
 * Zooms `view` by `factor` keeping the point under (`px`, `py`) — viewport
 * coordinates — fixed on screen, the way a map zooms under the cursor.
 */
export function zoomAround(view: View, factor: number, px: number, py: number): View {
  const scale = clamp(view.scale * factor, FIGURE_ZOOM.min, FIGURE_ZOOM.max);
  const applied = scale / view.scale;
  return {
    scale,
    x: px - (px - view.x) * applied,
    y: py - (py - view.y) * applied,
  };
}

/**
 * The view that shows a `width` × `height` figure whole and centred in a
 * `vw` × `vh` viewport, with `padding` pixels to spare on each side. Never
 * enlarges past 100%: a small figure is shown at its own size, not blown up.
 */
export function fitView(
  width: number,
  height: number,
  vw: number,
  vh: number,
  padding = 24,
): View {
  if (width <= 0 || height <= 0 || vw <= 0 || vh <= 0) return { scale: 1, x: 0, y: 0 };
  const scale = clamp(
    Math.min((vw - padding * 2) / width, (vh - padding * 2) / height, 1),
    FIGURE_ZOOM.min,
    FIGURE_ZOOM.max,
  );
  return { scale, x: (vw - width * scale) / 2, y: (vh - height * scale) / 2 };
}

/** The view that shows the figure at 100%, centred. */
export function actualSizeView(width: number, height: number, vw: number, vh: number): View {
  return { scale: 1, x: (vw - width) / 2, y: (vh - height) / 2 };
}
