import { describe, expect, it } from "vitest";
import { rootLabel, sortRootsByLabel } from "./roots";
import type { DocsRootStatus } from "@/types";

function root(id: string, name: string, path = `G:/share/${id}`): DocsRootStatus {
  return { id, name, path, available: true };
}

describe("sortRootsByLabel", () => {
  it("orders by the label, not by registration order", () => {
    const roots = [root("D-001", "Zebra"), root("D-002", "apple"), root("D-003", "Mango")];
    expect(sortRootsByLabel(roots).map(rootLabel)).toEqual(["apple", "Mango", "Zebra"]);
  });

  it("sorts an unnamed root by the path it shows instead", () => {
    const roots = [root("D-001", "", "G:/zeta"), root("D-002", "alpha"), root("D-003", "", "G:/beta")];
    expect(sortRootsByLabel(roots).map(rootLabel)).toEqual(["alpha", "G:/beta", "G:/zeta"]);
  });

  it("counts numbers as numbers", () => {
    const roots = [root("D-001", "plan 10"), root("D-002", "plan 2")];
    expect(sortRootsByLabel(roots).map(rootLabel)).toEqual(["plan 2", "plan 10"]);
  });

  it("puts Japanese names in reading order, not code-point order", () => {
    // あ < か < さ by reading; by code point too, but 亜 (kanji) would sort
    // ahead of every kana if this compared code points.
    const roots = [root("D-001", "さくら"), root("D-002", "あさひ"), root("D-003", "かえで")];
    expect(sortRootsByLabel(roots).map(rootLabel)).toEqual(["あさひ", "かえで", "さくら"]);
  });

  it("leaves the caller's array alone", () => {
    const roots = [root("D-001", "b"), root("D-002", "a")];
    sortRootsByLabel(roots);
    expect(roots.map((r) => r.id)).toEqual(["D-001", "D-002"]);
  });
});
