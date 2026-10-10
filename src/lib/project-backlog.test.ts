import { describe, expect, it } from "vitest";
import {
  backlogIdNum,
  backlogIdPrefix,
  backlogItemFromFrontmatter,
  classifyBacklogFile,
  compareBacklogFiles,
  compareBacklogIds,
  discoverBacklogItems,
  entryNoteName,
  filterBacklogItems,
  isBacklogStatusFilter,
  parseFrontmatterScalars,
  sameBacklogId,
  type BacklogListItem,
} from "@/lib/project-backlog";
import type { DocsEntry } from "@/types";

function entry(name: string, is_dir = false): DocsEntry {
  const lower = name.toLowerCase();
  return {
    path: `C:/vault/projects/demo/backlog/${name}`,
    name,
    is_dir,
    is_markdown: !is_dir && (lower.endsWith(".md") || lower.endsWith(".markdown")),
    is_html: !is_dir && lower.endsWith(".html"),
    is_text: !is_dir && lower.endsWith(".json"),
    modified: 0,
  };
}

describe("parseFrontmatterScalars", () => {
  it("reads the scalar fields the pane shows", () => {
    const fields = parseFrontmatterScalars(
      `---\nid: B-004\ntitle: Search\ntype: backlog\nstatus: done\npriority: high\n---\n\n# Search\n`,
    );
    expect(fields.id).toBe("B-004");
    expect(fields.title).toBe("Search");
    expect(fields.status).toBe("done");
    expect(fields.priority).toBe("high");
  });

  it("cuts the template's inline comments and unquotes", () => {
    const fields = parseFrontmatterScalars(
      `---\nstatus: idea          # idea | ready | doing | done | dropped\ntitle: "Quoted: title"\n---\n`,
    );
    expect(fields.status).toBe("idea");
    expect(fields.title).toBe("Quoted: title");
  });

  it("ignores list items and indented lines, keeps empty values", () => {
    const fields = parseFrontmatterScalars(
      `---\nsource:\ntags:\n  - backlog\nstatus: ready\n---\n`,
    );
    expect(fields.source).toBe("");
    expect(fields.status).toBe("ready");
    expect(fields.tags).toBe("");
  });

  it("reads nothing without frontmatter", () => {
    expect(parseFrontmatterScalars("# Just a note\n")).toEqual({});
  });
});

describe("backlogIdPrefix", () => {
  it("takes the B-NNN head of a folder or file stem", () => {
    expect(backlogIdPrefix("B-004-search")).toBe("B-004");
    expect(backlogIdPrefix("B-1000-item")).toBe("B-1000");
    expect(backlogIdPrefix("B-004-search.md".replace(/\.md$/, ""))).toBe("B-004");
    expect(backlogIdPrefix("roadmap")).toBe("roadmap");
    expect(backlogIdPrefix("B-nope")).toBe("B-nope");
  });
});

describe("sameBacklogId", () => {
  it("matches case-insensitively like the backend", () => {
    expect(sameBacklogId("B-001", "b-001")).toBe(true);
    expect(sameBacklogId("B-001", "B-002")).toBe(false);
  });
});

describe("compareBacklogIds", () => {
  it("sorts numerically, not lexically", () => {
    const ids = ["B-1000", "B-200", "B-3", "B-40"];
    expect([...ids].sort(compareBacklogIds)).toEqual(["B-3", "B-40", "B-200", "B-1000"]);
  });

  it("sorts an id that is not B-NNN after every one that is", () => {
    expect(compareBacklogIds("B-1", "zzz")).toBeLessThan(0);
    expect(compareBacklogIds("zzz", "B-1")).toBeGreaterThan(0);
  });

  it("matches backlogIdNum edge cases", () => {
    expect(backlogIdNum("B-004")).toBe(4);
    expect(backlogIdNum("B-x")).toBeNull();
    expect(backlogIdNum("zzz")).toBeNull();
  });
});

describe("discoverBacklogItems", () => {
  it("finds folders and old-shape single files, skips base and dotfiles", () => {
    const found = discoverBacklogItems([
      entry("_backlog.base"),
      entry("B-002-tag-filter", true),
      entry("B-001-note.md"),
      entry("B-004-search", true),
      entry("stray.md"),
      entry("shot.png"),
    ]);
    expect(found).toEqual([
      { name: "B-001-note.md", isFile: true },
      { name: "B-002-tag-filter", isFile: false },
      { name: "B-004-search", isFile: false },
    ]);
  });
});

describe("backlogItemFromFrontmatter", () => {
  it("reads id, title, status and priority off the entry note", () => {
    const item = backlogItemFromFrontmatter(
      { name: "B-001-a", isFile: false },
      { id: "B-001", title: "A", status: "doing", priority: "high" },
    );
    expect(item).toMatchObject({ id: "B-001", title: "A", status: "doing", priority: "high" });
  });

  it("falls back to the folder name without an entry note", () => {
    const item = backlogItemFromFrontmatter({ name: "B-003-headless", isFile: false }, {});
    expect(item).toMatchObject({ id: "B-003", title: "B-003-headless", status: "", priority: "" });
  });

  it("names an entry note after its folder", () => {
    expect(entryNoteName("B-004-search")).toBe("B-004-search.md");
  });
});

describe("filterBacklogItems", () => {
  const items: BacklogListItem[] = [
    { name: "B-001-a", isFile: false, id: "B-001", title: "A", status: "idea", priority: "" },
    { name: "B-002-b", isFile: false, id: "B-002", title: "B", status: "done", priority: "" },
  ];

  it("keeps everything without a filter and narrows on one", () => {
    expect(filterBacklogItems(items, "")).toHaveLength(2);
    expect(filterBacklogItems(items, "done").map((i) => i.id)).toEqual(["B-002"]);
  });

  it("accepts the empty filter and the known statuses", () => {
    expect(isBacklogStatusFilter("")).toBe(true);
    expect(isBacklogStatusFilter("doing")).toBe(true);
    expect(isBacklogStatusFilter("nope")).toBe(false);
  });
});

describe("classifyBacklogFile", () => {
  it("names the entry note first, whatever its type", () => {
    expect(classifyBacklogFile("B-004-search.md", true, "backlog", false)).toBe("entry");
  });

  it("calls a note with a diagram type a diagram", () => {
    expect(classifyBacklogFile("010-plan.md", false, "schedule", false)).toBe("diagram");
    expect(classifyBacklogFile("020-flow.md", false, "flow", false)).toBe("diagram");
    expect(classifyBacklogFile("030-map.md", false, "mindmap", false)).toBe("diagram");
  });

  it("tells deliverables, child notes, HTML and plain notes apart", () => {
    expect(classifyBacklogFile("010-T-0003-done.md", false, "spec", false)).toBe("deliverable");
    expect(classifyBacklogFile("010-behaviour.md", false, "spec", false)).toBe("child");
    expect(classifyBacklogFile("export.html", false, "", true)).toBe("html");
    expect(classifyBacklogFile("links.md", false, "", false)).toBe("note");
  });

  it("lists the entry note first, then by name", () => {
    const rows = [
      { name: "020-b.md", isEntry: false },
      { name: "B-004-search.md", isEntry: true },
      { name: "010-a.md", isEntry: false },
    ].sort(compareBacklogFiles);
    expect(rows.map((r) => r.name)).toEqual(["B-004-search.md", "010-a.md", "020-b.md"]);
  });
});
