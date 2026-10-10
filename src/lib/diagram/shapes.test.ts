import { describe, expect, it } from "vitest";
import { boundaryPoint, centerOf, nodeContains, type DiagramNode, type Point } from "./node-edge";
import {
  BUBBLE_TAIL,
  CLOUD_LOBES,
  CLOUD_SAMPLES,
  CYLINDER_LID,
  HEXAGON_INSET,
  PARALLELOGRAM_SLANT,
  PERSON_ICON_HEIGHT,
  PERSON_ICON_WIDTH,
  SUBROUTINE_INSET,
  cloudDepth,
  cloudRadius,
  cylinderLid,
  hexagonInset,
  shapeOf,
  speechBubbleOutline,
  type BubbleSide,
} from "./shapes";

const node = (shape: string, width = 120, height = 48): DiagramNode => ({
  id: "n",
  shape,
  x: 200 - width / 2,
  y: 100 - height / 2,
  width,
  height,
});

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

function polygonPoints(n: DiagramNode): Point[] {
  const el = shapeOf(n.shape).outline(n);
  expect(el.tag).toBe("polygon");
  return String(el.attrs.points)
    .split(" ")
    .map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return { x, y };
    });
}

/** Directions all around the centre, so every edge and corner is met. */
const ANGLES = Array.from({ length: 72 }, (_, i) => (i * Math.PI * 2) / 72 + 0.013);

describe("parallelogram", () => {
  it("is registered and leans right", () => {
    const n = node("parallelogram");
    expect(shapeOf("parallelogram").id).toBe("parallelogram");
    // top edge shifted right, bottom edge shifted left
    expect(polygonPoints(n)).toEqual([
      { x: 140 + PARALLELOGRAM_SLANT, y: 76 },
      { x: 260, y: 76 },
      { x: 260 - PARALLELOGRAM_SLANT, y: 124 },
      { x: 140, y: 124 },
    ]);
  });

  it("contains its centre and the filled corners, not the cut ones", () => {
    const n = node("parallelogram");
    const c = centerOf(n);
    expect(nodeContains(n, c)).toBe(true);
    // the empty corners: top-left and bottom-right of the box
    expect(nodeContains(n, { x: n.x + 2, y: n.y + 2 })).toBe(false);
    expect(nodeContains(n, { x: n.x + n.width - 2, y: n.y + n.height - 2 })).toBe(false);
    // the filled corners: top-right and bottom-left
    expect(nodeContains(n, { x: n.x + n.width - 2, y: n.y + 2 })).toBe(true);
    expect(nodeContains(n, { x: n.x + 2, y: n.y + n.height - 2 })).toBe(true);
    // just outside the box is out
    expect(nodeContains(n, { x: c.x, y: n.y - 1 })).toBe(false);
    expect(nodeContains(n, { x: n.x + n.width + 1, y: c.y })).toBe(false);
  });

  it("is half way along the slant at the centre line", () => {
    const n = node("parallelogram");
    const c = centerOf(n);
    expect(nodeContains(n, { x: n.x + PARALLELOGRAM_SLANT / 2 - 0.1, y: c.y })).toBe(false);
    expect(nodeContains(n, { x: n.x + PARALLELOGRAM_SLANT / 2 + 0.1, y: c.y })).toBe(true);
  });

  it("puts every arrow end point on the drawn outline", () => {
    const n = node("parallelogram");
    const pts = polygonPoints(n);
    const c = centerOf(n);
    for (const angle of ANGLES) {
      const p = boundaryPoint(n, { x: c.x + Math.cos(angle) * 300, y: c.y + Math.sin(angle) * 300 });
      const d = Math.min(...pts.map((a, i) => distanceToSegment(p, a, pts[(i + 1) % pts.length])));
      expect(d).toBeLessThan(0.01);
    }
  });

  it("keeps a narrow shape valid", () => {
    const n = node("parallelogram", 30, 40);
    expect(nodeContains(n, centerOf(n))).toBe(true);
    const pts = polygonPoints(n);
    expect(pts[0].x).toBeLessThan(pts[1].x);
  });
});

