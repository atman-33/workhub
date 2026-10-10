import { describe, expect, it } from "vitest";
import { copyScheduleItem, pasteScheduleItem } from "./clipboard";
import type { ScheduleItem } from "./parse";

const items: ScheduleItem[] = [
  { kind: "bar", id: "I-001", start: "2026-10-09", end: "2026-10-12", title: "設計", color: "blue", task: "T-0100" },
  { kind: "milestone", id: "I-004", start: "2026-10-31", end: "2026-10-31", title: "リリース", body: "詳細" },
];

describe("copyScheduleItem", () => {
  it("snapshots the item", () => {
    const c = copyScheduleItem(items, "I-001")!;
    expect(c).toEqual(items[0]);
    c.title = "x";
    expect(items[0].title).toBe("設計");
  });

  it("returns null for an unknown id", () => {
    expect(copyScheduleItem(items, "I-099")).toBeNull();
  });
});

describe("pasteScheduleItem", () => {
  it("appends a copy under a fresh id above every id present", () => {
    const out = pasteScheduleItem(items, copyScheduleItem(items, "I-001")!, 1);
    expect(out.id).toBe("I-005");
    expect(out.items.map((i) => i.id)).toEqual(["I-001", "I-004", "I-005"]);
  });

  it("moves a range one day later per paste, keeping its length", () => {
    const out = pasteScheduleItem(items, copyScheduleItem(items, "I-001")!, 1);
    expect(out.items[2]).toMatchObject({
      start: "2026-10-10",
      end: "2026-10-13",
      title: "設計",
      color: "blue",
      task: "T-0100",
    });
    const third = pasteScheduleItem(items, copyScheduleItem(items, "I-001")!, 3);
    expect(third.items[2]).toMatchObject({ start: "2026-10-12", end: "2026-10-15" });
  });

  it("carries a single-day element across a month end", () => {
    const out = pasteScheduleItem(items, copyScheduleItem(items, "I-004")!, 1);
    expect(out.items[2]).toMatchObject({ start: "2026-11-01", end: "2026-11-01", body: "詳細" });
  });

  it("leaves the existing items untouched", () => {
    const before = structuredClone(items);
    pasteScheduleItem(items, copyScheduleItem(items, "I-001")!, 1);
    expect(items).toEqual(before);
  });
});
