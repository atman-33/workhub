import { describe, expect, it } from "vitest";
import {
  freeRoute,
  portOfDrop,
  portPoint,
  portRoute,
  type EdgePort,
} from "./node-edge";
import type { Box } from "./sticky-layout";

const r2 = (n: number) => Math.round(n * 100) / 100;
const routeOf = (points: { x: number; y: number }[]) => points.map((p) => [r2(p.x), r2(p.y)]);

const box = (x: number, y: number, width = 100, height = 40): Box => ({ x, y, width, height });

describe("portPoint", () => {
  const b = box(10, 20);
  it("puts a port on its side, ratio along it", () => {
    expect(portPoint(b, { side: "E" })).toEqual({ x: 110, y: 40 });
    expect(portPoint(b, { side: "W", at: 0 })).toEqual({ x: 10, y: 20 });
    expect(portPoint(b, { side: "N", at: 0.25 })).toEqual({ x: 35, y: 20 });
    expect(portPoint(b, { side: "S", at: 1 })).toEqual({ x: 110, y: 60 });
  });

  it("clamps a ratio outside 0..1", () => {
    expect(portPoint(b, { side: "E", at: 2 })).toEqual({ x: 110, y: 60 });
    expect(portPoint(b, { side: "N", at: -1 })).toEqual({ x: 10, y: 20 });
  });
});

describe("portOfDrop", () => {
  const b = box(100, 100, 200, 100);
  it("names the side the point lies furthest along, and where on it", () => {
    expect(portOfDrop(b, { x: 400, y: 150 })).toEqual({ side: "E", at: 0.5 });
    expect(portOfDrop(b, { x: 50, y: 120 })).toEqual({ side: "W", at: 0.2 });
    expect(portOfDrop(b, { x: 150, y: 40 })).toEqual({ side: "N", at: 0.25 });
    expect(portOfDrop(b, { x: 250, y: 300 })).toEqual({ side: "S", at: 0.75 });
  });

  it("breaks ties horizontal", () => {
    expect(portOfDrop(b, { x: 200, y: 150 }).side).toBe("E");
  });
});

describe("portRoute", () => {
  const A = box(0, 0);
  const B = box(300, 0);
  const E: EdgePort = { side: "E" };
  const W: EdgePort = { side: "W" };
  const N: EdgePort = { side: "N" };

  it("runs level through the middle of the gap, end to end", () => {
    expect(routeOf(portRoute(A, E, B, W))).toEqual([
      [100, 20],
      [200, 20],
      [200, 20],
      [300, 20],
    ]);
  });

  it("leaves and enters through the tops", () => {
    const below = box(0, 200);
    const above = box(300, 0);
    expect(routeOf(portRoute(below, N, above, N))).toEqual([
      [50, 200],
      [50, 120],
      [350, 120],
      [350, 0],
    ]);
  });

  it("takes the L corner for mixed sides", () => {
    const low = box(300, 200);
    expect(routeOf(portRoute(A, E, low, N))).toEqual([
      [100, 20],
      [350, 20],
      [350, 200],
    ]);
  });

  it("pins one end and routes the other as always", () => {
    const low = box(300, 200);
    expect(routeOf(portRoute(A, E, low, undefined))).toEqual([
      [100, 20],
      [200, 20],
      [200, 220],
      [350, 220],
    ]);
  });

  it("falls back to the free route when every pinned candidate is blocked", () => {
    const m = box(150, -20, 60, 80);
    const options = { obstacles: [m] };
    expect(routeOf(portRoute(A, E, B, W, options))).toEqual(
      routeOf(freeRoute(A, B, options)),
    );
    expect(routeOf(portRoute(A, E, B, W, options))).toEqual([
      [50, 20],
      [50, 68],
      [350, 68],
      [350, 20],
    ]);
  });

  it("is the free route with no ports anywhere", () => {
    expect(portRoute(A, undefined, B, undefined)).toEqual(freeRoute(A, B));
  });
});