describe("subroutine", () => {
  it("is registered with the rectangle's reach", () => {
    const n = node("subroutine");
    expect(shapeOf("subroutine").id).toBe("subroutine");
    const c = centerOf(n);
    expect(nodeContains(n, c)).toBe(true);
    expect(nodeContains(n, { x: n.x + 1, y: n.y + 1 })).toBe(true);
    expect(nodeContains(n, { x: n.x + n.width + 1, y: c.y })).toBe(false);
  });

  it("draws the frame and one line inside each side as a single path", () => {
    const n = node("subroutine");
    const el = shapeOf("subroutine").outline(n);
    expect(el.tag).toBe("path");
    expect(el.attrs.d).toBe(
      [
        "M 140 76 H 260 V 124 H 140 Z",
        `M ${140 + SUBROUTINE_INSET} 76 V 124`,
        `M ${260 - SUBROUTINE_INSET} 76 V 124`,
      ].join(" "),
    );
  });

  it("puts every arrow end point on the outer frame", () => {
    const n = node("subroutine");
    const c = centerOf(n);
    for (const angle of ANGLES) {
      const p = boundaryPoint(n, { x: c.x + Math.cos(angle) * 300, y: c.y + Math.sin(angle) * 300 });
      const onVertical = Math.abs(Math.abs(p.x - c.x) - n.width / 2) < 0.01;
      const onHorizontal = Math.abs(Math.abs(p.y - c.y) - n.height / 2) < 0.01;
      expect(onVertical || onHorizontal).toBe(true);
    }
  });

  it("keeps the inner lines inside a narrow shape", () => {
    const n = node("subroutine", 24, 40);
    const d = String(shapeOf("subroutine").outline(n).attrs.d);
    // the inset shrinks to a quarter of the width, so the lines never cross
    expect(d).toContain(`M ${n.x + 6} ${n.y} V ${n.y + n.height}`);
    expect(d).toContain(`M ${n.x + n.width - 6} ${n.y} V ${n.y + n.height}`);
  });
});

describe("hexagon (T-0702)", () => {
  it("is registered, pointed left and right, flat top and bottom", () => {
    const n = node("hexagon");
    expect(shapeOf("hexagon").id).toBe("hexagon");
    const k = HEXAGON_INSET;
    expect(polygonPoints(n)).toEqual([
      { x: 140 + k, y: 76 },
      { x: 260 - k, y: 76 },
      { x: 260, y: 100 },
      { x: 260 - k, y: 124 },
      { x: 140 + k, y: 124 },
      { x: 140, y: 100 },
    ]);
  });

  it("contains its centre and the points, not the cut corners", () => {
    const n = node("hexagon");
    const c = centerOf(n);
    expect(nodeContains(n, c)).toBe(true);
    expect(nodeContains(n, { x: n.x + 0.5, y: c.y })).toBe(true);
    expect(nodeContains(n, { x: n.x + 1, y: n.y + 1 })).toBe(false);
    expect(nodeContains(n, { x: n.x + n.width - 1, y: n.y + n.height - 1 })).toBe(false);
    expect(nodeContains(n, { x: c.x, y: n.y - 1 })).toBe(false);
    expect(nodeContains(n, { x: n.x - 1, y: c.y })).toBe(false);
  });

  it("puts arrow endpoints on the drawn outline, in every direction and size", () => {
    for (const [w, h] of [
      [120, 48],
      [60, 40],
      [24, 40],
    ]) {
      const n = node("hexagon", w, h);
      const pts = polygonPoints(n);
      for (const a of ANGLES) {
        const c = centerOf(n);
        const far = { x: c.x + Math.cos(a) * 1000, y: c.y + Math.sin(a) * 1000 };
        const p = boundaryPoint(n, far);
        const d = Math.min(...pts.map((q, i) => distanceToSegment(p, q, pts[(i + 1) % pts.length])));
        expect(d).toBeLessThan(0.01);
      }
    }
  });

  it("limits the inset to a quarter of the width", () => {
    expect(hexagonInset({ width: 20, height: 40 })).toBe(5);
    expect(hexagonInset({ width: 200, height: 40 })).toBe(HEXAGON_INSET);
  });
});

/** Commands of a path `d` (single letters M L H V A Z), each with its numbers. */
function pathCommands(d: string): { cmd: string; args: number[] }[] {
  return [...d.matchAll(/([MLHVAZ])([^MLHVAZ]*)/g)].map((m) => ({
    cmd: m[1],
    args: m[2].trim() === "" ? [] : m[2].trim().split(/\s+/).map(Number),
  }));
}

