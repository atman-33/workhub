import { describe, expect, it } from "vitest";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  fitCamera,
  toDiagramPoint,
  visibleBox,
  zoomAt,
} from "./camera";

describe("zoomAt", () => {
  const start = { x: 40, y: 20, zoom: 1 };

  it("zooms in on a wheel-up notch and out on a wheel-down notch", () => {
    expect(zoomAt(start, 0, 0, -1).zoom).toBeCloseTo(1.1);
    expect(zoomAt(start, 0, 0, 1).zoom).toBeCloseTo(1 / 1.1);
  });

  it("keeps the diagram point under the pointer fixed", () => {
    const px = 300;
    const py = 200;
    const before = toDiagramPoint(start, px, py);
    for (const deltaY of [-1, 1]) {
      const next = zoomAt(start, px, py, deltaY);
      const after = toDiagramPoint(next, px, py);
      expect(after.x).toBeCloseTo(before.x);
      expect(after.y).toBeCloseTo(before.y);
    }
  });

  it("stops at the zoom limits", () => {
    let c = start;
    for (let i = 0; i < 100; i++) c = zoomAt(c, 10, 10, -1);
    expect(c.zoom).toBe(MAX_ZOOM);
    for (let i = 0; i < 200; i++) c = zoomAt(c, 10, 10, 1);
    expect(c.zoom).toBe(MIN_ZOOM);
    expect(clampZoom(99)).toBe(MAX_ZOOM);
    expect(clampZoom(0)).toBe(MIN_ZOOM);
  });

  it("does not drift the camera once at a limit", () => {
    let c = start;
    for (let i = 0; i < 100; i++) c = zoomAt(c, 10, 10, -1);
    const again = zoomAt(c, 10, 10, -1);
    expect(again).toEqual(c);
  });
});

describe("fitCamera", () => {
  const bounds = { x: 100, y: 50, width: 400, height: 300 };

  it("waits for the viewport to have a size", () => {
    expect(fitCamera(bounds, 0, 0)).toBeNull();
    expect(fitCamera(bounds, 800, 0)).toBeNull();
  });

  it("never zooms in to fit", () => {
    const c = fitCamera(bounds, 4000, 3000)!;
    expect(c.zoom).toBe(1);
  });

  it("zooms out when the drawing is larger than the viewport", () => {
    const c = fitCamera({ x: 0, y: 0, width: 2000, height: 1000 }, 800, 600)!;
    expect(c.zoom).toBeLessThan(1);
    expect(c.zoom).toBeGreaterThanOrEqual(MIN_ZOOM);
  });

  it("centres the drawing in the viewport", () => {
    const c = fitCamera(bounds, 800, 600)!;
    const centre = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    expect(c.x + centre.x * c.zoom).toBeCloseTo(400);
    expect(c.y + centre.y * c.zoom).toBeCloseTo(300);
  });

  it("copes with an empty drawing", () => {
    const c = fitCamera({ x: 0, y: 0, width: 0, height: 0 }, 800, 600)!;
    expect(Number.isFinite(c.x)).toBe(true);
    expect(c.zoom).toBe(1);
  });
});

describe("visibleBox", () => {
  it("is the diagram-space rectangle the viewport shows", () => {
    const box = visibleBox({ x: -100, y: -50, zoom: 2 }, 800, 600);
    expect(box).toEqual({ x: 50, y: 25, width: 400, height: 300 });
  });
});
