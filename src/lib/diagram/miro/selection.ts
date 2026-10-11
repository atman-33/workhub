/**
 * Restricting a Miro scene to a node selection (T-0725 part B).
 *
 * Every diagram kind with multi-select shares this one pure helper: the
 * whole-diagram adapters (`adapters/`) stay untouched, so their output is
 * byte-identical, and the right-click "Copy to Miro" filters the scene they
 * produced down to the selected nodes before writing it to the clipboard.
 *
 * Filtering the scene - rather than the layout fed to an adapter - is the
 * cleanest layer because every adapter already keys its shapes by the diagram
 * node/item id and its connectors by those same keys:
 *
 * - shapes survive when their key is selected;
 * - connectors survive only when both ends are selected (an arrow to an
 *   unselected node is dropped - Miro would otherwise bind it to nothing);
 * - stickers survive only when their key is selected. Layout sticky notes are
 *   independent positioned notes (design section 7), not attached children,
 *   and the scene no longer carries their target id - so they are left out.
 *   A 2x2 matrix item with a colour is a Miro sticker keyed by the *item* id,
 *   so a selected coloured item survives exactly like a selected rectangle;
 * - free texts and free-floating lines are diagram chrome (matrix axes, axis
 *   and quadrant labels) rather than nodes, so they are always left out -
 *   except a background label (`<rectKey>:label`, see `adapters/flow.ts` and
 *   `adapters/architecture.ts`), which survives with its rectangle so the
 *   kept rectangle keeps its name;
 * - frames survive only when at least one kept shape names them (a frame with
 *   no selected member is dropped); a kept shape whose frame was dropped is
 *   defensively lifted to top level so the encoder never sees a dangling
 *   parent, and every kept frame keeps its full geometry (not shrunk to its
 *   selected members);
 * - background rectangles (flow lanes since T-0733, architecture frames since
 *   T-0735) are independent shapes, not frames, but get the same keep rule
 *   through the member's `lane` link: a rectangle survives only when at least
 *   one kept member names it (one with no selected member is dropped). Like
 *   frames, rectangles keep their full geometry and stay out of the bounding
 *   box: a rectangle is typically larger than the selected members inside it,
 *   and centring on it would push the selection off-centre. Rectangles paste
 *   before the members (behind them), as the adapter ordered them.
 *
 * The kept elements are then recentred so their bounding-box centre lands on
 * the origin - the same convention the adapters use for the whole diagram -
 * keeping every relative offset intact. Frames and background rectangles are
 * shifted with the selection but excluded from the bounding box, as documented
 * above.
 *
 * An empty selection is a no-op: the input scene is returned unchanged.
 */

import type { MiroScene } from "./model";

/** Suffix of a background label's scene key on its rectangle's key:
 * `<rectKey>` plus this names the free text at the rectangle's top-left
 * (`adapters/flow.ts` and `adapters/architecture.ts` own the convention; it
 * is mirrored here so the shared helper needs no adapter import). */
const GROUP_LABEL_SUFFIX = ":label";

/** A Miro scene holding nothing, for selections that keep no node. */
function emptyFilteredScene(): MiroScene {
  return { shapes: [], stickers: [], texts: [], frames: [], connectors: [] };
}

export function filterMiroSceneForSelection(
  scene: MiroScene,
  selected: ReadonlySet<string> | readonly string[],
): MiroScene {
  const sel: ReadonlySet<string> = selected instanceof Set ? selected : new Set(selected);
  // An empty selection copies nothing in particular: leave the scene alone.
  if (sel.size === 0) return scene;

  const selectedShapes = scene.shapes.filter((s) => sel.has(s.key));
  // Background rectangles their members name, even though the rectangles
  // themselves are never selected (only diagram nodes are). A selected shape
  // that shares a background rectangle's key counts as background, not as a
  // node.
  const keptGroupKeys = new Set<string>();
  for (const shape of selectedShapes) {
    if (shape.lane !== undefined) keptGroupKeys.add(shape.lane);
  }
  const backgrounds = scene.shapes.filter((s) => keptGroupKeys.has(s.key));
  const backgroundKeys = new Set(backgrounds.map((l) => l.key));
  const shapes = selectedShapes.filter((s) => !backgroundKeys.has(s.key));
  const stickers = scene.stickers.filter((s) => sel.has(s.key));
  const connectors = scene.connectors.filter((c) => sel.has(c.from.key) && sel.has(c.to.key));

  const keptFrameKeys = new Set<string>();
  for (const shape of shapes) {
    if (shape.frame !== undefined) keptFrameKeys.add(shape.frame);
  }
  const frames = scene.frames.filter((f) => keptFrameKeys.has(f.key));
  // Defensive: a kept shape must never point at a dropped frame. By
  // construction every kept shape's frame is kept, so this only lifts shapes
  // whose frame key never existed in the scene at all.
  const relinked = shapes.map((shape) =>
    shape.frame !== undefined && !keptFrameKeys.has(shape.frame)
      ? { ...shape, frame: undefined }
      : shape,
  );
  // A surviving rectangle's label goes with it; every other free text stays
  // dropped, as before.
  const texts = scene.texts.filter(
    (t) =>
      t.key.endsWith(GROUP_LABEL_SUFFIX) &&
      keptGroupKeys.has(t.key.slice(0, -GROUP_LABEL_SUFFIX.length)),
  );

  if (relinked.length === 0 && stickers.length === 0) return emptyFilteredScene();

  // Bounding box of the selection: shape extents plus sticker centres (a
  // sticker's Miro size is fixed, while its layout size is gone - its centre
  // is the honest remainder). Frames and background rectangles stay out, as
  // documented above.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const shape of relinked) {
    minX = Math.min(minX, shape.cx - shape.width / 2);
    minY = Math.min(minY, shape.cy - shape.height / 2);
    maxX = Math.max(maxX, shape.cx + shape.width / 2);
    maxY = Math.max(maxY, shape.cy + shape.height / 2);
  }
  for (const sticker of stickers) {
    minX = Math.min(minX, sticker.cx);
    minY = Math.min(minY, sticker.cy);
    maxX = Math.max(maxX, sticker.cx);
    maxY = Math.max(maxY, sticker.cy);
  }
  const centreX = (minX + maxX) / 2;
  const centreY = (minY + maxY) / 2;
  if (!Number.isFinite(centreX) || !Number.isFinite(centreY)) {
    return { shapes: [...backgrounds, ...relinked], stickers, texts, frames, connectors };
  }

  const shiftX = (x: number) => x - centreX;
  const shiftY = (y: number) => y - centreY;
  return {
    // Backgrounds first, so they paste behind the members, as the adapter ordered them.
    shapes: [...backgrounds, ...relinked].map((s) => ({ ...s, cx: shiftX(s.cx), cy: shiftY(s.cy) })),
    stickers: stickers.map((s) => ({ ...s, cx: shiftX(s.cx), cy: shiftY(s.cy) })),
    texts: texts.map((t) => ({ ...t, cx: shiftX(t.cx), cy: shiftY(t.cy) })),
    frames: frames.map((f) => ({ ...f, cx: shiftX(f.cx), cy: shiftY(f.cy) })),
    connectors: connectors.map((c) => ({ ...c })),
  };
}