describe("cylinder (T-0702)", () => {
  const dOf = (n: DiagramNode) => String(shapeOf(n.shape).outline(n).attrs.d);

  it("is registered; the outline is a closed silhouette plus the lid's front arc", () => {
    const n = node("cylinder", 120, 60);
    expect(shapeOf("cylinder").id).toBe("cylinder");
    const e = cylinderLid(n);
    expect(e).toBe(CYLINDER_LID);
    const cmds = pathCommands(dOf(n));
    // body: top arc, right side, bottom arc, close; then the open front arc
    expect(cmds.map((c) => c.cmd)).toEqual(["M", "A", "V", "A", "Z", "M", "A"]);
    expect(cmds[0].args).toEqual([n.x, n.y + e]);
    expect(cmds[1].args).toEqual([60, e, 0, 0, 1, n.x + n.width, n.y + e]);
    expect(cmds[2].args).toEqual([n.y + n.height - e]);
    expect(cmds[3].args).toEqual([60, e, 0, 0, 1, n.x, n.y + n.height - e]);
    // the front arc runs the other way round, through the lower half of the lid
    expect(cmds[5].args).toEqual([n.x, n.y + e]);
    expect(cmds[6].args).toEqual([60, e, 0, 0, 0, n.x + n.width, n.y + e]);
  });

  it("contains the rounded lids, not the corners they cut", () => {
    const n = node("cylinder", 120, 60);
    const c = centerOf(n);
    expect(nodeContains(n, c)).toBe(true);
    expect(nodeContains(n, { x: c.x, y: n.y + 0.5 })).toBe(true);
    expect(nodeContains(n, { x: c.x, y: n.y - 0.5 })).toBe(false);
    expect(nodeContains(n, { x: n.x + 1, y: n.y + 1 })).toBe(false);
    expect(nodeContains(n, { x: n.x + 1, y: n.y + CYLINDER_LID + 1 })).toBe(true);
    expect(nodeContains(n, { x: n.x + n.width - 1, y: n.y + n.height - 1 })).toBe(false);
  });

  it("puts arrow endpoints on the silhouette (straight sides and lid arcs)", () => {
    for (const [w, h] of [
      [120, 60],
      [100, 30],
      [80, 120],
    ]) {
      const n = node("cylinder", w, h);
      const e = cylinderLid(n);
      const cy = n.y + n.height / 2;
      const cx = n.x + n.width / 2;
      let onArc = 0;
      for (const a of ANGLES) {
        const c = centerOf(n);
        const p = boundaryPoint(n, { x: c.x + Math.cos(a) * 1000, y: c.y + Math.sin(a) * 1000 });
        const ay = Math.abs(p.y - cy);
        if (ay <= n.height / 2 - e + 0.01) {
          expect(Math.abs(Math.abs(p.x - cx) - n.width / 2)).toBeLessThan(0.01);
        } else {
          // on the lid's ellipse, with the radii the path carries
          const qy = (ay - (n.height / 2 - e)) / e;
          const qx = (p.x - cx) / (n.width / 2);
          expect(Math.abs(qx * qx + qy * qy - 1)).toBeLessThan(0.01);
          onArc++;
        }
      }
      expect(onArc).toBeGreaterThan(0);
    }
  });

  it("reaches the apex of the lid straight above and below", () => {
    const n = node("cylinder", 120, 60);
    const c = centerOf(n);
    expect(boundaryPoint(n, { x: c.x, y: c.y - 500 }).y).toBeCloseTo(n.y, 1);
    expect(boundaryPoint(n, { x: c.x, y: c.y + 500 }).y).toBeCloseTo(n.y + n.height, 1);
  });

  it("shrinks the lid for a low node", () => {
    expect(cylinderLid({ width: 100, height: 30 })).toBe(6);
  });
});

