/**
 * The shape registry: what a node looks like and where its edge is (T-0682).
 *
 * A shape is described by one question - "is this point inside?" - plus the
 * SVG element that draws its outline. Arrow endpoints are found from the
 * question (`boundaryPoint` bisects along a line), so a new shape costs one
 * `contains` and one `outline` and every arrow already knows how to meet it:
 * rectangles, rounded boxes, diamonds and ellipses are all the same code path,
 * and the document shape of the PFD (T-0683) will be too.
 *
 * Adding a shape: build a `ShapeDef` and `registerShape` it. Nothing else in
 * the arrow, layout or export code names a particular shape.
 */
import type { Box } from "./sticky-layout";

export interface ShapeSize {
  width: number;
  height: number;
}

/** An SVG element, as data, so the canvas (React) and the export (a string)
 * draw the same outline from the same numbers. */
export interface ShapeElement {
  tag: "rect" | "ellipse" | "polygon" | "path";
  attrs: Record<string, string | number>;
}

export interface ShapeDef {
  id: string;
  /**
   * True when the point (`dx`, `dy`, relative to the shape's centre) is inside
   * a shape of this `size`. Must hold at (0, 0); the shape should be
   * star-shaped about its centre, which every box, diamond and ellipse is and
   * a document with a wavy bottom edge still is.
   */
  contains(dx: number, dy: number, size: ShapeSize): boolean;
  /** The outline, in diagram coordinates, for a node occupying `box`. */
  outline(box: Box): ShapeElement;
}

/** Corner radius of the `rounded` shape. */
export const ROUNDED_RADIUS = 8;

function roundedContains(dx: number, dy: number, size: ShapeSize, radius: number): boolean {
  const hw = size.width / 2;
  const hh = size.height / 2;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax > hw || ay > hh) return false;
  const r = Math.min(radius, hw, hh);
  const qx = ax - (hw - r);
  const qy = ay - (hh - r);
  if (qx <= 0 || qy <= 0) return true;
  return qx * qx + qy * qy <= r * r;
}

function rectElement(box: Box, radius: number): ShapeElement {
  const r = Math.min(radius, box.width / 2, box.height / 2);
  return {
    tag: "rect",
    attrs: { x: box.x, y: box.y, width: box.width, height: box.height, rx: r, ry: r },
  };
}

const rect: ShapeDef = {
  id: "rect",
  contains: (dx, dy, s) => Math.abs(dx) <= s.width / 2 && Math.abs(dy) <= s.height / 2,
  outline: (box) => rectElement(box, 0),
};

const rounded: ShapeDef = {
  id: "rounded",
  contains: (dx, dy, s) => roundedContains(dx, dy, s, ROUNDED_RADIUS),
  outline: (box) => rectElement(box, ROUNDED_RADIUS),
};

/** A rectangle with fully round ends: the terminator of a flow chart. */
const pill: ShapeDef = {
  id: "pill",
  contains: (dx, dy, s) => roundedContains(dx, dy, s, s.height / 2),
  outline: (box) => rectElement(box, box.height / 2),
};

const diamond: ShapeDef = {
  id: "diamond",
  contains: (dx, dy, s) => Math.abs(dx) / (s.width / 2) + Math.abs(dy) / (s.height / 2) <= 1,
  outline: (box) => {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    return {
      tag: "polygon",
      attrs: {
        points: `${cx},${box.y} ${box.x + box.width},${cy} ${cx},${box.y + box.height} ${box.x},${cy}`,
      },
    };
  },
};

const ellipse: ShapeDef = {
  id: "ellipse",
  contains: (dx, dy, s) => {
    const rx = s.width / 2;
    const ry = s.height / 2;
    return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
  },
  outline: (box) => ({
    tag: "ellipse",
    attrs: {
      cx: box.x + box.width / 2,
      cy: box.y + box.height / 2,
      rx: box.width / 2,
      ry: box.height / 2,
    },
  }),
};

const registry = new Map<string, ShapeDef>(
  [rect, rounded, pill, diamond, ellipse].map((s) => [s.id, s]),
);

/** Adds (or replaces) a shape. */
export function registerShape(def: ShapeDef): void {
  registry.set(def.id, def);
}

/** The shape for an id. An unknown id draws as a plain rectangle rather than
 * failing, so a note written for a newer build still opens. */
export function shapeOf(id: string): ShapeDef {
  return registry.get(id) ?? rect;
}

/** The outline as SVG markup (the export; the canvas builds elements from the data). */
export function shapeMarkup(el: ShapeElement, extraAttrs: string): string {
  const attrs = Object.entries(el.attrs)
    .map(([k, v]) => `${k}="${v}"`)
    .join(" ");
  return `<${el.tag} ${attrs} ${extraAttrs} />`;
}
