import { describe, expect, it } from "vitest";
import { copyArchitectureNodes, pasteArchitectureNodes } from "./clipboard";
import { layoutArchitecture, measureBlock, nodeTextY } from "./layout";
import { parseArchitecture } from "./parse";

const NOTE = `---
type: architecture
title: Booking
created: 2026-10-10
updated: 2026-10-10
---

## Frames

- G-001 Client #blue
- G-002 Server #green

## Nodes

- C-001 User ^user
- C-002 Screen frame:G-001
- C-003 Check frame:G-001 ^round
- C-004 API frame:G-002
- C-005 DB frame:G-002 ^db
- C-006 Mailer ^cloud

## Edges

- C-001 -> C-002 "Uses"
- C-002 -> C-003
- C-003 <-> C-004 "HTTPS"
- C-004 -> C-005 "Saves"
- C-004 -> C-006 "Notifies"

## Stickies

- S-001 node:G-002 @40,-30 #amber What stack?
`;

const docOf = () => parseArchitecture(NOTE);

describe("measureBlock", () => {
  it("gives every kind at least the minimal block, with its text inside", () => {
    for (const kind of ["block", "round", "db", "user", "cloud"]) {
      const m = measureBlock("API", kind);
      expect(m.width).toBeGreaterThanOrEqual(112);
      expect(m.height).toBeGreaterThanOrEqual(52);
      expect(m.lines).toEqual(["API"]);
    }
  });

  it("grows a database by its lids and a cloud beyond its text", () => {
    const title = "A much longer block title that wraps";
    const plain = measureBlock(title, "block");
    const db = measureBlock(title, "db");
    expect(db.width).toBe(plain.width);
    expect(db.height).toBeGreaterThan(plain.height);
    const cloud = measureBlock(title, "cloud");
    expect(cloud.width).toBeGreaterThan(plain.width);
    expect(cloud.height).toBeGreaterThan(plain.height);
  });

  it("stacks a person's icon above its name", () => {
    const m = measureBlock("Somebody", "user");
    expect(m.height).toBeGreaterThan(44);
  });
});

describe("layoutArchitecture", () => {
  it("frames every member with margin and header, in file order after the ungrouped", () => {
    const layout = layoutArchitecture(docOf());
    expect(layout.frames.map((f) => f.id)).toEqual(["G-001", "G-002"]);
    const g1 = layout.frameById.get("G-001")!;
    const members = layout.nodes.filter((n) => n.frame === "G-001");
    expect(members.length).toBe(2);
    expect(g1.x).toBeLessThan(Math.min(...members.map((n) => n.x)) - 19);
    expect(g1.y).toBeLessThan(Math.min(...members.map((n) => n.y)) - 47);
    expect(g1.x + g1.width).toBeGreaterThan(Math.max(...members.map((n) => n.x + n.width)) + 19);
    expect(g1.y + g1.height).toBeGreaterThan(
      Math.max(...members.map((n) => n.y + n.height)) + 19,
    );
    // The ungrouped user stands left of every frame.
    const user = layout.byId.get("C-001")!;
    expect(user.frame).toBeUndefined();
    expect(user.x + user.width).toBeLessThanOrEqual(g1.x);
  });

  it("pins a block by hand without moving the rest", () => {
    const plain = layoutArchitecture(docOf());
    const pinned = layoutArchitecture(docOf(), [], { pinned: [{ id: "C-004", cx: 900, cy: 100 }] });
    expect(pinned.byId.get("C-004")).toMatchObject({ cx: 900, cy: 100, placed: true });
    for (const n of plain.nodes) {
      if (n.id === "C-004") continue;
      const p = pinned.byId.get(n.id)!;
      expect([p.cx, p.cy]).toEqual([n.cx, n.cy]);
    }
  });

  it("draws a head at each end of a two-way arrow, and none for a block to itself", () => {
    const layout = layoutArchitecture(docOf());
    const bidi = layout.edges.find((e) => e.bidi)!;
    expect(bidi.from).toBe("C-003");
    expect(bidi.geometry.headAngle).toBeDefined();
    expect(bidi.startAngle).toBeCloseTo(Math.atan2(
      bidi.geometry.points[0].y - bidi.geometry.points[1].y,
      bidi.geometry.points[0].x - bidi.geometry.points[1].x,
    ), 10);
    const loop = layoutArchitecture({
      frames: [],
      nodes: [{ id: "C-001", title: "A", kind: "block" }],
      edges: [{ from: "C-001", to: "C-001", bidi: false }],
    });
    expect(loop.edges).toEqual([]);
  });

  it("puts the label at the middle of its arrow, and every arrow end on an outline", () => {
    const layout = layoutArchitecture(docOf());
    for (const e of layout.edges) {
      const g = e.geometry;
      if (e.label) {
        expect(e.labelBox).toBeDefined();
        expect(e.labelBox!.x + e.labelBox!.width / 2).toBeCloseTo(g.mid.x, 5);
        expect(e.labelBox!.y + e.labelBox!.height / 2).toBeCloseTo(g.mid.y, 5);
      }
      // Every segment is horizontal or vertical.
      g.points.slice(1).forEach((q, i) => {
        const p = g.points[i];
        expect(p.x === q.x || p.y === q.y).toBe(true);
      });
    }
  });

  it("places a sticky on its frame, and drops one whose target is gone", () => {
    const layout = layoutArchitecture(docOf(), docOf().stickies);
    expect(layout.stickies).toHaveLength(1);
    const frame = layout.frameById.get("G-002")!;
    const s = layout.stickies[0];
    expect(s.x).toBeCloseTo(frame.x + frame.width / 2 + 40, 5);
    const dropped = layoutArchitecture(docOf(), [
      { id: "S-009", targetId: "C-009", dx: 0, dy: 0, text: "x" },
    ]);
    expect(dropped.stickies).toEqual([]);
  });

  it("centres every title, and a person's name under its icon", () => {
    const layout = layoutArchitecture(docOf());
    for (const n of layout.nodes) {
      const y0 = nodeTextY(n, 0);
      expect(y0).toBeGreaterThan(n.y);
      expect(y0).toBeLessThan(n.y + n.height);
    }
    const user = layout.byId.get("C-001")!;
    expect(nodeTextY(user, 0)).toBeGreaterThan(user.y + 44);
  });
});

describe("architecture clipboard", () => {
  it("copies blocks with their frames, and pastes them under fresh ids", () => {
    const placed = {
      ...docOf(),
      nodes: docOf().nodes.map((n) => ({ ...n, x: 10, y: 20 })),
    };
    const clip = copyArchitectureNodes(placed, ["C-002", "C-003"]);
    expect(clip.nodes.map((n) => n.id)).toEqual(["C-002", "C-003"]);
    expect(clip.nodes[0].frame).toBe("G-001");
    expect(clip.edges).toEqual([{ from: "C-002", to: "C-003", bidi: false }]);
    const pasted = pasteArchitectureNodes(placed, clip, 2);
    expect(pasted.ids).toEqual(["C-007", "C-008"]);
    expect(pasted.doc.nodes.find((n) => n.id === "C-007")).toMatchObject({
      frame: "G-001",
      x: 10 + 64,
      y: 20 + 64,
    });
    expect(pasted.doc.edges).toContainEqual({ from: "C-007", to: "C-008", bidi: false });
  });
});
