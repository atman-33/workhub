import { describe, expect, it } from "vitest";
import {
  EMPTY_GROUP_HEIGHT,
  EMPTY_GROUP_WIDTH,
  GROUP_ROW_GAP,
  groupRowLayout,
  type GroupNodeInput,
  type RankEdge,
} from "./graph-layout";

const node = (id: string, group: string | null, width = 112, height = 52): GroupNodeInput => ({
  id,
  width,
  height,
  group,
});

const centresOf = (result: ReturnType<typeof groupRowLayout>) =>
  Object.fromEntries([...result.nodes].map(([id, p]) => [id, [p.cx, p.cy]]));

describe("groupRowLayout", () => {
  it("lays one group out by rank: columns are ranks, one row", () => {
    const edges: RankEdge[] = [{ from: "a", to: "b" }];
    const r = groupRowLayout([node("a", null), node("b", null)], edges, { groups: [] });
    expect(r.groups).toEqual([{ key: "", x: 0, y: 0, width: 280, height: 96 }]);
    expect(centresOf(r)).toEqual({ a: [56, 48], b: [224, 48] });
    expect(r.bounds).toEqual({ x: 0, y: 0, width: 280, height: 96 });
  });

  it("puts the ungrouped nodes first, then the frames, a gap apart", () => {
    const edges: RankEdge[] = [{ from: "u", to: "c" }]; // across groups: not used for ranking
    const r = groupRowLayout([node("u", null, 80, 40), node("c", "G-001")], edges, {
      groups: ["G-001"],
    });
    expect(GROUP_ROW_GAP).toBe(96);
    expect(r.groups).toEqual([
      { key: "", x: 0, y: 0, width: 80, height: 96 },
      { key: "G-001", x: 176, y: 0, width: 112, height: 96 },
    ]);
    expect(centresOf(r)).toEqual({ u: [40, 48], c: [232, 48] });
    expect(r.bounds).toEqual({ x: 0, y: 0, width: 288, height: 96 });
  });

  it("ranks inside each frame from its own arrows only", () => {
    const edges: RankEdge[] = [
      { from: "a", to: "b" },
      { from: "u", to: "b" },
    ];
    const r = groupRowLayout(
      [node("u", null, 80, 40), node("a", "G-001"), node("b", "G-001")],
      edges,
      { groups: ["G-001"] },
    );
    expect(r.groups).toEqual([
      { key: "", x: 0, y: 0, width: 80, height: 96 },
      { key: "G-001", x: 176, y: 0, width: 280, height: 96 },
    ]);
    expect(centresOf(r)).toEqual({ u: [40, 48], a: [232, 48], b: [400, 48] });
  });

  it("wraps a group that would pass the wrap width onto a new row", () => {
    const edges: RankEdge[] = [{ from: "a", to: "b" }];
    const r = groupRowLayout(
      [node("u", null, 80, 40), node("a", "G-001"), node("b", "G-001")],
      edges,
      { groups: ["G-001"], wrapWidth: 300 },
    );
    expect(r.groups).toEqual([
      { key: "", x: 0, y: 0, width: 80, height: 96 },
      { key: "G-001", x: 0, y: 192, width: 280, height: 96 },
    ]);
    expect(centresOf(r)).toEqual({ u: [40, 48], a: [56, 240], b: [224, 240] });
    expect(r.bounds).toEqual({ x: 0, y: 0, width: 280, height: 288 });
  });

  it("keeps an empty frame as a fixed minimal box, and draws no box for an empty ungrouped side", () => {
    const r = groupRowLayout([node("a", "G-001")], [], { groups: ["G-001", "G-002"] });
    expect(EMPTY_GROUP_WIDTH).toBe(160);
    expect(EMPTY_GROUP_HEIGHT).toBe(96);
    expect(r.groups).toEqual([
      { key: "G-001", x: 0, y: 0, width: 112, height: 96 },
      { key: "G-002", x: 208, y: 0, width: 160, height: 96 },
    ]);
    expect(centresOf(r)).toEqual({ a: [56, 48] });
    expect(r.bounds).toEqual({ x: 0, y: 0, width: 368, height: 96 });
  });

  it("counts an unknown group as ungrouped", () => {
    const r = groupRowLayout([node("x", "G-zzz", 80, 40)], [], { groups: ["G-001"] });
    expect(r.groups).toEqual([
      { key: "", x: 0, y: 0, width: 80, height: 96 },
      { key: "G-001", x: 176, y: 0, width: 160, height: 96 },
    ]);
    expect(centresOf(r)).toEqual({ x: [40, 48] });
  });

  it("is empty when nothing is placed", () => {
    const r = groupRowLayout([], [], { groups: [] });
    expect(r.groups).toEqual([]);
    expect(r.nodes.size).toBe(0);
    expect(r.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it("depends only on the input: the same input places the same centres", () => {
    const nodes = [node("u", null, 80, 40), node("a", "G-001"), node("b", "G-001")];
    const edges: RankEdge[] = [{ from: "a", to: "b" }];
    const first = groupRowLayout(nodes, edges, { groups: ["G-001"] });
    const second = groupRowLayout(nodes, edges, { groups: ["G-001"] });
    expect(centresOf(second)).toEqual(centresOf(first));
  });
});
