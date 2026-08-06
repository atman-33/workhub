import { afterEach, describe, expect, it, vi } from "vitest";
import { blockedAge, blockedDays, isStaleBlock, todayString } from "./task-blocked";

function freezeToday(date: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${date}T12:00:00`));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("blockedDays", () => {
  it("counts whole days since the block started", () => {
    freezeToday("2026-08-10");
    expect(blockedDays("2026-08-10")).toBe(0);
    expect(blockedDays("2026-08-03")).toBe(7);
  });

  it("returns null without a usable date", () => {
    expect(blockedDays("")).toBeNull();
    expect(blockedDays("not a date")).toBeNull();
  });

  it("never reports a negative wait for a future date", () => {
    freezeToday("2026-08-10");
    expect(blockedDays("2026-08-20")).toBe(0);
  });

  it("is unaffected by a month boundary", () => {
    freezeToday("2026-09-02");
    expect(blockedDays("2026-08-31")).toBe(2);
  });
});

describe("blockedAge", () => {
  it("shows the day count when a date is known", () => {
    freezeToday("2026-08-10");
    expect(blockedAge("2026-08-07")).toBe("3d");
  });

  it("is empty without a date, so the badge shows the icon alone", () => {
    expect(blockedAge("")).toBe("");
  });
});

describe("isStaleBlock", () => {
  it("becomes true only once the block is a week old", () => {
    freezeToday("2026-08-10");
    expect(isStaleBlock("2026-08-04")).toBe(false); // 6 days
    expect(isStaleBlock("2026-08-03")).toBe(true); // 7 days — the threshold
    expect(isStaleBlock("2026-07-20")).toBe(true);
  });

  it("treats a dateless block as fresh", () => {
    expect(isStaleBlock("")).toBe(false);
  });
});

describe("todayString", () => {
  it("formats the local date as YYYY-MM-DD", () => {
    freezeToday("2026-01-05");
    expect(todayString()).toBe("2026-01-05");
  });
});
