/**
 * Where a new sticky lands on an architecture diagram (T-0711).
 *
 * The shared default (`NEW_STICKY_OFFSET`) is to the right of the target and a
 * little below, which is fine for a block. A frame is a large rectangle whose
 * middle is its centre, so the shared default would bury a sticky in its
 * members: a frame's sticky goes outside its upper right instead. Each further
 * sticky on the same target is staggered away from it.
 */
import { NEW_STICKY_OFFSET, NEW_STICKY_STAGGER } from "../sticky";
import type { ArchitectureLayout } from "./layout";

/** Clear space between a frame and its sticky. */
const GAP = 16;
/** A one-line sticky's height, which a sticky above the frame has to clear. */
const ONE_LINE = 40;

/**
 * The offset from the target's centre to the sticky's top-left corner, for the
 * `existing`-th sticky on that target.
 */
export function newStickyOffset(
  layout: ArchitectureLayout,
  targetId: string,
  existing: number,
): { dx: number; dy: number } {
  const sx = existing * NEW_STICKY_STAGGER.dx;
  const sy = existing * NEW_STICKY_STAGGER.dy;
  const frame = layout.frameById.get(targetId);
  if (!frame) return { dx: NEW_STICKY_OFFSET.dx + sx, dy: NEW_STICKY_OFFSET.dy + sy };
  return {
    dx: frame.width / 2 + GAP + sx,
    dy: -(frame.height / 2 + GAP + ONE_LINE) - sy,
  };
}
