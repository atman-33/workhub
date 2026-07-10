import { describe, expect, it } from "vitest";
import { computeGraphLayout, PALETTE } from "./gitGraph";

describe("computeGraphLayout", () => {
  it("keeps a linear history in a single column with straight edges", () => {
    const rows = computeGraphLayout([
      { hash: "c1", parents: ["c2"] },
      { hash: "c2", parents: ["c3"] },
      { hash: "c3", parents: [] },
    ]);

    expect(rows.map((r) => r.column)).toEqual([0, 0, 0]);
    expect(rows.map((r) => r.color)).toEqual([
      PALETTE[0],
      PALETTE[0],
      PALETTE[0],
    ]);
    expect(rows.map((r) => r.maxCol)).toEqual([0, 0, 0]);

    // every edge in a linear history is a straight vertical line
    for (const row of rows) {
      for (const e of [...row.edgesTop, ...row.edgesBottom]) {
        expect(e.fromCol).toBe(e.toCol);
        expect(e.color).toBe(PALETTE[0]);
      }
    }

    // root commit has no bottom edges, tip has no top edges
    expect(rows[0].edgesTop).toEqual([]);
    expect(rows[2].edgesBottom).toEqual([]);
  });

  it("curves a feature-branch merge back into main and frees its lane", () => {
    // m1 = merge commit (main tip), m2 = main parent, f1 = feature tip,
    // base = common ancestor / root.
    const rows = computeGraphLayout([
      { hash: "m1", parents: ["m2", "f1"] },
      { hash: "m2", parents: ["base"] },
      { hash: "f1", parents: ["base"] },
      { hash: "base", parents: [] },
    ]);
    const [m1, m2, f1, base] = rows;

    // m1 allocates col0 (dot) and a new col1 for the merged-in feature parent.
    expect(m1.column).toBe(0);
    expect(m1.color).toBe(PALETTE[0]);
    expect(m1.edgesBottom).toEqual(
      expect.arrayContaining([
        { fromCol: 0, toCol: 0, color: PALETTE[0] },
        { fromCol: 0, toCol: 1, color: PALETTE[1] },
      ]),
    );

    // m2 continues main's lane in column 0.
    expect(m2.column).toBe(0);
    expect(m2.color).toBe(PALETTE[0]);

    // f1 continues the feature lane in column 1 — color stable along branch.
    expect(f1.column).toBe(1);
    expect(f1.color).toBe(PALETTE[1]);

    // both branches converge on `base`; column 1's incoming curves into
    // column 0 and is released (freed) there.
    expect(base.column).toBe(0);
    expect(base.color).toBe(PALETTE[0]);
    expect(base.edgesTop).toEqual(
      expect.arrayContaining([
        { fromCol: 0, toCol: 0, color: PALETTE[0] },
        { fromCol: 1, toCol: 0, color: PALETTE[1] },
      ]),
    );
    expect(base.edgesBottom).toEqual([]); // root: lane closes
  });

  it("handles a criss-cross merge (two lanes converge on the same ancestor twice)", () => {
    // T merges A2 and B2; A2 and B2 are criss-crossing merges that both
    // eventually depend on A1/B1, which both depend on root R.
    const rows = computeGraphLayout([
      { hash: "T", parents: ["A2", "B2"] },
      { hash: "A2", parents: ["A1", "B1"] },
      { hash: "B2", parents: ["B1", "A1"] },
      { hash: "A1", parents: ["R"] },
      { hash: "B1", parents: ["R"] },
      { hash: "R", parents: [] },
    ]);
    const byHash = Object.fromEntries(rows.map((r) => [r.hash, r]));

    expect(byHash.T.column).toBe(0);
    expect(byHash.A2.column).toBe(0);
    expect(byHash.A2.color).toBe(PALETTE[0]);

    // B2's extra parent (B1) is a genuinely new lane (col2).
    expect(byHash.A2.edgesBottom).toEqual(
      expect.arrayContaining([{ fromCol: 0, toCol: 2, color: PALETTE[2] }]),
    );

    // B2 sits in column 1 (created by T's merge) and its extra parent (A1)
    // joins the *existing* lane in column 0 rather than allocating a new one.
    expect(byHash.B2.column).toBe(1);
    expect(byHash.B2.color).toBe(PALETTE[1]);
    expect(byHash.B2.edgesBottom).toEqual(
      expect.arrayContaining([{ fromCol: 1, toCol: 0, color: PALETTE[0] }]),
    );

    // By the time B1 is reached, two lanes (col1 and col2) are both waiting
    // on it — both curve/straight into the min column (1).
    expect(byHash.B1.column).toBe(1);
    expect(byHash.B1.edgesTop).toEqual(
      expect.arrayContaining([
        { fromCol: 1, toCol: 1, color: PALETTE[1] },
        { fromCol: 2, toCol: 1, color: PALETTE[2] },
      ]),
    );

    // R is the shared root and closes with no bottom edges.
    expect(byHash.R.edgesBottom).toEqual([]);
  });

  it("gives two independent roots their own coexisting columns", () => {
    const rows = computeGraphLayout([
      { hash: "A", parents: ["Aroot"] },
      { hash: "B", parents: ["Broot"] },
      { hash: "Aroot", parents: [] },
      { hash: "Broot", parents: [] },
    ]);
    const [a, b, aroot, broot] = rows;

    expect(a.column).toBe(0);
    expect(a.color).toBe(PALETTE[0]);
    // B opens a second lane while A's is still active.
    expect(b.column).toBe(1);
    expect(b.color).toBe(PALETTE[1]);

    expect(aroot.column).toBe(0);
    expect(aroot.color).toBe(PALETTE[0]);
    // Aroot's own lane (col0) closes here; B's unrelated lane (col1) is
    // still open and simply passes straight through this row.
    expect(aroot.edgesBottom).toEqual([
      { fromCol: 1, toCol: 1, color: PALETTE[1] },
    ]);

    expect(broot.column).toBe(1);
    expect(broot.color).toBe(PALETTE[1]);
    expect(broot.edgesBottom).toEqual([]);
  });

  it("reuses a freed column's index for a later, unrelated branch", () => {
    const rows = computeGraphLayout([
      { hash: "c1", parents: ["c2"] },
      { hash: "c2", parents: [] }, // closes column 0
      { hash: "c3", parents: [] }, // new root, should reuse column 0
    ]);
    const [c1, c2, c3] = rows;

    expect(c1.column).toBe(0);
    expect(c2.column).toBe(0);
    expect(c2.color).toBe(PALETTE[0]);

    expect(c3.column).toBe(0); // freed index 0 is reused
    expect(c3.color).toBe(PALETTE[1]); // but gets a fresh color
  });

  it("allocates a new lane when a merge's second parent has not been seen yet", () => {
    const rows = computeGraphLayout([
      { hash: "m", parents: ["p1", "p2"] },
      { hash: "p1", parents: [] },
      { hash: "p2", parents: [] },
    ]);
    const [m] = rows;

    expect(m.column).toBe(0);
    expect(m.edgesBottom).toEqual(
      expect.arrayContaining([
        { fromCol: 0, toCol: 0, color: PALETTE[0] },
        { fromCol: 0, toCol: 1, color: PALETTE[1] },
      ]),
    );
  });
});
