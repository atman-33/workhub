import { describe, expect, it } from "vitest";
import { parseAlgorithm, serializeAlgorithm } from "./algorithm/parse";
import { parseArchitecture, serializeArchitecture } from "./architecture/parse";
import { parseFlow, serializeFlow } from "./flow/parse";
import { parseIfdam, serializeIfdam } from "./ifdam/parse";
import { parsePfd, serializePfd } from "./pfd/parse";

/**
 * Pinned arrow ends (`A:E@0.5 -> B:W`, T-0712 / T-0718 / T-0719) read and write
 * the same way in every kind whose arrows carry ports. One table drives the
 * shared cases; what is particular to a kind (an unknown side kept as a raw
 * line, the architecture's ratio clamp and edge identity, ...) stays in that
 * kind's own `parse.test.ts`.
 */
interface Row {
  kind: string;
  note: string;
  parse: (note: string) => { edges: unknown[]; rawEdges: string[] };
  serialize: (source: string, doc: never, today: string) => string;
  /** The model the note reads as. */
  edges: unknown[];
  /** Lines the written note contains. */
  lines: string[];
}

const ROWS: Row[] = [
  {
    kind: "algorithm",
    note: `---
type: algorithm
title: t
---

## Nodes

- A-001 Start ^start
- A-002 Step
- A-003 End ^end

## Edges

- A-001:E@0.5 -> A-002:W "Go"
- A-002:N -> A-003

## Stickies
`,
    parse: parseAlgorithm,
    serialize: serializeAlgorithm as Row["serialize"],
    edges: [
      {
        from: "A-001",
        to: "A-002",
        label: "Go",
        fromPort: { side: "E", at: 0.5 },
        toPort: { side: "W" },
      },
      { from: "A-002", to: "A-003", fromPort: { side: "N" } },
    ],
    lines: ['- A-001:E@0.5 -> A-002:W "Go"', "- A-002:N -> A-003"],
  },
  {
    kind: "flow",
    note: `---
type: flow
title: t
---

## Lanes

- L-001 Team

## Steps

- F-001 First lane:L-001
- F-002 Second lane:L-001
- F-003 Third lane:L-001

## Edges

- F-001:E@0.5 -> F-002:W "Go"
- F-002:N -> F-003

## Stickies
`,
    parse: parseFlow,
    serialize: serializeFlow as Row["serialize"],
    edges: [
      {
        from: "F-001",
        to: "F-002",
        label: "Go",
        fromPort: { side: "E", at: 0.5 },
        toPort: { side: "W" },
      },
      { from: "F-002", to: "F-003", fromPort: { side: "N" } },
    ],
    lines: ['- F-001:E@0.5 -> F-002:W "Go"', "- F-002:N -> F-003"],
  },
  {
    kind: "pfd",
    note: `---
type: pfd
title: t
---

## Nodes

- P-001 A
- D-001 B
- D-002 C

## Edges

- P-001:E@0.5 -> D-001:W
- P-001:N -> D-002

## Stickies
`,
    parse: parsePfd,
    serialize: serializePfd as Row["serialize"],
    edges: [
      { from: "P-001", to: "D-001", fromPort: { side: "E", at: 0.5 }, toPort: { side: "W" } },
      { from: "P-001", to: "D-002", fromPort: { side: "N" } },
    ],
    lines: ["- P-001:E@0.5 -> D-001:W", "- P-001:N -> D-002"],
  },
  {
    kind: "ifdam",
    note: `---
type: ifdam
title: t
---

## Nodes

- V-001 Screen ^screen
  show: Item
- V-002 Do it
- V-003 Store ^store

## Edges

- V-001:E@0.5 -> V-002:W
- V-002:N -> V-003

## Stickies
`,
    parse: parseIfdam,
    serialize: serializeIfdam as Row["serialize"],
    edges: [
      { from: "V-001", to: "V-002", fromPort: { side: "E", at: 0.5 }, toPort: { side: "W" } },
      { from: "V-002", to: "V-003", fromPort: { side: "N" } },
    ],
    lines: ["- V-001:E@0.5 -> V-002:W", "- V-002:N -> V-003"],
  },
  {
    kind: "architecture",
    note: `---
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
`,
    parse: parseArchitecture,
    serialize: serializeArchitecture as Row["serialize"],
    edges: [
      {
        from: "C-001",
        to: "C-002",
        bidi: false,
        label: "Pinned",
        fromPort: { side: "E", at: 0.5 },
        toPort: { side: "W" },
      },
      { from: "C-001", to: "C-003", bidi: false, fromPort: { side: "N" } },
      // The ratio is clamped to 1 on read.
      { from: "C-003", to: "C-001", bidi: false, fromPort: { side: "S", at: 1 } },
    ],
    lines: ['- C-001:E@0.5 -> C-002:W "Pinned"', "- C-001:N -> C-003", "- C-003:S@1 -> C-001"],
  },
];

describe.each(ROWS)("edge ports: $kind", (row) => {
  it("reads pinned sides and ratios", () => {
    const doc = row.parse(row.note);
    expect(doc.edges).toEqual(row.edges);
    expect(doc.rawEdges).toEqual([]);
  });

  it("writes pins back and reads them again", () => {
    const doc = row.parse(row.note);
    const out = row.serialize(row.note, doc as never, "2026-10-10");
    for (const line of row.lines) expect(out).toContain(line);
    expect(row.parse(out).edges).toEqual(doc.edges);
  });
});
