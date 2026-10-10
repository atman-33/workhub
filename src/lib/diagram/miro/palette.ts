/**
 * workhub colour names to the 24-bit RGB ints Miro's clipboard format holds
 * (T-0720).
 *
 * The values come from `colors.ts`, so a diagram keeps its colours when it
 * moves to Miro: a node carries its colour on its border (its fill stays
 * empty, as on the canvas and in the exports), and a sticky carries a pale
 * tint of its colour as its paper.
 */
import { COLOR_HEX, STICKY_FILL_HEX, type Color } from "../colors";

/** Parses `#rrggbb` into a 24-bit RGB int (`0xRRGGBB`). */
export function hexToMiroRgb(hex: string): number {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  return parseInt(m[1], 16);
}

/** The border (and unfilled-figure accent) colour for a node of `color`. */
export function colorToMiroRgb(color: Color): number {
  return hexToMiroRgb(COLOR_HEX[color]);
}

/** The sticky paper for a sticky of `color`. */
export function stickyToMiroRgb(color: Color): number {
  return hexToMiroRgb(STICKY_FILL_HEX[color]);
}
