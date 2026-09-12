import { describe, expect, it } from "vitest";
import {
  ancestorsWithin,
  baseName,
  type DirState,
  entryRows,
  flattenTree,
  navigate,
  parentPath,
} from "./tree-nav";
import type { DocsEntry } from "@/types";

function dir(name: string, parent: string): DocsEntry {
  return {
    path: `${parent}/${name}`,
    name,
    is_dir: true,
    is_markdown: false,
    is_html: false,
  } as DocsEntry;
}

function file(name: string, parent: string): DocsEntry {
  return {
    path: `${parent}/${name}`,
    name,
    is_dir: false,
    is_markdown: name.endsWith(".md"),
    is_html: name.endsWith(".html"),
  } as DocsEntry;
}

const ROOT = "G:/share";

/** root: docs/ (a.md, sub/), notes.md */
const dirs: Record<string, DirState> = {
  [ROOT]: { status: "ready", entries: [dir("docs", ROOT), file("notes.md", ROOT)] },
  [`${ROOT}/docs`]: {
    status: "ready",
    entries: [dir("sub", `${ROOT}/docs`), file("a.md", `${ROOT}/docs`)],
  },
  [`${ROOT}/docs/sub`]: { status: "ready", entries: [file("b.md", `${ROOT}/docs/sub`)] },
};

describe("flattenTree", () => {
  it("lists only what is open, in screen order", () => {
    const { rows } = flattenTree({
      rootPath: ROOT,
      dirs,
      open: {},
      filter: "",
      foldersOnly: false,
    });
    expect(entryRows(rows).map((r) => r.entry.name)).toEqual(["docs", "notes.md"]);
  });

  it("walks into an open folder and deepens it", () => {
    const { rows } = flattenTree({
      rootPath: ROOT,
      dirs,
      open: { [`${ROOT}/docs`]: true },
      filter: "",
      foldersOnly: false,
    });
    expect(entryRows(rows).map((r) => [r.entry.name, r.depth])).toEqual([
      ["docs", 0],
      ["sub", 1],
      ["a.md", 1],
      ["notes.md", 0],
    ]);
  });

  it("asks only for the listings it drew", () => {
    const { needed } = flattenTree({
      rootPath: ROOT,
      dirs,
      open: { [`${ROOT}/docs`]: true },
      filter: "",
      foldersOnly: false,
    });
    expect(needed).toEqual([ROOT, `${ROOT}/docs`]);
  });

  it("keeps folders while filtering files", () => {
    const { rows } = flattenTree({
      rootPath: ROOT,
      dirs,
      open: {},
      filter: "zzz",
      foldersOnly: false,
    });
    expect(entryRows(rows).map((r) => r.entry.name)).toEqual(["docs"]);
  });

  it("drops files entirely in folders-only mode", () => {
    const { rows } = flattenTree({
      rootPath: ROOT,
      dirs,
      open: { [`${ROOT}/docs`]: true },
      filter: "",
      foldersOnly: true,
    });
    expect(entryRows(rows).map((r) => r.entry.name)).toEqual(["docs", "sub"]);
  });

  it("draws a row for the root when asked, and keeps its children beneath it", () => {
    const { rows } = flattenTree({
      rootPath: ROOT,
      dirs,
      open: {},
      filter: "",
      foldersOnly: true,
      rootName: "share",
    });
    expect(entryRows(rows).map((r) => [r.entry.name, r.depth])).toEqual([
      ["share", 0],
      ["docs", 1],
    ]);
    expect(entryRows(rows)[0].isRoot).toBe(true);
  });

  it("leaves the root row out unless one is asked for", () => {
    const { rows } = flattenTree({
      rootPath: ROOT,
      dirs,
      open: {},
      filter: "",
      foldersOnly: true,
    });
    expect(entryRows(rows).map((r) => r.entry.name)).toEqual(["docs"]);
  });

  it("stands a placeholder in for a folder still being read", () => {
    const { rows } = flattenTree({
      rootPath: ROOT,
      dirs: { [ROOT]: { status: "loading" } },
      open: {},
      filter: "",
      foldersOnly: false,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "message", tone: "muted" });
  });

  it("shows a failed listing's message where the folder was", () => {
    const { rows } = flattenTree({
      rootPath: ROOT,
      dirs: { [ROOT]: { status: "error", message: "offline" } },
      open: {},
      filter: "",
      foldersOnly: false,
    });
    expect(rows[0]).toMatchObject({ kind: "message", tone: "error", text: "offline" });
  });
});

