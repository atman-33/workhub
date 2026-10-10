import { describe, expect, it } from "vitest";
import { CREATABLE_KINDS, DIAGRAM_KINDS, hasEditor, KIND_GROUPS } from "./diagram-kinds";
import {
  ALL_KINDS,
  chipGroups,
  isCollapsed,
  listedFiles,
  sectionsOf,
  sortFiles,
  updatedDay,
  withCollapsed,
} from "./diagram-list";
import type { DiagramFile } from "@/types";

function file(kind: string, title: string, updated = "2026-10-01", project = "p"): DiagramFile {
  return { path: `/v/${project}/${kind}/${title}.md`, project, title, kind, updated, scope: "project" };
}

describe("kind definition", () => {
  it("orders the groups and kinds as the owner confirmed", () => {
    expect(KIND_GROUPS.map((g) => g.id)).toEqual(["plan", "process", "system"]);
    expect(DIAGRAM_KINDS).toEqual(["schedule", "mindmap", "matrix2x2", "pfd", "flow", "algorithm", "usecase", "ifdam"]);
  });

  it("lists IFDAM in the system group and offers it, last among the creatable kinds (T-0704)", () => {
    expect(KIND_GROUPS.find((g) => g.id === "system")?.kinds).toEqual(["usecase", "ifdam"]);
    expect(CREATABLE_KINDS).toContain("ifdam");
    expect(CREATABLE_KINDS[CREATABLE_KINDS.length - 1]).toBe("ifdam");
    expect(hasEditor("ifdam")).toBe(true);
  });

  it("lists the use case diagram first in the system group but does not offer it until its editor lands (T-0706)", () => {
    expect(KIND_GROUPS.find((g) => g.id === "system")?.kinds[0]).toBe("usecase");
    expect(CREATABLE_KINDS).not.toContain("usecase");
    expect(hasEditor("usecase")).toBe(false);
  });

  it("lists each kind in exactly one group", () => {
    expect(new Set(DIAGRAM_KINDS).size).toBe(DIAGRAM_KINDS.length);
  });

  it("offers creatable kinds in display order", () => {
    expect(CREATABLE_KINDS).toEqual(DIAGRAM_KINDS.filter((k) => CREATABLE_KINDS.includes(k)));
  });
});

describe("chipGroups", () => {
  it("counts per kind and hides kinds with no files", () => {
    const groups = chipGroups([file("flow", "a"), file("flow", "b"), file("schedule", "c")], ALL_KINDS);
    expect(groups.map((g) => g.id)).toEqual(["plan", "process"]);
    expect(groups[0].chips).toEqual([{ kind: "schedule", count: 1 }]);
    expect(groups[1].chips).toEqual([{ kind: "flow", count: 2 }]);
  });

  it("keeps the selected kind at zero, in its place", () => {
    const groups = chipGroups([file("flow", "a")], "pfd");
    expect(groups[0].chips).toEqual([
      { kind: "pfd", count: 0 },
      { kind: "flow", count: 1 },
    ]);
  });

  it("drops a group with no chip, so no separator is drawn for it", () => {
    expect(chipGroups([], ALL_KINDS)).toEqual([]);
    expect(chipGroups([file("mindmap", "a")], ALL_KINDS).map((g) => g.id)).toEqual(["plan"]);
  });

  it("ignores notes of a kind it does not know", () => {
    expect(chipGroups([file("mystery", "a")], ALL_KINDS)).toEqual([]);
  });
});

describe("sortFiles", () => {
  const a = file("flow", "Alpha", "2026-10-01");
  const b = file("flow", "Beta", "2026-10-09");
  const c = file("flow", "Charlie", "");
  const d = file("flow", "Delta", "2026-10-09");

  it("puts the newest first by default, ties by name, empty last", () => {
    expect(sortFiles([a, c, d, b], "updated").map((f) => f.title)).toEqual([
      "Beta",
      "Delta",
      "Alpha",
      "Charlie",
    ]);
  });

  it("orders by name when asked", () => {
    expect(sortFiles([d, c, b, a], "name").map((f) => f.title)).toEqual([
      "Alpha",
      "Beta",
      "Charlie",
      "Delta",
    ]);
  });

  it("does not change its input", () => {
    const input = [b, a];
    sortFiles(input, "name");
    expect(input).toEqual([b, a]);
  });
});

describe("sectionsOf / listedFiles", () => {
  const files = [
    file("algorithm", "Code", "2026-10-05"),
    file("schedule", "Plan A", "2026-10-02"),
    file("schedule", "Plan B", "2026-10-08"),
    file("pfd", "Overview"),
    file("mystery", "Odd"),
  ];

  it("groups by kind in chip order, each ordered by the sort", () => {
    const sections = sectionsOf(files, "updated");
    expect(sections.map((s) => s.kind)).toEqual(["schedule", "pfd", "algorithm"]);
    expect(sections[0].files.map((f) => f.title)).toEqual(["Plan B", "Plan A"]);
  });

  it("lists All as the sections flattened, without unknown kinds", () => {
    expect(listedFiles(files, ALL_KINDS, "name").map((f) => f.title)).toEqual([
      "Plan A",
      "Plan B",
      "Overview",
      "Code",
    ]);
  });

  it("lists one kind flat", () => {
    expect(listedFiles(files, "schedule", "updated").map((f) => f.title)).toEqual(["Plan B", "Plan A"]);
    expect(listedFiles(files, "flow", "updated")).toEqual([]);
  });
});

describe("collapsed kinds", () => {
  it("collapses and expands without touching the input", () => {
    const start = ["flow"];
    const next = withCollapsed(start, "pfd", true);
    expect(next).toEqual(["flow", "pfd"]);
    expect(start).toEqual(["flow"]);
    expect(isCollapsed(next, "pfd")).toBe(true);
    expect(withCollapsed(next, "pfd", false)).toEqual(["flow"]);
    expect(withCollapsed(next, "pfd", true)).toEqual(["flow", "pfd"]);
  });
});

describe("updatedDay", () => {
  it("keeps the date part", () => {
    expect(updatedDay("2026-10-09T12:00:00")).toBe("2026-10-09");
    expect(updatedDay("")).toBe("");
  });
});
