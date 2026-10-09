import { describe, expect, it } from "vitest";
import { boundaryPoint, centerOf, nodeContains } from "../node-edge";
import {
  addLane,
  addStep,
  autoAlign,
  connect,
  deleteLane,
  deleteStep,
  moveLane,
  moveStepTo,
  nudgeStep,
  patchStep,
  reattach,
} from "./ops";
import { bandHeaderText, HEADER_WIDTH, layoutFlow, UNASSIGNED } from "./layout";
import { parseFlow, serializeFlow, type FlowDocModel } from "./parse";

const NOTE = `---
type: flow
title: 受注フロー
---

## Lanes

- L-001 営業
- L-002 経理

## Steps

- F-001 受注 ^start lane:L-001
- F-002 見積を作る lane:L-001
- F-003 金額 1 万円超? ^decision lane:L-001
- F-004 承認する lane:L-002
- F-005 完了 ^end lane:L-001
- F-006 差し戻す lane:L-002

## Edges

- F-001 -> F-002
- F-002 -> F-003
- F-003 -> F-004 "はい"
- F-003 -> F-005 "いいえ"
- F-004 -> F-005
- F-004 -> F-006
- F-006 -> F-002 "再見積"
`;

const doc = () => parseFlow(NOTE);

describe("layoutFlow", () => {
  it("puts steps in columns by rank and in bands by lane", () => {
    const layout = layoutFlow(doc());
    const col = (id: string) => layout.byId.get(id)!.cx;
    // Rank order: start, quote, decision, approve/branch, finish.
    expect(col("F-001")).toBeLessThan(col("F-002"));
    expect(col("F-002")).toBeLessThan(col("F-003"));
    expect(col("F-003")).toBeLessThan(col("F-004"));
    expect(col("F-004")).toBeLessThan(col("F-005"));
    // The return arrow F-006 -> F-002 does not push F-002 to the right of F-006.
    expect(col("F-006")).toBeGreaterThan(col("F-002"));
    expect(layout.bands.map((b) => b.key)).toEqual(["L-001", "L-002"]);
    for (const s of layout.steps) {
      const band = layout.bands.find((b) => b.key === s.band)!;
      expect(s.cy).toBeGreaterThanOrEqual(band.y);
      expect(s.cy).toBeLessThanOrEqual(band.y + band.height);
    }
    expect(layout.byId.get("F-004")!.band).toBe("L-002");
  });

  it("flags the loop and draws every arrow between the shapes' boundaries", () => {
    const layout = layoutFlow(doc());
    expect(layout.edges).toHaveLength(7);
    const back = layout.edges.filter((e) => e.back);
    expect(back.map((e) => e.key)).toEqual(["F-006->F-002"]);
    for (const e of layout.edges) {
      const from = layout.byId.get(e.from)!;
      const to = layout.byId.get(e.to)!;
      // The tip is on the boundary of the target, and not inside the source.
      const tipIn = (n: typeof from, p: { x: number; y: number }, k: number) => {
        const c = centerOf(n);
        const len = Math.hypot(p.x - c.x, p.y - c.y);
        return nodeContains(n, { x: c.x + ((p.x - c.x) / len) * (len + k), y: c.y + ((p.y - c.y) / len) * (len + k) });
      };
      expect(tipIn(to, e.geometry.end, -0.05)).toBe(true);
      expect(tipIn(to, e.geometry.end, 0.05)).toBe(false);
      expect(tipIn(from, e.geometry.start, -0.05)).toBe(true);
      expect(tipIn(from, e.geometry.start, 0.05)).toBe(false);
      // Every segment is horizontal or vertical.
      const pts = e.geometry.points;
      for (let i = 1; i < pts.length; i++) {
        expect(Math.min(Math.abs(pts[i].x - pts[i - 1].x), Math.abs(pts[i].y - pts[i - 1].y))).toBeLessThan(1e-6);
      }
    }
    // The loop goes under both boxes rather than through the steps between.
    const loop = back[0];
    const lowest = Math.max(layout.byId.get("F-006")!.y + layout.byId.get("F-006")!.height, layout.byId.get("F-002")!.y + layout.byId.get("F-002")!.height);
    expect(Math.max(...loop.geometry.points.map((p) => p.y))).toBeGreaterThan(lowest);
  });

  it("gives a decision a diamond big enough for its text, and terminators a pill", () => {
    const layout = layoutFlow(doc());
    expect(layout.byId.get("F-003")!.shape).toBe("diamond");
    expect(layout.byId.get("F-001")!.shape).toBe("pill");
    expect(layout.byId.get("F-005")!.shape).toBe("pill");
    expect(layout.byId.get("F-002")!.shape).toBe("rect");
    // The title's box fits inside the diamond.
    const d = layout.byId.get("F-003")!;
    expect(d.width).toBeGreaterThan(layout.byId.get("F-002")!.width);
  });

  it("uses @x,y: x absolute, y from the lane's middle, kept inside the lane", () => {
    const d = doc();
    const free = layoutFlow(d);
    const f4 = free.byId.get("F-004")!;
    const band = free.bands.find((b) => b.key === "L-002")!;
    const moved = layoutFlow(patchStep(d, "F-004", { x: 900, y: 10 }));
    const m = moved.byId.get("F-004")!;
    expect(m.cx).toBe(900);
    expect(m.cy).toBe(band.y + band.height / 2 + 10);
    expect(m.placed).toBe(true);
    // Far outside the lane: clamped to it.
    const far = layoutFlow(patchStep(d, "F-004", { x: 900, y: 5000 })).byId.get("F-004")!;
    expect(far.cy + far.height / 2).toBeLessThanOrEqual(band.y + band.height);
    // Moving one step leaves every other where the layout put it.
    for (const s of free.steps) {
      if (s.id === "F-004") continue;
      expect(moved.byId.get(s.id)!.cx).toBe(s.cx);
      expect(moved.byId.get(s.id)!.cy).toBe(s.cy);
    }
    expect(f4.placed).toBe(false);
  });

  it("shows steps with no lane, or a lane that is gone, in the unassigned band", () => {
    const d = parseFlow("## Lanes\n\n- L-001 a\n\n## Steps\n\n- F-001 x lane:L-001\n- F-002 y\n- F-003 z lane:L-404\n");
    const layout = layoutFlow(d, [], { unassignedLabel: "未割当" });
    expect(layout.bands.map((b) => [b.key, b.title])).toEqual([
      ["L-001", "a"],
      [UNASSIGNED, "未割当"],
    ]);
    expect(layout.byId.get("F-002")!.band).toBe(UNASSIGNED);
    expect(layout.byId.get("F-003")!.band).toBe(UNASSIGNED);
  });

  it("has one headerless band when there are no lanes, and no unassigned band when none is needed", () => {
    const bare = layoutFlow(parseFlow("## Steps\n\n- F-001 a\n- F-002 b\n\n## Edges\n\n- F-001 -> F-002\n"));
    expect(bare.bands).toHaveLength(1);
    expect(bare.bands[0].headerWidth).toBe(0);
    expect(bandHeaderText(bare.bands[0])).toBeNull();
    const empty = layoutFlow(parseFlow(""));
    expect(empty.bands).toHaveLength(1);
    const laned = layoutFlow(doc());
    expect(laned.bands.every((b) => b.headerWidth === HEADER_WIDTH)).toBe(true);
    expect(bandHeaderText(laned.bands[0])?.text).toBe("営業");
  });

  it("does not draw an arrow from a step to itself", () => {
    const d = parseFlow("## Steps\n\n- F-001 a\n\n## Edges\n\n- F-001 -> F-001\n");
    expect(layoutFlow(d).edges).toHaveLength(0);
  });

  it("places the label on the arrow and the stickies on their steps", () => {
    const d = doc();
    const layout = layoutFlow(d, [{ id: "S-001", targetId: "F-004", dx: 40, dy: -20, text: "要確認" }]);
    const yes = layout.edges.find((e) => e.key === "F-003->F-004")!;
    expect(yes.labelBox).toBeDefined();
    expect(yes.labelBox!.x + yes.labelBox!.width / 2).toBeCloseTo(yes.geometry.mid.x, 6);
    expect(layout.stickies).toHaveLength(1);
    expect(layout.bounds.width).toBeGreaterThan(0);
  });

  it("finds the band at a y, clamped to the ends", () => {
    const layout = layoutFlow(doc());
    expect(layout.bandAt(-1000).key).toBe("L-001");
    expect(layout.bandAt(1e6).key).toBe("L-002");
    const second = layout.bands[1];
    expect(layout.bandAt(second.y + 1).key).toBe("L-002");
  });
});

