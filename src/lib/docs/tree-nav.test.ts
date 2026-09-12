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

  it("calls a listed folder with nothing to show a leaf", () => {
    // `sub` holds only a file, so in folders-only mode there is nothing under
    // it to draw — and nothing to expand onto.
    const { rows } = flattenTree({
      rootPath: ROOT,
      dirs,
      open: { [`${ROOT}/docs`]: true },
      filter: "",
      foldersOnly: true,
    });
    const sub = entryRows(rows).find((r) => r.entry.name === "sub");
    expect(sub?.isLeaf).toBe(true);
    expect(entryRows(rows).find((r) => r.entry.name === "docs")?.isLeaf).toBeUndefined();
  });

  it("draws no row under a leaf, and no message either", () => {
    // `open` can still say the folder is expanded — it was, before its last
    // sub-folder went away. The leaf wins, and nothing is drawn beneath it.
    const { rows } = flattenTree({
      rootPath: ROOT,
      dirs,
      open: { [`${ROOT}/docs`]: true, [`${ROOT}/docs/sub`]: true },
      filter: "",
      foldersOnly: true,
    });
    expect(rows.filter((r) => r.kind === "message")).toEqual([]);
    expect(entryRows(rows).map((r) => r.entry.name)).toEqual(["docs", "sub"]);
  });

  it("keeps a visible leaf in `needed` so a refresh re-reads it", () => {
    // Without this the folder could never stop being a leaf: it is closed, so
    // nothing else would ever ask for its listing again.
    const { needed } = flattenTree({
      rootPath: ROOT,
      dirs,
      open: { [`${ROOT}/docs`]: true },
      filter: "",
      foldersOnly: true,
    });
    expect(needed).toEqual([ROOT, `${ROOT}/docs`, `${ROOT}/docs/sub`]);
  });

  it("never calls a folder a leaf while filtering", () => {
    // An empty result here is the filter's doing and lasts as long as the
    // typing does; a chevron lost mid-search would not come back.
    const { rows } = flattenTree({
      rootPath: ROOT,
      dirs,
      open: { [`${ROOT}/docs`]: true, [`${ROOT}/docs/sub`]: true },
      filter: "zzz",
      foldersOnly: false,
    });
    expect(entryRows(rows).every((r) => r.isLeaf === undefined)).toBe(true);
    // `sub` stays open and says why it looks empty, rather than turning into
    // a leaf the search has manufactured.
    expect(rows.filter((r) => r.kind === "message")).toMatchObject([
      { text: "Nothing matching here." },
    ]);
  });

  it("leaves an unlisted folder alone rather than fetching it to find out", () => {
    // Being on screen is not a reason to read a folder — that is the
    // whole-tree walk the lazy tree exists to avoid.
    const { rows, needed } = flattenTree({
      rootPath: ROOT,
      dirs: { [ROOT]: { status: "ready", entries: [dir("docs", ROOT)] } },
      open: {},
      filter: "",
      foldersOnly: false,
    });
    expect(entryRows(rows)[0].isLeaf).toBeUndefined();
    expect(needed).toEqual([ROOT]);
  });

  it("says so when the root itself is empty", () => {
    // The root has no chevron to drop, so it is the one folder that can be
    // drawn open with nothing in it.
    const { rows } = flattenTree({
      rootPath: ROOT,
      dirs: { [ROOT]: { status: "ready", entries: [] } },
      open: {},
      filter: "",
      foldersOnly: false,
    });
    expect(rows).toMatchObject([{ kind: "message", text: "This folder is empty." }]);
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

  it("treats a leaf folder like a file: Right does nothing, Left goes up", () => {
    // In folders-only mode `sub` holds no folders, so it is drawn without a
    // chevron and the keys must agree with what is on screen.
    const leafOpen = { ...open, [`${ROOT}/docs/sub`]: true };
    const foldersRows = flattenTree({
      rootPath: ROOT,
      dirs,
      open: leafOpen,
      filter: "",
      foldersOnly: true,
    }).rows;
    expect(navigate("ArrowRight", foldersRows, `${ROOT}/docs/sub`, leafOpen)).toEqual({
      type: "none",
    });
    expect(navigate("ArrowLeft", foldersRows, `${ROOT}/docs/sub`, leafOpen)).toEqual({
      type: "move",
      path: `${ROOT}/docs`,
    });
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
