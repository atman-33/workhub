import { describe, expect, it } from "vitest";
import { hideTab, reorderVisible, resolveTabLayout, showTab, toStored } from "./tab-layout";

const ALL = ["a", "b", "c", "d"];

describe("resolveTabLayout", () => {
  it("is the built-in order when nothing is stored", () => {
    expect(resolveTabLayout(ALL, [], [])).toEqual({ visible: ALL, hidden: [] });
  });

  it("follows the stored order and appends tabs the lists have never seen", () => {
    expect(resolveTabLayout(ALL, ["c", "a"], [])).toEqual({
      visible: ["c", "a", "b", "d"],
      hidden: [],
    });
  });

  it("drops keys this build does not know and duplicates", () => {
    expect(resolveTabLayout(ALL, ["x", "b", "b", "a"], ["y"])).toEqual({
      visible: ["b", "a", "c", "d"],
      hidden: [],
    });
  });

  it("separates hidden tabs", () => {
    expect(resolveTabLayout(ALL, ["a", "b", "c", "d"], ["b"])).toEqual({
      visible: ["a", "c", "d"],
      hidden: ["b"],
    });
  });

  it("never leaves the bar empty", () => {
    expect(resolveTabLayout(ALL, [], ALL).visible).toEqual(ALL);
  });
});

describe("editing", () => {
  const base = resolveTabLayout(ALL, [], []);

  it("reorders within the visible tabs", () => {
    expect(reorderVisible(base, "d", "a").visible).toEqual(["d", "a", "b", "c"]);
    expect(reorderVisible(base, "a", "c").visible).toEqual(["b", "c", "a", "d"]);
  });

  it("ignores a move onto itself or an unknown tab", () => {
    expect(reorderVisible(base, "a", "a")).toBe(base);
    expect(reorderVisible(base, "a", "zz")).toBe(base);
  });

  it("hides and restores a tab; restored goes to the end", () => {
    const hidden = hideTab(base, "b");
    expect(hidden).toEqual({ visible: ["a", "c", "d"], hidden: ["b"] });
    expect(showTab(hidden, "b").visible).toEqual(["a", "c", "d", "b"]);
  });

  it("refuses to hide the last visible tab", () => {
    const one = { visible: ["a"], hidden: ["b"] };
    expect(hideTab(one, "a")).toBe(one);
  });

  it("round-trips through the stored lists", () => {
    const layout = hideTab(reorderVisible(base, "c", "a"), "b");
    const stored = toStored(layout);
    expect(resolveTabLayout(ALL, stored.tab_order, stored.hidden_tabs)).toEqual(layout);
  });
});