describe("screen (T-0702)", () => {
  const outline = (n: DiagramNode, rules?: number[]) =>
    shapeOf("screen").outline({ x: n.x, y: n.y, width: n.width, height: n.height, rules });

  it("is registered and contains its box exactly", () => {
    const n = node("screen", 200, 100);
    expect(shapeOf("screen").id).toBe("screen");
    expect(nodeContains(n, { x: n.x + 1, y: n.y + 1 })).toBe(true);
    expect(nodeContains(n, { x: n.x + n.width - 1, y: n.y + n.height - 1 })).toBe(true);
    expect(nodeContains(n, { x: n.x - 1, y: n.y + 10 })).toBe(false);
    expect(nodeContains(n, { x: n.x + 10, y: n.y + n.height + 1 })).toBe(false);
  });

  it("draws the frame alone without rules", () => {
    const n = node("screen", 200, 100);
    const el = outline(n);
    expect(el.tag).toBe("path");
    expect(pathCommands(String(el.attrs.d)).map((c) => c.cmd)).toEqual(["M", "H", "V", "H", "Z"]);
  });

  it("adds one horizontal line per rule, at the distance from the top edge", () => {
    const n = node("screen", 200, 100);
    const cmds = pathCommands(String(outline(n, [24, 61.5]).attrs.d));
    expect(cmds.slice(5)).toEqual([
      { cmd: "M", args: [n.x, n.y + 24] },
      { cmd: "H", args: [n.x + n.width] },
      { cmd: "M", args: [n.x, n.y + 61.5] },
      { cmd: "H", args: [n.x + n.width] },
    ]);
  });

  it("drops rules on or outside the frame", () => {
    const n = node("screen", 200, 100);
    const d = String(outline(n, [0, -5, 100, 140, Number.NaN]).attrs.d);
    expect(pathCommands(d)).toHaveLength(5);
  });

  it("is ignored by the other shapes", () => {
    const n = node("rect");
    const box = { x: n.x, y: n.y, width: n.width, height: n.height };
    for (const id of ["rect", "rounded", "pill", "diamond", "ellipse", "document", "hexagon", "cylinder", "subroutine"]) {
      expect(shapeOf(id).outline({ ...box, rules: [10, 20] })).toEqual(shapeOf(id).outline(box));
    }
  });

  it("puts arrow endpoints on the frame, where the rules also end", () => {
    const n = node("screen", 200, 100);
    for (const a of ANGLES) {
      const c = centerOf(n);
      const p = boundaryPoint(n, { x: c.x + Math.cos(a) * 1000, y: c.y + Math.sin(a) * 1000 });
      const onFrame =
        Math.abs(p.x - n.x) < 0.01 ||
        Math.abs(p.x - (n.x + n.width)) < 0.01 ||
        Math.abs(p.y - n.y) < 0.01 ||
        Math.abs(p.y - (n.y + n.height)) < 0.01;
      expect(onFrame).toBe(true);
    }
  });
});

describe("person (T-0705)", () => {
  const personNode = (width = 88, height = 70): DiagramNode => node("person", width, height);

  it("contains the whole box (a rectangle), icon or not", () => {
    const def = shapeOf("person");
    const size = { width: 100, height: 80 };
    expect(def.contains(0, 0, size)).toBe(true);
    expect(def.contains(50, 40, size)).toBe(true);
    expect(def.contains(-50, -40, size)).toBe(true);
    expect(def.contains(-50, 40, size)).toBe(true);
    expect(def.contains(50.01, 0, size)).toBe(false);
    expect(def.contains(0, -40.01, size)).toBe(false);
    // The bottom corners are on the name, not on the icon.
    expect(def.contains(45, 38, size)).toBe(true);
  });

  it("stops arrows on the box edge in every direction", () => {
    const n = personNode(120, 90);
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * 2 * Math.PI;
      const p = boundaryPoint(n, { x: centerOf(n).x + 400 * Math.cos(a), y: centerOf(n).y + 400 * Math.sin(a) });
      const onFrame =
        Math.abs(p.x - n.x) < 0.01 ||
        Math.abs(p.x - (n.x + n.width)) < 0.01 ||
        Math.abs(p.y - n.y) < 0.01 ||
        Math.abs(p.y - (n.y + n.height)) < 0.01;
      expect(onFrame).toBe(true);
    }
  });

  it("outlines the icon only: one path in the top 44px, as wide as the icon, centred", () => {
    const n = personNode(140, 90);
    const el = shapeOf("person").outline(n);
    expect(el.tag).toBe("path");
    const d = String(el.attrs.d);
    const nums = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
    expect(d.startsWith("M ")).toBe(true);
    // Absolute commands only (M, A, Z): the numbers alternate rx ry rot flags x y.
    const points: Point[] = [];
    const tokens = d.split(/\s+(?=[MAZ])/);
    for (const t of tokens) {
      const v = t.trim().split(/\s+/);
      if (v[0] === "M") points.push({ x: Number(v[1]), y: Number(v[2]) });
      if (v[0] === "A") points.push({ x: Number(v[6]), y: Number(v[7]) });
    }
    expect(nums.length).toBeGreaterThan(8);
    for (const p of points) {
      expect(p.y).toBeGreaterThanOrEqual(n.y);
      expect(p.y).toBeLessThanOrEqual(n.y + PERSON_ICON_HEIGHT);
      expect(Math.abs(p.x - (n.x + n.width / 2))).toBeLessThanOrEqual(PERSON_ICON_WIDTH / 2 + 0.01);
    }
    // Well inside the box: nothing near the bottom edge or the sides, where the name goes.
    const ys = points.map((p) => p.y);
    expect(Math.max(...ys)).toBeLessThanOrEqual(n.y + 44);
    expect(Math.max(...ys)).toBeLessThan(n.y + n.height);
  });

  it("keeps the icon the same size whatever the name's width", () => {
    const widths = [88, 200].map((w) => {
      const n = personNode(w, 70);
      const xs = [...String(shapeOf("person").outline(n).attrs.d).matchAll(/M (-?[\d.]+) /g)].map((m) => Number(m[1]) - n.x - w / 2);
      return xs;
    });
    expect(widths[0]).toEqual(widths[1]);
  });
});

