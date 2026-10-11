/**
 * What the Miro adapters share (T-0721).
 *
 * The PFD adapter (T-0720) grew these helpers first; the algorithm, use case
 * and IFDAM adapters need the same ones, so they live here now. The PFD
 * adapter imports them from here - its behaviour is unchanged.
 */

import type { Box } from "../../sticky-layout";

/** Pixel scale of a Miro scene against the layout. 1 keeps layout pixels;
 * tune when the pasted board is seen. */
export const MIRO_SCALE = 1;

export interface MiroAdapterOptions {
  scale?: number;
}

export function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Where a boundary point sits inside its node's box, as 0..1 Miro `point`. */
export function relativePoint(
  box: Box,
  p: { x: number; y: number },
): { x: number; y: number } {
  const x = box.width === 0 ? 0.5 : (p.x - box.x) / box.width;
  const y = box.height === 0 ? 0.5 : (p.y - box.y) / box.height;
  return { x: clamp01(x), y: clamp01(y) };
}
