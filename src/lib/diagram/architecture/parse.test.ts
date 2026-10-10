import { describe, expect, it } from "vitest";
import {
  formatEdge,
  formatFrame,
  formatNode,
  nextFrameId,
  nextNodeId,
  parseArchitecture,
  serializeArchitecture,
  warningCount,
  type ArchitectureDocModel,
} from "./parse";

const NOTE = `---
type: architecture
title: Booking
created: 2026-10-10
updated: 2026-10-10
---

## Frames

- G-001 Client #blue
  Who uses it.
- G-002 Server #green

## Nodes

- C-001 User ^user
- C-002 Screen frame:G-001
  Hover memo.
- C-003 Check frame:G-001 ^round
- C-004 API frame:G-002 task:T-0100
- C-005 DB frame:G-002 ^db @640,260
- C-006 Mailer ^cloud icon:mail

## Edges

- C-001 -> C-002 "Uses"
- C-002 -> C-003
- C-003 <-> C-004 "HTTPS"
- C-004 -> C-005 "Saves"
- C-004 -> C-006 "Notifies"

## Stickies

- S-001 node:G-002 @40,-30 #amber What stack?

## Memo

Do not touch.
`;

const docOf = () => parseArchitecture(NOTE, "Booking");

describe("parseArchitecture", () => {
  it("reads frames, blocks and arrows from the design's example", () => {
    const doc = docOf();
    expect(doc.title).toBe("Booking");
    expect(doc.frames.map((f) => [f.id, f.title, f.color])).toEqual([
      ["G-001", "Client", "blue"],
      ["G-002", "Server", "green"],
    ]);
    expect(doc.frames[0].note).toBe("Who uses it.");
    expect(doc.nodes.map((n) => [n.id, n.title, n.kind, n.frame])).toEqual([
      ["C-001", "User", "user", undefined],
      ["C-002", "Screen", "block", "G-001"],
      ["C-003", "Check", "round", "G-001"],
      ["C-004", "API", "block", "G-002"],
      ["C-005", "DB", "db", "G-002"],
      ["C-006", "Mailer", "cloud", undefined],
    ]);
    expect(doc.nodes[1].note).toBe("Hover memo.");
    expect(doc.nodes[3].task).toBe("T-0100");
    expect(doc.nodes[4].x).toBe(640);
    expect(doc.nodes[4].y).toBe(260);
    expect(doc.nodes[5].icon).toBe("mail");
    expect(doc.edges).toEqual([
      { from: "C-001", to: "C-002", bidi: false, label: "Uses" },
      { from: "C-002", to: "C-003", bidi: false },
      { from: "C-003", to: "C-004", bidi: true, label: "HTTPS" },
      { from: "C-004", to: "C-005", bidi: false, label: "Saves" },
      { from: "C-004", to: "C-006", bidi: false, label: "Notifies" },
    ]);
    expect(doc.stickies).toHaveLength(1);
    expect(doc.stickies[0].targetId).toBe("G-002");
    expect(warningCount(doc)).toBe(0);
  });

  it("reads modifiers in any order, and keeps what it does not know in the title", () => {
    const doc = parseArchitecture(`---
type: architecture
title: t
---

## Frames

## Nodes

- C-007 Box @10,20 ^db #red task:T-1 ^queue frame:G-009 #nope

## Edges

## Stickies
`);
    expect(doc.nodes).toHaveLength(1);
    const n = doc.nodes[0];
    expect(n.id).toBe("C-007");
    expect(n.kind).toBe("db");
    expect(n.task).toBe("T-1");
    expect(n.frame).toBe("G-009");
    expect(n.color).toBe("red");
    expect(n.x).toBe(10);
    expect(n.y).toBe(20);
    // An unknown mark and an unknown color stay in the title.
    expect(n.title).toBe("Box ^queue #nope");
  });

  it("keeps a block in a missing frame, and the reference verbatim", () => {
    const doc = docOf();
    const db = doc.nodes.find((n) => n.id === "C-005")!;
    expect(db.frame).toBe("G-002");
    const out = serializeArchitecture(NOTE, doc, "2026-10-10");
    expect(out).toContain("- C-005 DB frame:G-002 ^db @640,260");
  });

  it("keeps a frame's parent and a block's icon, and writes them back", () => {
    const doc = parseArchitecture(`---
type: architecture
title: t
---

## Frames

- G-001 Inner frame:G-002 #blue

## Nodes

- C-001 Box icon:server

## Edges

## Stickies
`);
    expect(doc.frames[0].parent).toBe("G-002");
    expect(doc.nodes[0].icon).toBe("server");
    const out = serializeArchitecture(
      `---\ntype: architecture\ntitle: t\n---\n\n## Frames\n\n- x\n\n## Nodes\n\n- x\n\n## Edges\n\n## Stickies\n`,
      doc,
      "2026-10-10",
    );
    expect(out).toContain("- G-001 Inner frame:G-002 #blue");
    expect(out).toContain("- C-001 Box icon:server");
  });

  it("treats A -> B and B -> A as two lines, and a second line for one pair as raw", () => {
    const doc = parseArchitecture(`---
type: architecture
title: t
---

## Frames

## Nodes

- C-001 A
- C-002 B

## Edges

- C-001 -> C-002 "First"
- C-002 -> C-001 "Back"
- C-002 -> C-001 "Again"
- C-001 <-> C-002 "Both"

## Stickies
`);
    expect(doc.edges).toEqual([
      { from: "C-001", to: "C-002", bidi: false, label: "First" },
      { from: "C-002", to: "C-001", bidi: false, label: "Back" },
    ]);
    expect(doc.rawEdges).toEqual(['- C-002 -> C-001 "Again"', '- C-001 <-> C-002 "Both"']);
    expect(warningCount(doc)).toBe(2);
  });

  it("keeps arrows to nowhere, self arrows as edges, and -- lines as raw", () => {
    const doc = parseArchitecture(`---
type: architecture
title: t
---

## Frames

## Nodes

- C-001 A

## Edges

- C-001 -> C-009
- C-001 -> C-001
- C-001 -- C-001

## Stickies
`);
    expect(doc.edges).toEqual([{ from: "C-001", to: "C-001", bidi: false }]);
    expect(doc.rawEdges).toEqual(["- C-001 -> C-009", "- C-001 -- C-001"]);
  });

  it("keeps another kind's lines as raw, and mints ids for bare lines", () => {
    const doc = parseArchitecture(`---
type: architecture
title: t
---

## Frames

- G-001 Known
- F-001 Another kind

## Nodes

- Bare block
- C-001 Known

## Edges

## Stickies
`);
    expect(doc.rawFrames).toEqual(["- F-001 Another kind"]);
    expect(doc.frames.map((f) => f.id)).toEqual(["G-001"]);
    expect(doc.nodes.map((n) => n.id)).toEqual(["C-002", "C-001"]);
    expect(doc.mintedIds).toBe(true);
    expect(nextNodeId(doc.nodes)).toBe("C-003");
    expect(nextFrameId(doc.frames)).toBe("G-002");
  });

  it("round-trips the example byte-for-byte apart from the date stamp", () => {
    const out = serializeArchitecture(NOTE, docOf(), "2026-10-11");
    expect(out).toBe(NOTE.replace("updated: 2026-10-10", "updated: 2026-10-11"));
  });

  it("keeps ## Memo, unknown sections and raw lines where they were", () => {
    const doc = docOf();
    const out = serializeArchitecture(NOTE, doc, "2026-10-10");
    expect(out).toContain("## Memo\n\nDo not touch.\n");
  });

  it("counts stray stickies, but accepts frames as targets", () => {
    const doc = docOf();
    expect(warningCount(doc)).toBe(0);
    const stray: ArchitectureDocModel = {
      ...doc,
      stickies: [...doc.stickies, { id: "S-009", targetId: "C-009", dx: 0, dy: 0, text: "x" }],
    };
    expect(warningCount(stray)).toBe(1);
  });
});

