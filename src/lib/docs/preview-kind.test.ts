import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isPreviewable, previewKindForPath, TEXT_EXTENSIONS } from "./preview-kind";
import type { DocsEntry } from "@/types";

function entry(over: Partial<DocsEntry>): DocsEntry {
  return {
    path: "G:/share/x",
    name: "x",
    is_dir: false,
    is_markdown: false,
    is_html: false,
    is_text: false,
    modified: 0,
    ...over,
  };
}

describe("previewKindForPath", () => {
  it("names the renderer for each kind it can show", () => {
    expect(previewKindForPath("G:/share/a.md")).toBe("markdown");
    expect(previewKindForPath("G:/share/a.MARKDOWN")).toBe("markdown");
    expect(previewKindForPath("G:/share/a.htm")).toBe("html");
    expect(previewKindForPath("G:/share/notes.txt")).toBe("text");
    expect(previewKindForPath("G:/share/data.YAML")).toBe("text");
  });

  it("returns null for what only the OS can open", () => {
    expect(previewKindForPath("G:/share/sheet.xlsx")).toBeNull();
    expect(previewKindForPath("G:/share/report.pdf")).toBeNull();
    expect(previewKindForPath("G:/share/README")).toBeNull();
  });

  it("reads the extension off the name, not the folders above it", () => {
    // A folder named `notes.md` holding `report.pdf` must not read as
    // Markdown — the last dot in the *path* is not the file's extension.
    expect(previewKindForPath("G:/share/notes.md/report.pdf")).toBeNull();
    expect(previewKindForPath(String.raw`G:\share\notes.md\report.pdf`)).toBeNull();
  });

  it("does not read a dotfile's name as an extension", () => {
    expect(previewKindForPath("G:/share/.gitignore")).toBeNull();
  });
});

describe("isPreviewable", () => {
  it("follows the backend's flags", () => {
    expect(isPreviewable(entry({ is_markdown: true }))).toBe(true);
    expect(isPreviewable(entry({ is_html: true }))).toBe(true);
    expect(isPreviewable(entry({ is_text: true }))).toBe(true);
    expect(isPreviewable(entry({}))).toBe(false);
  });

  it("is never true for a folder", () => {
    expect(isPreviewable(entry({ is_dir: true, is_text: true }))).toBe(false);
  });
});

describe("the two copies of the text-extension list", () => {
  it("says the same thing on both sides of the IPC boundary", () => {
    // The tree's flags come from Rust and the preview judges a bare path, so
    // a kind added to one list and not the other makes a file clickable and
    // then unreadable. Cheaper to fail here than to find it in the app.
    const rust = readFileSync("src-tauri/src/docs.rs", "utf8");
    const block = /const TEXT_EXTENSIONS: &\[&str\] = &\[([\s\S]*?)\];/.exec(rust);
    expect(block, "TEXT_EXTENSIONS not found in docs.rs").not.toBeNull();
    const fromRust = [...(block?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(fromRust.length).toBeGreaterThan(0);
    expect([...fromRust].sort()).toEqual([...TEXT_EXTENSIONS].sort());
  });
});
