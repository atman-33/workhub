import { describe, expect, it } from "vitest";
import { reorderWithinRoot, shortcutsInRoot } from "./shortcuts";
import type { DocsShortcut } from "@/types";

const A = "G:/alpha";
const B = "H:/beta";

function s(path: string, is_dir = false): DocsShortcut {
  return { path, is_dir };
}

/** a1, b1, a2, b2 — interleaved, so a naive write-back cannot pass by luck. */
const stored: DocsShortcut[] = [
  s(`${A}/one.md`),
  s(`${B}/x.md`),
  s(`${A}/two.md`),
  s(`${B}/y.md`),
];

describe("shortcutsInRoot", () => {
  it("keeps only what the picked root contains, in stored order", () => {
    expect(shortcutsInRoot(stored, A).map((x) => x.path)).toEqual([
      `${A}/one.md`,
      `${A}/two.md`,
    ]);
  });

  it("counts the root itself as inside it", () => {
    expect(shortcutsInRoot([s(A, true)], A)).toHaveLength(1);
  });

  it("does not match a root that merely shares a prefix", () => {
    expect(shortcutsInRoot([s("G:/alpha-old/one.md")], A)).toEqual([]);
  });

  it("shows nothing when no root is picked", () => {
    expect(shortcutsInRoot(stored, "")).toEqual([]);
  });
});

describe("reorderWithinRoot", () => {
  it("rearranges the visible rows and leaves every other root alone", () => {
    const next = reorderWithinRoot(stored, A, [s(`${A}/two.md`), s(`${A}/one.md`)]);
    expect(next.map((x) => x.path)).toEqual([
      `${A}/two.md`,
      `${B}/x.md`,
      `${A}/one.md`,
      `${B}/y.md`,
    ]);
  });

  it("never drops a shortcut belonging to another root", () => {
    // The failure this exists to prevent: saving the visible subset as the
    // whole list. Every stored path must survive any reorder.
    const next = reorderWithinRoot(stored, A, [s(`${A}/two.md`), s(`${A}/one.md`)]);
    expect(next).toHaveLength(stored.length);
    expect([...next.map((x) => x.path)].sort()).toEqual([...stored.map((x) => x.path)].sort());
  });

  it("ignores a row that is not visible rather than inserting it", () => {
    // A stale drag naming another root's shortcut leaves the queue short, and
    // a hole in the result is worse than no reorder at all.
    const next = reorderWithinRoot(stored, A, [s(`${B}/x.md`), s(`${A}/one.md`)]);
    expect(next).toEqual(stored);
  });

  it("is a no-op when the picked root has nothing in it", () => {
    expect(reorderWithinRoot(stored, "Z:/none", [])).toEqual(stored);
  });

  it("leaves the caller's array alone", () => {
    const before = stored.map((x) => x.path);
    reorderWithinRoot(stored, A, [s(`${A}/two.md`), s(`${A}/one.md`)]);
    expect(stored.map((x) => x.path)).toEqual(before);
  });
});