describe("speechBubbleOutline (T-0705)", () => {
  const box = { x: 100, y: 50, width: 120, height: 60 };
  const sides: BubbleSide[] = ["left", "right", "top", "bottom"];

  it("is ONE closed path: a single sub-path ending in Z", () => {
    for (const side of sides) {
      const el = speechBubbleOutline(box, side);
      expect(el.tag).toBe("path");
      const d = String(el.attrs.d);
      expect(d.match(/M/g)).toHaveLength(1);
      expect(d.match(/Z/g)).toHaveLength(1);
      expect(d.trim().endsWith("Z")).toBe(true);
    }
  });

  it("has its tail tip 8px out of the box, centred, on the named side only", () => {
    const tip = {
      left: "L 92 80",
      right: "L 228 80",
      top: "L 160 42",
      bottom: "L 160 118",
    };
    for (const side of sides) {
      const d = String(speechBubbleOutline(box, side).attrs.d);
      expect(d).toContain(tip[side]);
      expect(d.match(/ L /g)).toHaveLength(2); // the tail's two sloping edges, nothing else
      expect(BUBBLE_TAIL).toBe(8);
    }
  });

  it("reaches no further than the tail's tip outside the box", () => {
    for (const side of sides) {
      const d = String(speechBubbleOutline(box, side).attrs.d);
      const xs: number[] = [];
      const ys: number[] = [];
      for (const t of d.split(/\s+(?=[MHVLAZ])/)) {
        const v = t.trim().split(/\s+/);
        if (v[0] === "M" || v[0] === "L") (xs.push(Number(v[1])), ys.push(Number(v[2])));
        if (v[0] === "H") xs.push(Number(v[1]));
        if (v[0] === "V") ys.push(Number(v[1]));
        if (v[0] === "A") (xs.push(Number(v[6])), ys.push(Number(v[7])));
      }
      const out = {
        left: box.x - Math.min(...xs),
        right: Math.max(...xs) - (box.x + box.width),
        top: box.y - Math.min(...ys),
        bottom: Math.max(...ys) - (box.y + box.height),
      };
      for (const s of sides) expect(out[s]).toBeCloseTo(s === side ? BUBBLE_TAIL : 0, 5);
    }
  });

  it("keeps the tail off the rounded corners of a small box", () => {
    const d = String(speechBubbleOutline({ x: 0, y: 0, width: 30, height: 20 }, "top").attrs.d);
    const m = d.match(/H (-?[\d.]+) L (-?[\d.]+) -8 L (-?[\d.]+) 0/)!;
    expect(Number(m[1])).toBeGreaterThanOrEqual(6);
    expect(Number(m[3])).toBeLessThanOrEqual(24);
  });
});