describe("navigate", () => {
  const open = { [`${ROOT}/docs`]: true };
  const { rows } = flattenTree({ rootPath: ROOT, dirs, open, filter: "", foldersOnly: false });
  // rows: docs, sub, a.md, notes.md

  it("moves down and stops at the end", () => {
    expect(navigate("ArrowDown", rows, `${ROOT}/docs`, open)).toEqual({
      type: "move",
      path: `${ROOT}/docs/sub`,
    });
    expect(navigate("ArrowDown", rows, `${ROOT}/notes.md`, open)).toEqual({ type: "none" });
  });

  it("moves up and stops at the top", () => {
    expect(navigate("ArrowUp", rows, `${ROOT}/notes.md`, open)).toEqual({
      type: "move",
      path: `${ROOT}/docs/a.md`,
    });
    expect(navigate("ArrowUp", rows, `${ROOT}/docs`, open)).toEqual({ type: "none" });
  });

  it("lands somewhere on the first keypress when nothing is under the cursor", () => {
    expect(navigate("ArrowDown", rows, "", open)).toEqual({ type: "move", path: `${ROOT}/docs` });
    expect(navigate("ArrowUp", rows, "", open)).toEqual({
      type: "move",
      path: `${ROOT}/notes.md`,
    });
  });

  it("opens a closed folder with Right, then steps into it", () => {
    expect(navigate("ArrowRight", rows, `${ROOT}/docs/sub`, open)).toEqual({
      type: "open",
      path: `${ROOT}/docs/sub`,
    });
    expect(navigate("ArrowRight", rows, `${ROOT}/docs`, open)).toEqual({
      type: "move",
      path: `${ROOT}/docs/sub`,
    });
  });

  it("does nothing on Right over a file", () => {
    expect(navigate("ArrowRight", rows, `${ROOT}/notes.md`, open)).toEqual({ type: "none" });
  });

  it("closes an open folder with Left, and otherwise goes up a level", () => {
    expect(navigate("ArrowLeft", rows, `${ROOT}/docs`, open)).toEqual({
      type: "close",
      path: `${ROOT}/docs`,
    });
    expect(navigate("ArrowLeft", rows, `${ROOT}/docs/a.md`, open)).toEqual({
      type: "move",
      path: `${ROOT}/docs`,
    });
    expect(navigate("ArrowLeft", rows, `${ROOT}/notes.md`, open)).toEqual({ type: "none" });
  });

  it("never collapses the root row, and steps into it instead", () => {
    const withRoot = flattenTree({
      rootPath: ROOT,
      dirs,
      open,
      filter: "",
      foldersOnly: true,
      rootName: "share",
    }).rows;
    expect(navigate("ArrowRight", withRoot, ROOT, open)).toEqual({
      type: "move",
      path: `${ROOT}/docs`,
    });
    expect(navigate("ArrowLeft", withRoot, ROOT, open)).toEqual({ type: "none" });
  });

  it("still collapses a top-level folder when there is no root row", () => {
    expect(navigate("ArrowLeft", rows, `${ROOT}/docs`, open)).toEqual({
      type: "close",
      path: `${ROOT}/docs`,
    });
  });

  it("jumps to the ends", () => {
    expect(navigate("Home", rows, `${ROOT}/docs/a.md`, open)).toEqual({
      type: "move",
      path: `${ROOT}/docs`,
    });
    expect(navigate("End", rows, `${ROOT}/docs`, open)).toEqual({
      type: "move",
      path: `${ROOT}/notes.md`,
    });
  });
});

describe("ancestorsWithin", () => {
  it("returns the folders to open, excluding the target itself", () => {
    expect(ancestorsWithin(ROOT, `${ROOT}/docs/sub/b.md`)).toEqual([
      ROOT,
      `${ROOT}/docs`,
      `${ROOT}/docs/sub`,
    ]);
  });

  it("returns just the root for a top-level entry", () => {
    expect(ancestorsWithin(ROOT, `${ROOT}/notes.md`)).toEqual([ROOT]);
  });

  it("refuses a path outside the root rather than guessing", () => {
    expect(ancestorsWithin(ROOT, "H:/elsewhere/a.md")).toEqual([]);
    // A sibling root whose name merely starts the same way is still outside.
    expect(ancestorsWithin(ROOT, "G:/shared/a.md")).toEqual([]);
  });

  it("tolerates a trailing slash on the root", () => {
    expect(ancestorsWithin("G:/", "G:/docs/a.md")).toEqual(["G:", "G:/docs"]);
  });
});

describe("baseName / parentPath", () => {
  it("names and locates a path", () => {
    expect(baseName(`${ROOT}/docs/a.md`)).toBe("a.md");
    expect(baseName(`${ROOT}/docs/`)).toBe("docs");
    expect(parentPath(`${ROOT}/docs/a.md`)).toBe(`${ROOT}/docs`);
  });
});
