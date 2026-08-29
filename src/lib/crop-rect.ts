// Pure geometry for the crop selection drawn over an ink capture preview
// (the ink-preview window). Everything is expressed in *displayed* pixels of
// the image; callers convert to natural pixels when exporting a crop.

/** Drags shorter than this are a click that missed, not a selection. */
export const MIN_DRAG = 6;
/** Grab area of a resize handle, in displayed pixels. */
export const HANDLE = 10;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Grip = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "move";

export function normalize(rect: Rect): Rect {
  return {
    x: rect.w < 0 ? rect.x + rect.w : rect.x,
    y: rect.h < 0 ? rect.y + rect.h : rect.y,
    w: Math.abs(rect.w),
    h: Math.abs(rect.h),
  };
}

export function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(value, max));
}

/** Which part of the selection the pointer is on, if any. */
export function gripAt(rect: Rect, x: number, y: number): Grip | null {
  const nearLeft = Math.abs(x - rect.x) <= HANDLE;
  const nearRight = Math.abs(x - (rect.x + rect.w)) <= HANDLE;
  const nearTop = Math.abs(y - rect.y) <= HANDLE;
  const nearBottom = Math.abs(y - (rect.y + rect.h)) <= HANDLE;
  const insideX = x >= rect.x - HANDLE && x <= rect.x + rect.w + HANDLE;
  const insideY = y >= rect.y - HANDLE && y <= rect.y + rect.h + HANDLE;
  if (!insideX || !insideY) return null;
  if (nearTop && nearLeft) return "nw";
  if (nearTop && nearRight) return "ne";
  if (nearBottom && nearLeft) return "sw";
  if (nearBottom && nearRight) return "se";
  if (nearTop) return "n";
  if (nearBottom) return "s";
  if (nearLeft) return "w";
  if (nearRight) return "e";
  if (x > rect.x && x < rect.x + rect.w && y > rect.y && y < rect.y + rect.h) return "move";
  return null;
}

export const CURSORS: Record<Grip, string> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
  move: "move",
};

/** Applies a drag of (dx, dy) on `grip` to the rectangle it started from. */
export function resize(start: Rect, grip: Grip, dx: number, dy: number, max: Rect): Rect {
  if (grip === "move") {
    return {
      ...start,
      x: clamp(start.x + dx, max.w - start.w),
      y: clamp(start.y + dy, max.h - start.h),
    };
  }
  let { x, y, w, h } = start;
  if (grip.includes("w")) {
    const nx = clamp(x + dx, max.w);
    w += x - nx;
    x = nx;
  }
  if (grip.includes("e")) w = clamp(w + dx, max.w - x);
  if (grip.includes("n")) {
    const ny = clamp(y + dy, max.h);
    h += y - ny;
    y = ny;
  }
  if (grip.includes("s")) h = clamp(h + dy, max.h - y);
  return normalize({ x, y, w, h });
}
