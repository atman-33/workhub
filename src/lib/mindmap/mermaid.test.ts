import { describe, expect, it } from "vitest";
import { sanitizeTitle, toMermaid, toMermaidBlock } from "./mermaid";
import { parseMindmap } from "./parse";

const tree = (lines: string[]) =>
  parseMindmap(`---\ntype: mindmap\ntitle: t\n---\n\n## Nodes\n\n${lines.join("\n")}\n`).roots;

describe("sanitizeTitle", () => {
  it("rewrites the characters mermaid reads as shape syntax", () => {
    expect(sanitizeTitle("tasks (later)")).toBe("tasks （later）");
    expect(sanitizeTitle("a [b] {c}")).toBe("a （b） （c）");
  });

  it("flattens a multi-line title", () => {
    expect(sanitizeTitle("first\n  second")).toBe("first second");
  });

  it("substitutes a placeholder for an empty title", () => {
    expect(sanitizeTitle("   ")).toBe("…");
  });
});

describe("toMermaid", () => {
  it("renders the root as a circle and nests by indentation", () => {
    const out = toMermaid(tree(["- N-001 workhub", "  - N-002 tasks", "    - N-003 kanban"]));
    expect(out).toBe(
      ["mindmap", "  root((workhub))", "    tasks", "      kanban"].join("\n"),
    );
  });

  it("drops ids, colours, task links and the collapsed flag", () => {
    const out = toMermaid(
      tree(["- N-001 root #blue", "  - N-002 tasks #green task:T-0042 ^collapsed", "    - N-003 kanban"]),
    );
    expect(out).not.toContain("N-00");
    expect(out).not.toContain("#green");
    expect(out).not.toContain("T-0042");
    expect(out).not.toContain("collapsed");
    // A collapsed subtree is still exported: collapsing is a way of looking,
    // not a statement about the content.
    expect(out).toContain("kanban");
  });

  it("renders every root when the note grew more than one", () => {
    const out = toMermaid(tree(["- N-001 one", "- N-002 two"]));
    expect(out).toContain("root((one))");
    expect(out).toContain("two");
  });

  it("renders an empty document as an empty root", () => {
    expect(toMermaid([])).toBe("mindmap\n  root((empty))");
  });

  it("wraps the source in a fenced block for pasting", () => {
    const block = toMermaidBlock(tree(["- N-001 root"]));
    expect(block.startsWith("```mermaid\nmindmap")).toBe(true);
    expect(block.endsWith("\n```")).toBe(true);
  });
});
