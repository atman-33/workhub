import { describe, expect, it } from "vitest";
import { applyPatch, deleteNodeWithEdges, deleteOrderedEdge, patchOrderedEdge } from "./ops-common";

const doc = () => ({
  nodes: [{ id: "A" }, { id: "B" }, { id: "C" }],
  edges: [
    { from: "A", to: "B", label: "x" },
    { from: "B", to: "A" },
    { from: "B", to: "C" },
  ],
  stickies: [{ targetId: "A" }, { targetId: "C" }, {}],
});

describe("ops-common", () => {
  it("applyPatch removes a key set to undefined and leaves its input alone", () => {
    const base = { a: 1, b: 2 };
    expect(applyPatch(base, { b: undefined })).toEqual({ a: 1 });
    expect(base).toEqual({ a: 1, b: 2 });
  });

  it("patchOrderedEdge touches only the arrow of that ordered pair", () => {
    const d = patchOrderedEdge(doc(), { from: "A", to: "B" }, { label: undefined });
    expect("label" in d.edges[0]).toBe(false);
    expect(d.edges[1]).toEqual({ from: "B", to: "A" });
    const same = patchOrderedEdge(doc(), { from: "C", to: "A" }, { label: "y" });
    expect(same.edges).toEqual(doc().edges);
  });

  it("deleteOrderedEdge removes the ordered pair only", () => {
    const d = deleteOrderedEdge(doc(), { from: "B", to: "A" });
    expect(d.edges.map((e) => e.from + e.to)).toEqual(["AB", "BC"]);
  });

  it("deleteNodeWithEdges takes the node's arrows and pinned stickies with it", () => {
    const d = deleteNodeWithEdges(doc(), "A");
    expect(d.nodes.map((n) => n.id)).toEqual(["B", "C"]);
    expect(d.edges).toEqual([{ from: "B", to: "C" }]);
    expect(d.stickies).toEqual([{ targetId: "C" }, {}]);
  });
});