describe("flow edits", () => {
  it("moving a step to another lane rewrites lane: and zeroes y", () => {
    const d = doc();
    const layout = layoutFlow(d);
    const second = layout.bands[1];
    const moved = moveStepTo(d, layout, "F-002", 700.4, second.y + second.height / 2 + 30);
    expect(moved.steps.find((s) => s.id === "F-002")).toMatchObject({ lane: "L-002", x: 700, y: 0 });
    // And the file says so.
    const out = serializeFlow(NOTE, moved, "2026-10-10");
    expect(out).toContain("- F-002 見積を作る lane:L-002 @700,0");
    // Other steps are untouched: still no @.
    expect(out).toContain("- F-001 受注 ^start lane:L-001\n");
  });

  it("moving within the lane writes only @, with y from the lane's middle", () => {
    const d = doc();
    const layout = layoutFlow(d);
    const band = layout.bands[0];
    const moved = moveStepTo(d, layout, "F-002", 500, band.y + band.height / 2 - 15);
    expect(moved.steps.find((s) => s.id === "F-002")).toMatchObject({ lane: "L-001", x: 500, y: -15 });
  });

  it("dropping on the unassigned band removes lane:", () => {
    const d = parseFlow("## Lanes\n\n- L-001 a\n\n## Steps\n\n- F-001 x lane:L-001\n- F-002 y\n");
    const layout = layoutFlow(d);
    const un = layout.bands.find((b) => b.key === UNASSIGNED)!;
    const moved = moveStepTo(d, layout, "F-001", 300, un.y + un.height / 2);
    expect(moved.steps[0].lane).toBeUndefined();
    expect(serializeFlow("", moved, "2026-10-10")).toContain("- F-001 x @300,0");
  });

  it("nudges within the band", () => {
    const d = doc();
    const layout = layoutFlow(d);
    const f = layout.byId.get("F-002")!;
    const next = nudgeStep(d, layout, "F-002", 8, 4);
    const s = next.steps.find((x) => x.id === "F-002")!;
    expect(s.x).toBe(Math.round(f.cx + 8));
    expect(s.y).toBe(4);
  });

  it("auto-align removes every @ and nothing else", () => {
    const d = patchStep(patchStep(doc(), "F-001", { x: 10, y: 0 }), "F-002", { x: 30, y: 5 });
    const out = autoAlign(d);
    expect(out.steps.every((s) => s.x === undefined && s.y === undefined)).toBe(true);
    expect(out.steps[0]).toMatchObject({ id: "F-001", kind: "start", lane: "L-001" });
    expect(serializeFlow(NOTE, out, "2026-10-10")).not.toContain("@");
  });

  it("deleting a step takes its arrows and stickies; ids are not reused", () => {
    const d: FlowDocModel = {
      ...doc(),
      stickies: [{ id: "S-001", targetId: "F-004", dx: 1, dy: 2, text: "x" }],
    };
    const out = deleteStep(d, "F-004");
    expect(out.steps.map((s) => s.id)).not.toContain("F-004");
    expect(out.edges.some((e) => e.from === "F-004" || e.to === "F-004")).toBe(false);
    expect(out.stickies).toEqual([]);
    expect(addStep(out, {}).id).toBe("F-007");
  });

  it("adds a step with or without a position", () => {
    const { doc: a, id } = addStep(doc(), { lane: "L-002", x: 400.2, y: -3 });
    expect(id).toBe("F-007");
    expect(a.steps[a.steps.length - 1]).toMatchObject({ lane: "L-002", x: 400, y: -3, kind: "process" });
    const { doc: b } = addStep(doc(), {});
    expect(b.steps[b.steps.length - 1].x).toBeUndefined();
  });

  it("adds, reorders and deletes lanes", () => {
    const d = doc();
    const { doc: withLane, id } = addLane(d, "法務");
    expect(id).toBe("L-003");
    const up = moveLane(withLane, "L-003", -1);
    expect(up.lanes.map((l) => l.id)).toEqual(["L-001", "L-003", "L-002"]);
    expect(moveLane(withLane, "L-001", -1)).toBe(withLane);
    const del = deleteLane(patchStep(d, "F-004", { x: 100, y: 20 }), "L-002");
    expect(del.lanes.map((l) => l.id)).toEqual(["L-001"]);
    const f4 = del.steps.find((s) => s.id === "F-004")!;
    expect(f4.lane).toBeUndefined();
    expect(f4.y).toBe(0);
    expect(layoutFlow(del).byId.get("F-004")!.band).toBe(UNASSIGNED);
  });

  it("connects and reattaches arrows", () => {
    const d = doc();
    const joined = connect(d, "F-001", "F-005");
    expect(joined.edges).toHaveLength(8);
    expect(connect(joined, "F-001", "F-005")).toBe(joined);
    const re = reattach(d, { from: "F-003", to: "F-004" }, "to", "F-006");
    expect(re.edges.find((e) => e.from === "F-003" && e.to === "F-006")?.label).toBe("はい");
    expect(reattach(d, { from: "F-003", to: "F-004" }, "to", "F-004")).toBe(d);
  });

  it("an arrow dragged onto a pair that exists merges into it", () => {
    const d = doc();
    const re = reattach(d, { from: "F-003", to: "F-004" }, "to", "F-005");
    expect(re.edges.filter((e) => e.from === "F-003" && e.to === "F-005")).toHaveLength(1);
    expect(re.edges).toHaveLength(d.edges.length - 1);
  });
});

describe("boundaryPoint on a laid-out flow", () => {
  it("meets the diamond at its vertex for the straight-ahead branch", () => {
    const layout = layoutFlow(doc());
    const d = layout.byId.get("F-003")!;
    const p = boundaryPoint(d, { x: d.cx + 1000, y: d.cy });
    expect(p.x).toBeCloseTo(d.cx + d.width / 2, 3);
  });
});
