import { describe, expect, it } from "vitest";
import { setOrRemoveFrontmatterValue } from "./note";
import {
  assignMissingIds,
  bodyLines,
  colorModifier,
  countWarnings,
  formatArrowLine,
  formatElementLine,
  formatLabel,
  formatNoteLines,
  formatPosition,
  formatSection,
  positionModifier,
  prefixModifier,
  readArrowLine,
  readEdgeLine,
  readEdges,
  readElements,
  readEnvelope,
  readModifiers,
  sameOrderedPair,
  splitElementLine,
  stickySection,
  taskModifier,
  uniqueEdges,
  writeNote,
  readStickies,
  type EdgeSpec,
  type ElementSpec,
} from "./note-grammar";

describe("readEnvelope", () => {
  it("takes the title from the frontmatter, else the fallback", () => {
    expect(readEnvelope("---\ntitle: T\n---\n", "file").title).toBe("T");
    expect(readEnvelope("---\ntype: x\n---\n", "file").title).toBe("file");
  });

  it("reads `stickies: hidden` and normalizes CRLF", () => {
    const e = readEnvelope("---\r\ntitle: T\r\nstickies: hidden\r\n---\r\n\r\n## A\r\n\r\n- x\r\n", "");
    expect(e.stickiesHidden).toBe(true);
    expect(e.note.frontmatter).not.toContain("\r");
  });

  it("reads the stickies section", () => {
    const { note } = readEnvelope("## Stickies\n\n- S-001 node:A-001 @1,2 hi\n- loose\n", "");
    const read = readStickies(note);
    expect(read.stickies).toHaveLength(1);
    expect(read.rawStickies).toEqual(["- loose"]);
  });
});

describe("modifiers", () => {
  it("reads whole-pixel positions and nothing malformed", () => {
    expect(positionModifier("@12.6,-3.4")).toEqual({ x: 13, y: -3 });
    expect(positionModifier("@12")).toBeUndefined();
    expect(positionModifier("@a,b")).toBeUndefined();
  });

  it("reads a known colour only", () => {
    expect(colorModifier("#blue")).toBe("blue");
    expect(colorModifier("#nocolor")).toBeUndefined();
    expect(colorModifier("blue")).toBeUndefined();
  });

  it("reads `prefix:value` with a non-empty value", () => {
    expect(taskModifier("task:T-1")).toBe("T-1");
    expect(taskModifier("task:")).toBeUndefined();
    expect(prefixModifier("lane:")("lane:L-001")).toBe("L-001");
  });

  it("takes the first of each field in any order and leaves the rest as the title", () => {
    const { fields, title } = readModifiers<{
      pos: { x: number; y: number };
      color: "blue";
      task: string;
    }>(["a", "task:T-1", "#blue", "b", "@1,2", "@3,4", "#blue", "task:T-2", "#nocolor"], {
      pos: positionModifier,
      color: (t) => (t === "#blue" ? "blue" : undefined),
      task: taskModifier,
    });
    expect(fields).toEqual({ task: "T-1", color: "blue", pos: { x: 1, y: 2 } });
    expect(title).toBe("a b @3,4 #blue task:T-2 #nocolor");
  });
});

describe("splitElementLine", () => {
  const own = (t: string) => /^A-\d+$/.test(t);

  it("splits the id off a list line", () => {
    expect(splitElementLine("- A-001 hello world", own)).toEqual({ id: "A-001", rest: ["hello", "world"] });
    expect(splitElementLine("  -   A-001", own)).toEqual({ id: "A-001", rest: [] });
  });

  it("treats a line with no id as an element to be given one", () => {
    expect(splitElementLine("- hello A-002", own)).toEqual({ id: "", rest: ["hello", "A-002"] });
  });

  it("leaves another Kind's element, and anything that is not a list item, alone", () => {
    expect(splitElementLine("- F-001 x", own)).toBeNull();
    expect(splitElementLine("not a list", own)).toBeNull();
    expect(splitElementLine("-", own)).toBeNull();
    expect(splitElementLine("- ", own)).toBeNull();
  });
});

describe("assignMissingIds", () => {
  it("mints per prefix above the highest, and repairs duplicates", () => {
    const items = [{ id: "A-003" }, { id: "" }, { id: "A-003" }, { id: "B-007" }, { id: "" }];
    const minted = assignMissingIds(items, (item) => (item === items[4] ? "B" : "A"));
    expect(minted).toBe(true);
    expect(items.map((i) => i.id)).toEqual(["A-003", "A-004", "A-005", "B-007", "B-008"]);
  });

  it("changes nothing when every id is there once", () => {
    const items = [{ id: "A-001" }, { id: "A-009" }];
    expect(assignMissingIds(items, "A")).toBe(false);
    expect(items.map((i) => i.id)).toEqual(["A-001", "A-009"]);
  });
});