describe("cloud (T-0708)", () => {
  const cloudPoints = (n: DiagramNode): Point[] => {
    const el = shapeOf(n.shape).outline(n);
    expect(el.tag).toBe("polygon");
    return String(el.attrs.points)
      .split(" ")
      .map((pair) => {
        const [x, y] = pair.split(",").map(Number);
        return { x, y };
      });
  };

  it("is registered: a polygon of samples from one radius function", () => {
    const n = node("cloud", 180, 90);
    expect(shapeOf("cloud").id).toBe("cloud");
    expect(CLOUD_LOBES).toBe(8);
    const pts = cloudPoints(n);
    expect(pts).toHaveLength(CLOUD_SAMPLES);
    const c = centerOf(n);
    for (const p of pts) {
      const theta = Math.atan2(p.y - c.y, p.x - c.x);
      expect(Math.hypot(p.x - c.x, p.y - c.y)).toBeCloseTo(
        cloudRadius(theta, { width: n.width, height: n.height }),
        1,
      );
    }
  });

  it("never leaves its box: the ripple only carves inward", () => {
    for (const [w, h] of [
      [180, 90],
      [112, 52],
      [300, 60],
    ]) {
      const n = node("cloud", w, h);
      for (const p of cloudPoints(n)) {
        expect(p.x).toBeGreaterThanOrEqual(n.x - 0.01);
        expect(p.x).toBeLessThanOrEqual(n.x + n.width + 0.01);
        expect(p.y).toBeGreaterThanOrEqual(n.y - 0.01);
        expect(p.y).toBeLessThanOrEqual(n.y + n.height + 0.01);
      }
    }
  });

  it("contains its centre and the crests, not the corners of the box", () => {
    const n = node("cloud", 180, 90);
    const c = centerOf(n);
    expect(nodeContains(n, c)).toBe(true);
    // A crest touches each side's middle (the ripple is 0 there).
    expect(nodeContains(n, { x: n.x + n.width - 0.5, y: c.y })).toBe(true);
    expect(nodeContains(n, { x: c.x, y: n.y + 0.5 })).toBe(true);
    expect(nodeContains(n, { x: n.x + 1, y: n.y + 1 })).toBe(false);
    expect(nodeContains(n, { x: n.x + n.width - 1, y: n.y + n.height - 1 })).toBe(false);
  });

  it("puts every arrow end point on the drawn outline", () => {
    const n = node("cloud", 180, 90);
    const pts = cloudPoints(n);
    const c = centerOf(n);
    for (const angle of ANGLES) {
      const p = boundaryPoint(n, { x: c.x + Math.cos(angle) * 1000, y: c.y + Math.sin(angle) * 1000 });
      const d = Math.min(...pts.map((a, i) => distanceToSegment(p, a, pts[(i + 1) % pts.length])));
      expect(d).toBeLessThan(1);
    }
  });

  it("is star-shaped: every ray from the centre leaves once", () => {
    const n = node("cloud", 180, 90);
    const c = centerOf(n);
    for (const angle of ANGLES) {
      const ux = Math.cos(angle);
      const uy = Math.sin(angle);
      let crossings = 0;
      let inside = true; // the centre
      for (let t = 2; t <= 200; t += 2) {
        const now = nodeContains(n, { x: c.x + ux * t, y: c.y + uy * t });
        if (inside && !now) crossings++;
        if (!inside && now) crossings += 10; // back in: not star-shaped
        inside = now;
      }
      expect(crossings).toBe(1);
    }
  });

  it("reaches the box edge straight out in the four directions", () => {
    const n = node("cloud", 180, 90);
    const c = centerOf(n);
    expect(boundaryPoint(n, { x: c.x + 500, y: c.y }).x).toBeCloseTo(n.x + n.width, 1);
    expect(boundaryPoint(n, { x: c.x - 500, y: c.y }).x).toBeCloseTo(n.x, 1);
    expect(boundaryPoint(n, { x: c.x, y: c.y - 500 }).y).toBeCloseTo(n.y, 1);
    expect(boundaryPoint(n, { x: c.x, y: c.y + 500 }).y).toBeCloseTo(n.y + n.height, 1);
  });

  it("keeps the valleys small on a narrow shape", () => {
    expect(cloudDepth({ width: 40, height: 200 })).toBeCloseTo(4, 5);
    const n = node("cloud", 40, 200);
    expect(nodeContains(n, centerOf(n))).toBe(true);
    expect(cloudPoints(n)).toHaveLength(CLOUD_SAMPLES);
  });
});
