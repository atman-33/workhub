import { describe, expect, it } from "vitest";
import { APP_ZOOM, normalizeAppZoom, parseAppZoom, stepAppZoom } from "./app-zoom";

describe("stepAppZoom", () => {
  it("steps by a tenth without floating-point drift", () => {
    let zoom = 1;
    for (let i = 0; i < 3; i++) zoom = stepAppZoom(zoom, 1);
    expect(zoom).toBe(1.3);
    expect(stepAppZoom(1.1, -1)).toBe(1);
  });

  it("stops at the bounds", () => {
    expect(stepAppZoom(APP_ZOOM.min, -1)).toBe(APP_ZOOM.min);
    expect(stepAppZoom(APP_ZOOM.max, 1)).toBe(APP_ZOOM.max);
  });
});

describe("normalizeAppZoom", () => {
  it("snaps to the step grid and clamps", () => {
    expect(normalizeAppZoom(1.2999)).toBe(1.3);
    expect(normalizeAppZoom(9)).toBe(APP_ZOOM.max);
    expect(normalizeAppZoom(0.1)).toBe(APP_ZOOM.min);
  });

  it("falls back to 100% for anything non-numeric", () => {
    expect(normalizeAppZoom(NaN)).toBe(1);
    expect(normalizeAppZoom(Infinity)).toBe(1);
  });
});

describe("parseAppZoom", () => {
  it("falls back to 100% for anything unreadable", () => {
    expect(parseAppZoom(null)).toBe(1);
    expect(parseAppZoom("")).toBe(1);
    expect(parseAppZoom("abc")).toBe(1);
  });

  it("clamps and snaps a stored value", () => {
    expect(parseAppZoom("1.5")).toBe(1.5);
    expect(parseAppZoom("9")).toBe(APP_ZOOM.max);
  });
});
