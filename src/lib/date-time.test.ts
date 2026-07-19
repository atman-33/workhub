import { describe, expect, it } from "vitest";

import { applyDateTime, floorMinute, roundToStep, toUnix } from "./date-time";

/** Build a local-time Date, mirroring how the picker reads user input. */
const local = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) =>
  new Date(y, mo - 1, d, h, mi, s);

describe("floorMinute", () => {
  it("snaps onto the 5-minute grid", () => {
    expect(floorMinute(0)).toBe(0);
    expect(floorMinute(4)).toBe(0);
    expect(floorMinute(5)).toBe(5);
    expect(floorMinute(37)).toBe(35);
    expect(floorMinute(59)).toBe(55);
  });
});

describe("roundToStep", () => {
  it("floors minutes and clears seconds", () => {
    const r = roundToStep(local(2026, 7, 19, 14, 37, 42));
    expect(r.getMinutes()).toBe(35);
    expect(r.getSeconds()).toBe(0);
    expect(r.getMilliseconds()).toBe(0);
    expect(r.getHours()).toBe(14);
    expect(r.getDate()).toBe(19);
  });

  it("does not mutate its argument", () => {
    const original = local(2026, 7, 19, 14, 37, 42);
    roundToStep(original);
    expect(original.getMinutes()).toBe(37);
    expect(original.getSeconds()).toBe(42);
  });
});

describe("applyDateTime", () => {
  const base = local(2026, 7, 19, 9, 30);

  it("keeps the time when only the date changes", () => {
    const result = applyDateTime(base, { date: local(2026, 12, 1) });
    expect(new Date(result * 1000)).toEqual(local(2026, 12, 1, 9, 30));
  });

  it("discards the time-of-day carried by the date patch", () => {
    // The calendar hands back a midnight Date; that must not reset the clock.
    const result = applyDateTime(base, { date: local(2026, 12, 1, 0, 0) });
    expect(new Date(result * 1000).getHours()).toBe(9);
    expect(new Date(result * 1000).getMinutes()).toBe(30);
  });

  it("keeps the date when only the hour changes", () => {
    const result = applyDateTime(base, { hour: 23 });
    expect(new Date(result * 1000)).toEqual(local(2026, 7, 19, 23, 30));
  });

  it("keeps the date when only the minute changes", () => {
    const result = applyDateTime(base, { minute: 0 });
    expect(new Date(result * 1000)).toEqual(local(2026, 7, 19, 9, 0));
  });

  it("accepts hour 0 and minute 0 rather than treating them as absent", () => {
    const result = applyDateTime(base, { hour: 0, minute: 0 });
    expect(new Date(result * 1000)).toEqual(local(2026, 7, 19, 0, 0));
  });

  it("zeroes seconds so the anchor lands on a whole minute", () => {
    const result = applyDateTime(local(2026, 7, 19, 9, 30, 47), { hour: 10 });
    expect(new Date(result * 1000).getSeconds()).toBe(0);
  });

  it("round-trips through unix seconds in local time", () => {
    const result = applyDateTime(base, {});
    expect(result).toBe(toUnix(local(2026, 7, 19, 9, 30)));
  });
});
