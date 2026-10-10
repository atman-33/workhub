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

/**
 * What an outline is drawn for: the node's box, plus (for a `screen`) the
 * heights of its dividing rules, measured down from the box's top edge. Every
 * other shape ignores `rules`, so a plain `Box` is still a valid argument.
 */
export interface OutlineBox extends Box {
  rules?: number[];
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
  outline(box: OutlineBox): ShapeElement;
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

/** Samples along the wavy bottom edge of the document shape. */
const DOCUMENT_WAVE_SAMPLES = 32;

/**
 * Depth of the wave of a document shape of height `height`. Capped at about a
 * tenth of the height: that is what keeps the shape star-shaped about its
 * centre (a deeper wave lets a shallow line leave the shape and come back in),
 * and `boundaryPoint` relies on a line crossing the outline once.
 */
export function documentWaveDepth(height: number): number {
  return Math.min(6, height / 9);
}

/**
 * Where the bottom edge of a document shape lies at horizontal offset `dx`
 * from its centre: a sine of one period across the width, so the edge dips to
 * the bottom of the box at a quarter of the way along and rises to
 * `2 * depth` above it at three quarters. Measured downward from the centre.
 */
export function documentBottom(dx: number, size: ShapeSize): number {
  const depth = documentWaveDepth(size.height);
  const u = (dx + size.width / 2) / size.width;
  return size.height / 2 - depth + depth * Math.sin(2 * Math.PI * u);
}

/**
 * A page whose bottom edge ripples: the deliverable of the PFD (T-0683).
 * `contains` and `outline` are built from the same function, so an arrow stops
 * on the line that is drawn, ripple included.
 */
const documentShape: ShapeDef = {
  id: "document",
  contains: (dx, dy, s) =>
    Math.abs(dx) <= s.width / 2 && dy >= -s.height / 2 && dy <= documentBottom(dx, s),
  outline: (box) => {
    const size = { width: box.width, height: box.height };
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const points = [`M ${box.x} ${box.y}`, `L ${box.x + box.width} ${box.y}`];
    for (let i = DOCUMENT_WAVE_SAMPLES; i >= 0; i--) {
      const dx = -box.width / 2 + (box.width * i) / DOCUMENT_WAVE_SAMPLES;
      points.push(`L ${round2(cx + dx)} ${round2(cy + documentBottom(dx, size))}`);
    }
    points.push("Z");
    return { tag: "path", attrs: { d: points.join(" ") } };
  },
};

/** How far the top and bottom edges of a parallelogram are shifted: the lean. */
export const PARALLELOGRAM_SLANT = 14;

/** Slant actually used for a shape of this size (never more than a quarter of the width). */
export function parallelogramSlant(size: ShapeSize): number {
  return Math.min(PARALLELOGRAM_SLANT, size.width / 4);
}

/**
 * A parallelogram leaning right (the top edge shifted right of the bottom one):
 * input and output of a program flow (T-0697). Convex, so star-shaped about its
 * centre. The side edges are straight lines from (-w/2 + k, -h/2) to
 * (-w/2, h/2) on the left and (w/2, -h/2) to (w/2 - k, h/2) on the right.
 */
const parallelogram: ShapeDef = {
  id: "parallelogram",
  contains: (dx, dy, s) => {
    if (Math.abs(dy) > s.height / 2) return false;
    const k = parallelogramSlant(s);
    const t = dy / s.height; // -0.5 at the top, 0.5 at the bottom
    return dx >= -s.width / 2 + k * (0.5 - t) && dx <= s.width / 2 - k * (0.5 + t);
  },
  outline: (box) => {
    const k = parallelogramSlant(box);
    const right = box.x + box.width;
    const bottom = box.y + box.height;
    return {
      tag: "polygon",
      attrs: {
        points: `${box.x + k},${box.y} ${right},${box.y} ${right - k},${bottom} ${box.x},${bottom}`,
      },
    };
  },
};

/** Distance of the two inner vertical lines of a subroutine from its sides. */
export const SUBROUTINE_INSET = 10;

/**
 * A rectangle with a vertical line inside each side: a predefined process
 * (T-0697). One `path` draws the frame and both lines; the lines are open
 * sub-paths with no area, so the fill is the plain rectangle. `contains` is the
 * rectangle's, so an arrow stops on the outer frame.
 */
const subroutine: ShapeDef = {
  id: "subroutine",
  contains: (dx, dy, s) => Math.abs(dx) <= s.width / 2 && Math.abs(dy) <= s.height / 2,
  outline: (box) => {
    const inset = Math.min(SUBROUTINE_INSET, box.width / 4);
    const right = box.x + box.width;
    const bottom = box.y + box.height;
    const d = [
      `M ${box.x} ${box.y} H ${right} V ${bottom} H ${box.x} Z`,
      `M ${box.x + inset} ${box.y} V ${bottom}`,
      `M ${right - inset} ${box.y} V ${bottom}`,
    ].join(" ");
    return { tag: "path", attrs: { d } };
  },
};

/** How far the top and bottom edges of a hexagon are pulled in from the sides. */
export const HEXAGON_INSET = 14;

/** Inset actually used for a hexagon of this size (never more than a quarter of the width). */
export function hexagonInset(size: ShapeSize): number {
  return Math.min(HEXAGON_INSET, size.width / 4);
}

/**
 * A hexagon pointed at the left and right, flat on top and bottom: a trigger
 * (T-0702). The side edges run from (+-(w/2 - k), +-h/2) to the points at
 * (+-w/2, 0); `contains` and the polygon use the same six numbers. Convex.
 */
const hexagon: ShapeDef = {
  id: "hexagon",
  contains: (dx, dy, s) => {
    const hh = s.height / 2;
    if (Math.abs(dy) > hh) return false;
    return Math.abs(dx) <= s.width / 2 - (hexagonInset(s) * Math.abs(dy)) / hh;
  },
  outline: (box) => {
    const k = hexagonInset(box);
    const right = box.x + box.width;
    const bottom = box.y + box.height;
    const cy = box.y + box.height / 2;
    return {
      tag: "polygon",
      attrs: {
        points: [
          `${box.x + k},${box.y}`,
          `${right - k},${box.y}`,
          `${right},${cy}`,
          `${right - k},${bottom}`,
          `${box.x + k},${bottom}`,
          `${box.x},${cy}`,
        ].join(" "),
      },
    };
  },
};

/** Largest vertical radius of a cylinder's lid. */
export const CYLINDER_LID = 10;

/** Vertical radius `e` of the lid ellipses of a cylinder of this size (a fifth of the height at most). */
export function cylinderLid(size: ShapeSize): number {
  return Math.min(CYLINDER_LID, size.height / 5);
}

/**
 * A can: a rectangle capped by half ellipses above and below, with the front
 * half of the lid's ellipse drawn across the top: a data store (T-0702).
 * The silhouette is the rectangle plus the two half ellipses (convex), and
 * `contains` is that silhouette; the front arc is an open sub-path with no
 * area (as the lines of `subroutine` are), so it does not change the fill.
 */
const cylinder: ShapeDef = {
  id: "cylinder",
  contains: (dx, dy, s) => {
    const hw = s.width / 2;
    const hh = s.height / 2;
    const e = cylinderLid(s);
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (ax > hw || ay > hh) return false;
    if (ay <= hh - e) return true;
    if (e <= 0) return true;
    const qy = (ay - (hh - e)) / e;
    return (ax * ax) / (hw * hw) + qy * qy <= 1;
  },
  outline: (box) => {
    const e = cylinderLid(box);
    const rx = round2(box.width / 2);
    const left = box.x;
    const right = box.x + box.width;
    const top = box.y + e;
    const bottom = box.y + box.height - e;
    const d = [
      `M ${left} ${top} A ${rx} ${e} 0 0 1 ${right} ${top} V ${bottom} A ${rx} ${e} 0 0 1 ${left} ${bottom} Z`,
      `M ${left} ${top} A ${rx} ${e} 0 0 0 ${right} ${top}`,
    ].join(" ");
    return { tag: "path", attrs: { d } };
  },
};

/**
 * A square-cornered box with horizontal rules inside: a screen (T-0702). The
 * rules (`box.rules`, distances from the top edge) separate the title band and
 * the sections, and where they fall depends on what the screen holds, so the
 * caller supplies them. One `path` draws frame and rules; the rules are open
 * sub-paths with no area. A rule on or outside the frame is dropped. `contains`
 * is the rectangle's, so an arrow stops on the frame.
 */
const screen: ShapeDef = {
  id: "screen",
  contains: (dx, dy, s) => Math.abs(dx) <= s.width / 2 && Math.abs(dy) <= s.height / 2,
  outline: (box) => {
    const right = box.x + box.width;
    const bottom = box.y + box.height;
    const parts = [`M ${box.x} ${box.y} H ${right} V ${bottom} H ${box.x} Z`];
    for (const r of box.rules ?? []) {
      if (!(r > 0 && r < box.height)) continue;
      parts.push(`M ${box.x} ${round2(box.y + r)} H ${right}`);
    }
    return { tag: "path", attrs: { d: parts.join(" ") } };
  },
};

/** Height of a person's icon (head and shoulders), at the top of its box. */
export const PERSON_ICON_HEIGHT = 44;
/** Width of a person's icon; the name below it is wider or as wide as this. */
export const PERSON_ICON_WIDTH = 32;
const PERSON_HEAD_RADIUS = 10;
const PERSON_SHOULDER_HEIGHT = 18;

/**
 * A person (T-0705, the actor of the use case diagram): head and shoulders at
 * the top of the node's box, the name written below by the kind. The box is
 * the whole node (icon plus name), so `contains` is the rectangle and an arrow
 * stops on the box edge whatever width the name gives it; `outline` draws only
 * the icon, one `path` (a head circle and a half-ellipse of shoulders). A
 * rectangle is star-shaped, so `boundaryPoint` needs no change.
 */
const person: ShapeDef = {
  id: "person",
  contains: (dx, dy, s) => Math.abs(dx) <= s.width / 2 && Math.abs(dy) <= s.height / 2,
  outline: (box) => {
    const cx = round2(box.x + box.width / 2);
    const top = box.y;
    const r = PERSON_HEAD_RADIUS;
    const headY = round2(top + r + 1);
    const base = round2(top + PERSON_ICON_HEIGHT);
    const half = PERSON_ICON_WIDTH / 2;
    const d = [
      `M ${round2(cx - r)} ${headY} A ${r} ${r} 0 1 0 ${round2(cx + r)} ${headY} A ${r} ${r} 0 1 0 ${round2(cx - r)} ${headY} Z`,
      `M ${round2(cx - half)} ${base} A ${half} ${PERSON_SHOULDER_HEIGHT} 0 0 1 ${round2(cx + half)} ${base} Z`,
    ].join(" ");
    return { tag: "path", attrs: { d } };
  },
};

/** Which side of a bubble's box carries its tail (the side facing the person). */
export type BubbleSide = "left" | "right" | "top" | "bottom";

/** How far a speech bubble's tail sticks out of the box. */
export const BUBBLE_TAIL = 8;
/** Half the width of the tail where it leaves the box. */
export const BUBBLE_TAIL_HALF_BASE = 6;
/** Corner radius of a speech bubble. */
export const BUBBLE_RADIUS = 6;

/**
 * A speech bubble as ONE closed `path`: a rounded rectangle (`box`) with a
 * triangular tail on `tailSide`, centred on that side (kept clear of the
 * rounded corners when the side is long enough) and pointing 8px out of the
 * box. The tail lies outside `box`; it is part of the same sub-path, so a fill
 * and a stroke treat bubble and tail as one shape. Drawn clockwise from the
 * top edge.
 */
export function speechBubbleOutline(box: Box, tailSide: BubbleSide): ShapeElement {
  const r = Math.min(BUBBLE_RADIUS, box.width / 2, box.height / 2);
  const t = BUBBLE_TAIL;
  const b = BUBBLE_TAIL_HALF_BASE;
  const { x, y, width: w, height: h } = box;
  const right = x + w;
  const bottom = y + h;
  const mid = (start: number, len: number) =>
    start + Math.min(Math.max(len / 2, r + b), Math.max(len / 2, len - r - b));
  const cx = mid(x, w);
  const cy = mid(y, h);
  const parts = [`M ${round2(x + r)} ${round2(y)}`];
  if (tailSide === "top") parts.push(`H ${round2(cx - b)} L ${round2(cx)} ${round2(y - t)} L ${round2(cx + b)} ${round2(y)}`);
  parts.push(`H ${round2(right - r)} A ${round2(r)} ${round2(r)} 0 0 1 ${round2(right)} ${round2(y + r)}`);
  if (tailSide === "right") parts.push(`V ${round2(cy - b)} L ${round2(right + t)} ${round2(cy)} L ${round2(right)} ${round2(cy + b)}`);
  parts.push(`V ${round2(bottom - r)} A ${round2(r)} ${round2(r)} 0 0 1 ${round2(right - r)} ${round2(bottom)}`);
  if (tailSide === "bottom") parts.push(`H ${round2(cx + b)} L ${round2(cx)} ${round2(bottom + t)} L ${round2(cx - b)} ${round2(bottom)}`);
  parts.push(`H ${round2(x + r)} A ${round2(r)} ${round2(r)} 0 0 1 ${round2(x)} ${round2(bottom - r)}`);
  if (tailSide === "left") parts.push(`V ${round2(cy + b)} L ${round2(x - t)} ${round2(cy)} L ${round2(x)} ${round2(cy - b)}`);
  parts.push(`V ${round2(y + r)} A ${round2(r)} ${round2(r)} 0 0 1 ${round2(x + r)} ${round2(y)} Z`);
  return { tag: "path", attrs: { d: parts.join(" ") } };
}

/** Bumps around a cloud. */
export const CLOUD_BUMPS = 8;
/** Points sampling a cloud's outline (twelve per bump, so the polygon stays on the curve). */
export const CLOUD_SAMPLES = 96;

/**
 * Ripple depth of a cloud of this size. Small next to the box, so the text
 * still fits: the outline never leaves the box (see `cloudRadius`).
 */
export function cloudRipple(size: ShapeSize): number {
  return Math.min(6, Math.min(size.width, size.height) / 12);
}

/**
 * Radius of a cloud in direction `theta` (radians, `atan2(dy, dx)`) from its
 * centre: an ellipse carving a ripple out of itself. The outline touches the
 * box where the ripple crests and dips `2 * ripple` inside between crests, so
 * it always stays in the box. A radius function is star-shaped by definition,
 * and `contains` and `outline` share this one formula, so an arrow stops on
 * the drawn line.
 */
export function cloudRadius(theta: number, size: ShapeSize): number {
  const rx = size.width / 2;
  const ry = size.height / 2;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const base = (rx * ry) / Math.sqrt(ry * ry * cos * cos + rx * rx * sin * sin);
  const ripple = cloudRipple(size);
  return base - ripple + ripple * Math.cos(CLOUD_BUMPS * theta);
}

/**
 * A cloud: a wavy ellipse for an external service (T-0708). One `polygon` of
 * `CLOUD_SAMPLES` points from `cloudRadius`; `contains` is the same radius,
 * so the two cannot drift apart.
 */
const cloud: ShapeDef = {
  id: "cloud",
  contains: (dx, dy, s) => Math.hypot(dx, dy) <= cloudRadius(Math.atan2(dy, dx), s),
  outline: (box) => {
    const size = { width: box.width, height: box.height };
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const points: string[] = [];
    for (let i = 0; i < CLOUD_SAMPLES; i++) {
      const theta = (i * 2 * Math.PI) / CLOUD_SAMPLES;
      const r = cloudRadius(theta, size);
      points.push(`${round2(cx + r * Math.cos(theta))},${round2(cy + r * Math.sin(theta))}`);
    }
    return { tag: "polygon", attrs: { points: points.join(" ") } };
  },
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const registry = new Map<string, ShapeDef>(
  [rect, rounded, pill, diamond, ellipse, documentShape, parallelogram, subroutine, hexagon, cylinder, screen, person, cloud].map((s) => [s.id, s]),
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
