import { describe, expect, it } from "vitest";
import type { ScheduleItem } from "./parse";
import { canMoveItem, moveItem } from "./reorder";

const bar = (id: string, start: string, end: string): ScheduleItem => ({
  kind: "bar",
  id,
  start,
  end,
  title: id,
});

const milestone = (id: string, date: string): ScheduleItem => ({
  kind: "milestone",
  id,
  start: date,
  end: date,
  title: id,
});

const ids = (items: ScheduleItem[]) => items.map((i) => i.id);

describe("moveItem", () => {
  it("swaps a milestone with the next one on the same day", () => {
    const items = [milestone("I-1", "2026-08-20"), milestone("I-2", "2026-08-20")];
    expect(ids(moveItem(items, "I-2", -1))).toEqual(["I-2", "I-1"]);
    expect(ids(moveItem(items, "I-1", 1))).toEqual(["I-2", "I-1"]);
  });

  it("skips over elements it does not compete with", () => {
    const items = [
      milestone("I-1", "2026-08-20"),
      milestone("I-2", "2026-08-21"),
      milestone("I-3", "2026-08-20"),
    ];
    // I-3 moves past the unrelated 8/21 milestone in one step, because a
    // single move must always change something on screen.
    expect(ids(moveItem(items, "I-3", -1))).toEqual(["I-3", "I-2", "I-1"]);
  });

  it("leaves an element alone when nothing competes with it", () => {
    const items = [milestone("I-1", "2026-08-20"), milestone("I-2", "2026-08-21")];
    expect(moveItem(items, "I-1", 1)).toBe(items);
    expect(moveItem(items, "I-2", -1)).toBe(items);
  });

  it("stops at the ends of the run", () => {
    const items = [milestone("I-1", "2026-08-20"), milestone("I-2", "2026-08-20")];
    expect(moveItem(items, "I-1", -1)).toBe(items);
    expect(moveItem(items, "I-2", 1)).toBe(items);
  });

  it("moves bars among the bars whose spans overlap theirs", () => {
    const items = [
      bar("I-1", "2026-07-20", "2026-07-24"),
      bar("I-2", "2026-07-22", "2026-07-26"),
    ];
    expect(ids(moveItem(items, "I-2", -1))).toEqual(["I-2", "I-1"]);
  });

  it("does not move a bar past one it never overlaps", () => {
    const items = [
      bar("I-1", "2026-07-20", "2026-07-24"),
      bar("I-2", "2026-08-01", "2026-08-05"),
    ];
    expect(moveItem(items, "I-2", -1)).toBe(items);
  });

  it("keeps range and point elements in separate bands", () => {
    // They cover the same day but are drawn in different bands, so neither can
    // be moved through the other.
    const items = [bar("I-1", "2026-08-20", "2026-08-20"), milestone("I-2", "2026-08-20")];
    expect(moveItem(items, "I-2", -1)).toBe(items);
    expect(moveItem(items, "I-1", 1)).toBe(items);
  });

  it("returns the array untouched for an unknown id", () => {
    const items = [milestone("I-1", "2026-08-20")];
    expect(moveItem(items, "I-9", -1)).toBe(items);
  });

  it("does not mutate the input", () => {
    const items = [milestone("I-1", "2026-08-20"), milestone("I-2", "2026-08-20")];
    moveItem(items, "I-1", 1);
    expect(ids(items)).toEqual(["I-1", "I-2"]);
  });
});

describe("canMoveItem", () => {
  it("reports whether a move would change anything", () => {
    const items = [milestone("I-1", "2026-08-20"), milestone("I-2", "2026-08-20")];
    expect(canMoveItem(items, "I-1", 1)).toBe(true);
    expect(canMoveItem(items, "I-1", -1)).toBe(false);
  });
});
