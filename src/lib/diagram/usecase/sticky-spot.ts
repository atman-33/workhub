/**
 * Where a new sticky lands on a use case diagram (T-0707).
 *
 * The shared default (`NEW_STICKY_OFFSET`) is to the right of the node and a
 * little below, which is exactly where a person's speech bubble often is: a
 * sticky dropped there would hide the person's actions. A person's sticky goes
 * to the side opposite the bubble instead; every other node keeps the shared
 * default.
 */
import { NEW_STICKY_OFFSET, NEW_STICKY_STAGGER } from "../sticky";
import { STICKY_WIDTH } from "../sticky-layout";
import type { UsecaseLayout } from "./layout";

/** Clear space between the node and the sticky. */
const GAP = 16;
/** A one-line sticky's height, which a sticky above the node has to clear. */
const ONE_LINE = 40;

/**
 * The offset from the node's centre to the sticky's top-left corner, for the
 * `existing`-th sticky on that node (each further one is staggered, away from the node).
 */
export function newStickyOffset(
  layout: UsecaseLayout,
  nodeId: string,
  existing: number,
): { dx: number; dy: number } {
  const node = layout.byId.get(nodeId);
  const bubble = layout.bubbleOf.get(nodeId);
  const sx = existing * NEW_STICKY_STAGGER.dx;
  const sy = existing * NEW_STICKY_STAGGER.dy;
  if (!node || !bubble) return { dx: NEW_STICKY_OFFSET.dx + sx, dy: NEW_STICKY_OFFSET.dy + sy };
  switch (bubble.side) {
    case "right":
      return { dx: -(node.width / 2 + GAP + STICKY_WIDTH) - sx, dy: NEW_STICKY_OFFSET.dy + sy };
    case "left":
      return { dx: node.width / 2 + GAP + sx, dy: NEW_STICKY_OFFSET.dy + sy };
    case "top":
      return { dx: NEW_STICKY_OFFSET.dx + sx, dy: node.height / 2 + GAP + sy };
    case "bottom":
      return { dx: NEW_STICKY_OFFSET.dx + sx, dy: -(node.height / 2 + GAP + ONE_LINE) - sy };
  }
}