describe("readElements", () => {
  interface El {
    id: string;
    title: string;
    note?: string;
    lines?: string[];
  }
  const base: ElementSpec<El> = {
    ownId: (t) => /^E-\d+$/.test(t),
    build: (id, rest) => ({ id, title: rest.join(" ") }),
    mintPrefix: "E",
  };
  const section = "## Items\n\n- E-001 a\n  one\n  two\n- b\nraw\n  not continuation\n- E-001 c\n  three\n";

  it("collects indented lines into note and keeps unreadable ones raw", () => {
    const r = readElements(section, base);
    expect(r.items).toEqual([
      { id: "E-001", title: "a", note: "one\ntwo" },
      { id: "E-002", title: "b" },
      { id: "E-003", title: "c", note: "three" },
    ]);
    expect(r.raw).toEqual(["raw", "  not continuation"]);
    expect(r.minted).toBe(true);
  });

  it("keeps indented lines raw where an element has none", () => {
    const r = readElements("- E-001 a\n  x\n", { ...base, continuation: "none" });
    expect(r.items).toEqual([{ id: "E-001", title: "a" }]);
    expect(r.raw).toEqual(["  x"]);
  });

  it("hands indented lines to a Kind that files them itself", () => {
    const r = readElements("- E-001 a\n  x\n  y\n", {
      ...base,
      continuation: (el, text) => (el.lines ??= []).push(text),
    });
    expect(r.items[0].lines).toEqual(["x", "y"]);
    expect(r.items[0].note).toBeUndefined();
    expect(r.minted).toBe(false);
  });
});

describe("readEdges", () => {
  interface Edge {
    from: string;
    to: string;
    label?: string;
  }
  const ids = new Set(["A-001", "A-002"]);
  const spec = (onTwin: EdgeSpec<Edge>["onTwin"]): EdgeSpec<Edge> => ({
    parse: (line) => readArrowLine(line, { label: true }),
    isTwin: sameOrderedPair,
    onTwin,
  });
  const section = [
    "## Edges",
    "",
    "- A-001 -> A-002",
    '- A-001 -> A-002 "late"',
    "- A-002 -> A-001",
    "- A-001 -> A-404",
    "junk",
  ].join("\n");

  it("merges a later label into the one arrow of a pair", () => {
    const r = readEdges(section, ids, spec("merge-label"));
    expect(r.edges).toEqual([
      { from: "A-001", to: "A-002", label: "late" },
      { from: "A-002", to: "A-001" },
    ]);
    expect(r.raw).toEqual(["- A-001 -> A-404", "junk"]);
  });

  it("keeps the later line raw when the Kind warns about duplicates", () => {
    const r = readEdges(section, ids, spec("keep-raw"));
    expect(r.edges).toHaveLength(2);
    expect(r.raw).toEqual(['- A-001 -> A-002 "late"', "- A-001 -> A-404", "junk"]);
  });

  it("applies the Kind's own connection rule", () => {
    const r = readEdges("- A-001 -> A-002\n", ids, { ...spec("merge-label"), accepts: () => false });
    expect(r.edges).toEqual([]);
    expect(r.raw).toEqual(["- A-001 -> A-002"]);
  });

  it("reads ports, and a label only where the Kind has them", () => {
    expect(readArrowLine('- A-001:E@0.5 -> A-002:W "x"', { label: true })).toEqual({
      from: "A-001",
      to: "A-002",
      label: "x",
      fromPort: { side: "E", at: 0.5 },
      toPort: { side: "W" },
    });
    expect(readArrowLine('- A-001 -> A-002 "x"', { label: false })).toBeNull();
    expect(readArrowLine("- A-001 <- A-002", { label: true })).toBeNull();
  });

  it("writes an arrow once per pair", () => {
    const edges = [
      { from: "A", to: "B" },
      { from: "A", to: "B", label: "x" },
      { from: "B", to: "A" },
    ];
    expect(uniqueEdges(edges, sameOrderedPair)).toEqual([edges[0], edges[2]]);
  });
});

