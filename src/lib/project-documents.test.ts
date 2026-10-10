import { describe, expect, it } from "vitest";
import {
  compareDocFiles,
  docLabel,
  groupProjectDocEntries,
  isListableDoc,
  isProjectDocDir,
} from "@/lib/project-documents";
import type { DocsEntry } from "@/types";

function entry(name: string, is_dir = false): DocsEntry {
  const lower = name.toLowerCase();
  return {
    path: `C:/vault/projects/demo/${name}`,
    name,
    is_dir,
    is_markdown: !is_dir && (lower.endsWith(".md") || lower.endsWith(".markdown")),
    is_html: !is_dir && lower.endsWith(".html"),
    is_text: !is_dir && lower.endsWith(".json"),
    modified: 0,
  };
}

describe("isProjectDocDir", () => {
  it("lists dev-notes, shared and attachments but never backlog", () => {
    expect(isProjectDocDir("dev-notes")).toBe(true);
    expect(isProjectDocDir("shared")).toBe(true);
    expect(isProjectDocDir("attachments")).toBe(true);
    expect(isProjectDocDir("backlog")).toBe(false);
    expect(isProjectDocDir("schedules")).toBe(false);
    expect(isProjectDocDir("mindmaps")).toBe(false);
    expect(isProjectDocDir("diagrams")).toBe(false);
  });
});

describe("isListableDoc", () => {
  it("offers previewable files and no folders or binaries", () => {
    expect(isListableDoc(entry("README.md"))).toBe(true);
    expect(isListableDoc(entry("notes.json"))).toBe(true);
    expect(isListableDoc(entry("dev-notes", true))).toBe(false);
    expect(isListableDoc(entry("sheet.xlsx"))).toBe(false);
  });
});

describe("groupProjectDocEntries", () => {
  it("keeps root files, asks for the listed subfolders, drops the rest", () => {
    const { groups, subdirs } = groupProjectDocEntries([
      entry("README.md"),
      entry("prd.md"),
      entry("sheet.xlsx"),
      entry("dev-notes", true),
      entry("shared", true),
      entry("backlog", true),
      entry("schedules", true),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].dir).toBe("");
    expect(groups[0].files.map((f) => f.name)).toEqual(["README.md", "prd.md"]);
    expect(subdirs).toEqual([
      "C:/vault/projects/demo/dev-notes",
      "C:/vault/projects/demo/shared",
    ]);
  });
});

describe("compareDocFiles", () => {
  it("reads README first, then alphabetically", () => {
    const names = [entry("roadmap.md"), entry("README.md"), entry("links.md")].sort(compareDocFiles).map((f) => f.name);
    expect(names).toEqual(["README.md", "links.md", "roadmap.md"]);
  });
});

describe("docLabel", () => {
  it("shows the path relative to the project folder", () => {
    expect(docLabel("C:/vault/projects/demo", "C:/vault/projects/demo/dev-notes/a.md")).toBe(
      "dev-notes/a.md",
    );
  });
});
