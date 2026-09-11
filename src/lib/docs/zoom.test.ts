import { describe, expect, it } from "vitest";
import {
  FIGURE_ZOOM,
  PREVIEW_ZOOM,
  actualSizeView,
  fitView,
  parsePreviewZoom,
  stepPreviewZoom,
  zoomAround,
} from "./zoom";

describe("stepPreviewZoom", () => {
  it("steps by a tenth without floating-point drift", () => {
    let zoom = 1;
    for (let i = 0; i < 3; i++) zoom = stepPreviewZoom(zoom, -1);
    expect(zoom).toBe(0.7);
    expect(stepPreviewZoom(1.1, 1)).toBe(1.2);
  });

  it("stops at the bounds", () => {
    expect(stepPreviewZoom(PREVIEW_ZOOM.min, -1)).toBe(PREVIEW_ZOOM.min);
    expect(stepPreviewZoom(PREVIEW_ZOOM.max, 1)).toBe(PREVIEW_ZOOM.max);
  });
});

describe("parsePreviewZoom", () => {
  it("falls back to 100% for anything unreadable", () => {
    expect(parsePreviewZoom(null)).toBe(1);
    expect(parsePreviewZoom("")).toBe(1);
    expect(parsePreviewZoom("abc")).toBe(1);
  });

  it("clamps and snaps a stored value", () => {
    expect(parsePreviewZoom("1.3")).toBe(1.3);
    expect(parsePreviewZoom("9")).toBe(PREVIEW_ZOOM.max);
    expect(parsePreviewZoom("1.2999")).toBe(1.3);
  });
});

describe("zoomAround", () => {
  it("keeps the point under the cursor where it was", () => {
    const view = { scale: 1, x: 10, y: 20 };
    const next = zoomAround(view, 2, 110, 70);
    // The figure point under (110, 70) before: ((110-10)/1, (70-20)/1) = (100, 50).
    expect(next.scale).toBe(2);
    expect(next.x + 100 * next.scale).toBeCloseTo(110);
    expect(next.y + 50 * next.scale).toBeCloseTo(70);
  });

  it("does not zoom past the limits", () => {
    expect(zoomAround({ scale: FIGURE_ZOOM.max, x: 0, y: 0 }, 2, 0, 0).scale).toBe(
      FIGURE_ZOOM.max,
    );
    expect(zoomAround({ scale: FIGURE_ZOOM.min, x: 0, y: 0 }, 0.5, 0, 0).scale).toBe(
      FIGURE_ZOOM.min,
    );
  });
});

describe("fitView", () => {
  it("shrinks a large figure to fit and centres it", () => {
    const view = fitView(2000, 1000, 1048, 548, 24);
    expect(view.scale).toBeCloseTo(0.5);
    expect(view.x).toBeCloseTo(24);
    expect(view.y).toBeCloseTo(24);
  });

  it("never enlarges a small figure", () => {
    const view = fitView(100, 50, 800, 600);
    expect(view.scale).toBe(1);
    expect(view.x).toBe(350);
    expect(view.y).toBe(275);
  });

  it("is harmless before anything has a size", () => {
    expect(fitView(0, 0, 800, 600)).toEqual({ scale: 1, x: 0, y: 0 });
  });
});

describe("actualSizeView", () => {
  it("centres the figure at 100%", () => {
    expect(actualSizeView(400, 200, 800, 600)).toEqual({ scale: 1, x: 200, y: 200 });
  });
});
