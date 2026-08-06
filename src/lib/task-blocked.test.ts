import { afterEach, describe, expect, it, vi } from "vitest";
import { blockedDays, blockedLabel, blockedTone, todayString } from "./task-blocked";

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

describe("blockedLabel", () => {
  it("shows the day count when a date is known", () => {
    freezeToday("2026-08-10");
    expect(blockedLabel("2026-08-07")).toBe("Blocked · 3d");
  });

  it("falls back to a bare label without a date", () => {
    expect(blockedLabel("")).toBe("Blocked");
  });
});

describe("blockedTone", () => {
  it("turns red only once the block is a week old", () => {
    freezeToday("2026-08-10");
    expect(blockedTone("2026-08-05")).toContain("amber");
    expect(blockedTone("2026-08-03")).toContain("red");
  });

  it("treats a dateless block as fresh", () => {
    expect(blockedTone("")).toContain("amber");
  });
});

describe("todayString", () => {
  it("formats the local date as YYYY-MM-DD", () => {
    freezeToday("2026-01-05");
    expect(todayString()).toBe("2026-01-05");
  });
});