describe("writing", () => {
  it("formats a line from its parts, leaving out what is empty", () => {
    expect(formatElementLine("A-001", " first\nsecond ", ["^start", undefined, "#blue", formatPosition(1.4, 2.6)])).toBe(
      "- A-001 first ^start #blue @1,3",
    );
    expect(formatElementLine("A-001", "", [])).toBe("- A-001");
    expect(formatPosition(1, undefined)).toBeUndefined();
  });

  it("indents notes and flattens labels", () => {
    expect(formatNoteLines("a\nb  \n\n")).toEqual(["  a", "  b"]);
    expect(formatNoteLines(undefined)).toEqual([]);
    expect(formatLabel('  a "b"\n c ')).toBe(` "a 'b' c"`);
    expect(formatLabel(undefined)).toBe("");
    expect(formatArrowLine({ from: "A-001", to: "A-002", label: "x", fromPort: { side: "E" } }, true)).toBe(
      '- A-001:E -> A-002 "x"',
    );
    expect(formatArrowLine({ from: "A-001", to: "A-002", label: "x" }, false)).toBe("- A-001 -> A-002");
  });

  it("writes a section, empty or not", () => {
    expect(formatSection("Nodes", ["- a", "- b"])).toBe("## Nodes\n\n- a\n- b\n\n");
    expect(formatSection("Nodes", [])).toBe("## Nodes\n\n");
  });

  it("replaces only the managed sections, stamps updated, keeps the line ending", () => {
    const content = "---\r\ntype: x\r\nupdated: 2020-01-01\r\n---\r\n\r\n## Nodes\r\n\r\n- old\r\n\r\n## Memo\r\n\r\nkeep\r\n";
    const out = writeNote(content, "2026-11-11", {
      stickiesHidden: true,
      sections: [{ name: "Nodes", text: formatSection("Nodes", ["- new"]) }, stickySection([], [])],
    });
    expect(out).toBe(
      "---\r\ntype: x\r\nupdated: 2026-11-11\r\nstickies: hidden\r\n---\r\n\r\n## Nodes\r\n\r\n- new\r\n\r\n## Memo\r\n\r\nkeep\r\n",
    );
  });

  it("lets a Kind edit the frontmatter between updated and stickies", () => {
    const out = writeNote("---\ntype: x\n---\n", "2026-11-11", {
      stickiesHidden: true,
      sections: [],
      frontmatter: (fm) => setOrRemoveFrontmatterValue(fm, "x_axis", "a"),
    });
    expect(out.indexOf("updated:")).toBeLessThan(out.indexOf("x_axis:"));
    expect(out.indexOf("x_axis:")).toBeLessThan(out.indexOf("stickies:"));
  });
});

describe("countWarnings", () => {
  it("counts raw lines and stickies whose element is gone", () => {
    const stickies = [
      { id: "S-001", targetId: "A-001", dx: 0, dy: 0, text: "" },
      { id: "S-002", targetId: "A-404", dx: 0, dy: 0, text: "" },
    ];
    expect(countWarnings([["x"], [], ["y", "z"]], stickies, new Set(["A-001"]))).toBe(4);
  });
});

describe("readEdgeLine", () => {
  const line = { label: true, operators: ["--", "->", "<->"] };

  it("reads whichever connector the Kind lists, and says which it was", () => {
    expect(readEdgeLine('- A-001 -- A-002 "x"', line)).toEqual({
      operator: "--",
      shape: { from: "A-001", to: "A-002", label: "x" },
    });
    expect(readEdgeLine("- A-001 <-> A-002", line)?.operator).toBe("<->");
    expect(readEdgeLine("- A-001 -> A-002", line)?.operator).toBe("->");
    expect(readEdgeLine("- A-001 <- A-002", line)).toBeNull();
  });

  it("defaults to a single `->` and pinned ends, as readArrowLine always did", () => {
    expect(readEdgeLine("- A-001:E -> A-002", { label: false })?.shape).toEqual({
      from: "A-001",
      to: "A-002",
      fromPort: { side: "E" },
    });
    expect(readEdgeLine("- A-001 -- A-002", { label: false })).toBeNull();
  });

  it("without ports an end is a bare id, any letter case, and a pinned end is not an edge", () => {
    const plain = { label: true, operators: ["--", "->"], ports: false };
    expect(readEdgeLine("- u-001 -- U-002", plain)?.shape).toEqual({ from: "u-001", to: "U-002" });
    expect(readEdgeLine("- U-001:E -> U-002", plain)).toBeNull();
    expect(readEdgeLine("- U-001--U-002", plain)?.operator).toBe("--");
    expect(readEdgeLine("- U-001 -- U-002 trailing", plain)).toBeNull();
  });

  it("writes the connector it is given", () => {
    expect(formatArrowLine({ from: "A-001", to: "A-002", label: "x" }, true, "--")).toBe(
      '- A-001 -- A-002 "x"',
    );
    expect(formatArrowLine({ from: "A-001", to: "A-002", toPort: { side: "W" } }, false, "<->")).toBe(
      "- A-001 <-> A-002:W",
    );
  });
});

describe("bodyLines", () => {
  it("drops the heading and blank lines", () => {
    expect(bodyLines("## Nodes\n\n- a\n  \n- b\n")).toEqual(["- a", "- b"]);
    expect(bodyLines("- a\n## not first\n")).toEqual(["- a", "## not first"]);
  });
});

