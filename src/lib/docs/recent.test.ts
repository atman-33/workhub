// @vitest-environment happy-dom
// The store is localStorage; the default node environment has none.
import { beforeEach, describe, expect, it } from "vitest";
import { clearRecent, pushRecent, readRecent, RECENT_LIMIT, removeRecent } from "./recent";

const A = "D-001";
const B = "D-002";

beforeEach(() => {
  localStorage.clear();
});

describe("recent files", () => {
  it("starts empty and records most-recent-first", () => {
    expect(readRecent(A)).toEqual([]);
    pushRecent(A, "G:/x/one.md");
    pushRecent(A, "G:/x/two.md");
    expect(readRecent(A)).toEqual(["G:/x/two.md", "G:/x/one.md"]);
  });

  it("moves a file already in the list to the front instead of duplicating it", () => {
    pushRecent(A, "G:/x/one.md");
    pushRecent(A, "G:/x/two.md");
    pushRecent(A, "G:/x/one.md");
    expect(readRecent(A)).toEqual(["G:/x/one.md", "G:/x/two.md"]);
  });

  it("holds no more than the limit", () => {
    for (let i = 0; i < RECENT_LIMIT + 5; i++) pushRecent(A, `G:/x/${i}.md`);
    const list = readRecent(A);
    expect(list).toHaveLength(RECENT_LIMIT);
    expect(list[0]).toBe(`G:/x/${RECENT_LIMIT + 4}.md`);
  });

  it("keeps each root's history to itself", () => {
    pushRecent(A, "G:/x/one.md");
    pushRecent(B, "H:/y/two.md");
    expect(readRecent(A)).toEqual(["G:/x/one.md"]);
    expect(readRecent(B)).toEqual(["H:/y/two.md"]);
  });

  it("forgets one entry, and the whole list", () => {
    pushRecent(A, "G:/x/one.md");
    pushRecent(A, "G:/x/two.md");
    expect(removeRecent(A, "G:/x/one.md")).toEqual(["G:/x/two.md"]);
    expect(clearRecent(A)).toEqual([]);
    expect(readRecent(A)).toEqual([]);
  });

  it("treats unreadable storage as an empty history", () => {
    localStorage.setItem("docs.recent." + A, "{not json");
    expect(readRecent(A)).toEqual([]);
    localStorage.setItem("docs.recent." + A, '{"not":"an array"}');
    expect(readRecent(A)).toEqual([]);
  });

  it("ignores a root with no id, so nothing is written under a blank key", () => {
    expect(pushRecent("", "G:/x/one.md")).toEqual([]);
    expect(readRecent("")).toEqual([]);
  });
});