describe("formatting", () => {  it("writes a frame with its parent and color, and a node with frame before mark", () => {
    expect(formatFrame({ id: "G-001", title: "Client", parent: "G-002", color: "blue" })).toEqual([
      "- G-001 Client frame:G-002 #blue",
    ]);
    expect(
      formatNode({
        id: "C-005",
        title: "DB",
        kind: "db",
        frame: "G-002",
        x: 640,
        y: 260,
      }),
    ).toEqual(["- C-005 DB frame:G-002 ^db @640,260"]);
    expect(formatEdge({ from: "C-003", to: "C-004", bidi: true, label: "HTTPS" })).toBe(
      '- C-003 <-> C-004 "HTTPS"',
    );
  });
});

describe("edge ports (T-0712)", () => {
  const PORTS = `---
type: architecture
title: t
---

## Frames

## Nodes

- C-001 A
- C-002 B
- C-003 C

## Edges

- C-001:E@0.5 -> C-002:W "Pinned"
- C-001:N -> C-003
- C-003:S@2 -> C-001

## Stickies
`;

  it("reads pinned sides and ratios, clamping the ratio", () => {
    const doc = parseArchitecture(PORTS);
    expect(doc.edges).toEqual([
      {
        from: "C-001",
        to: "C-002",
        bidi: false,
        label: "Pinned",
        fromPort: { side: "E", at: 0.5 },
        toPort: { side: "W" },
      },
      { from: "C-001", to: "C-003", bidi: false, fromPort: { side: "N" } },
      { from: "C-003", to: "C-001", bidi: false, fromPort: { side: "S", at: 1 } },
    ]);
    expect(doc.rawEdges).toEqual([]);
    expect(warningCount(doc)).toBe(0);
  });

  it("keeps an unknown side as a raw line", () => {
    const doc = parseArchitecture(`---
type: architecture
title: t
---

## Frames

## Nodes

- C-001 A
- C-002 B

## Edges

- C-001:X -> C-002

## Stickies
`);
    expect(doc.edges).toEqual([]);
    expect(doc.rawEdges).toEqual(["- C-001:X -> C-002"]);
  });

  it("ignores pins for edge identity: one pair is one edge", () => {
    const doc = parseArchitecture(`---
type: architecture
title: t
---

## Frames

## Nodes

- C-001 A
- C-002 B

## Edges

- C-001:E -> C-002:W
- C-001 -> C-002

## Stickies
`);
    expect(doc.edges).toHaveLength(1);
    expect(doc.rawEdges).toHaveLength(1);
  });

  it("writes pins back, trimming the ratio", () => {
    expect(
      formatEdge({ from: "C-001", to: "C-002", bidi: false, fromPort: { side: "E", at: 0.5 } }),
    ).toBe("- C-001:E@0.5 -> C-002");
    expect(formatEdge({ from: "C-001", to: "C-002", bidi: false, toPort: { side: "W" } })).toBe(
      "- C-001 -> C-002:W",
    );
    const doc = parseArchitecture(PORTS);
    const out = serializeArchitecture(PORTS, doc, "2026-10-10");
    expect(out).toContain("- C-001:E@0.5 -> C-002:W");
    expect(out).toContain("- C-001:N -> C-003");
    expect(out).toContain("- C-003:S@1 -> C-001");
    // A second read gives the same model back.
    expect(parseArchitecture(out).edges).toEqual(doc.edges);
  });
});
