import { describe, expect, it } from "vitest";
import { backlogOfScope, isDiagramKind, CREATABLE_KINDS, DIAGRAM_KINDS } from "./diagram-kinds";

describe("diagram kinds", () => {
  it("recognises the five frontmatter types and nothing else", () => {
    for (const kind of DIAGRAM_KINDS) expect(isDiagramKind(kind)).toBe(true);
    expect(isDiagramKind("note")).toBe(false);
    expect(isDiagramKind("")).toBe(false);
  });

  it("only offers kinds that exist", () => {
    for (const kind of CREATABLE_KINDS) expect(DIAGRAM_KINDS).toContain(kind);
  });

  it("reads the backlog item out of a scope", () => {
    expect(backlogOfScope("backlog:B-050")).toBe("B-050");
    expect(backlogOfScope("project")).toBe("");
  });
});
