import { describe, expect, it } from "vitest";
import { renderHtml, renderSvg } from "./export";
import { layoutMatrix } from "./layout";
import { parseMatrix } from "./parse";

const NOTE = `---
type: matrix2x2
title: Priorities
x_axis: Effort
x_low: small
x_high: large
y_axis: Impact
q_tl: Do first
---

## Items

- M-001 Quick win @0.20,0.85 #green
- M-002 <script>alert(1)</script> @0.75,0.30

## Stickies

- S-001 node:M-001 @96,24 check me
`;

describe("renderSvg", () => {
  const doc = parseMatrix(NOTE);

  it("draws the grid, the items, the labels and the stickies", () => {
    const svg = renderSvg(doc, { stickies: doc.stickies });
    // Background, four quadrants, two items, one sticky.
    expect(svg.match(/<rect /g)).toHaveLength(1 + 4 + 2 + 1);
    expect(svg).toContain("Quick win");
    expect(svg).toContain("Effort");
    expect(svg).toContain("Do first");
    expect(svg).toContain("check me");
  });

  it("leaves out stickies the caller hides, as the screen does", () => {
    const svg = renderSvg(doc, { stickies: [] });
    expect(svg).not.toContain("check me");
    expect(svg.match(/<rect /g)).toHaveLength(1 + 4 + 2);
  });

  it("does not draw an empty label", () => {
    const svg = renderSvg(doc, { stickies: [] });
    // y_low / y_high / x_axis' siblings that are empty are not in the markup.
    const texts = svg.match(/<text /g)!.length;
    // Items: 2 lines of 1; labels: x_axis, x_low, x_high, y_axis, q_tl.
    expect(texts).toBe(2 + 5);
  });

  it("escapes user text", () => {
    const svg = renderSvg(doc);
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).not.toContain("<script>");
  });

  it("draws from the same geometry as the screen's layout", () => {
    const layout = layoutMatrix(doc, doc.stickies);
    const svg = renderSvg(doc, { stickies: doc.stickies });
    for (const item of layout.items) {
      expect(svg).toContain(`<rect x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}"`);
    }
    for (const sticky of layout.stickies) {
      expect(svg).toContain(`<rect x="${sticky.x}" y="${sticky.y}" width="${sticky.width}"`);
    }
    for (const q of layout.quadrants) {
      expect(svg).toContain(`<rect x="${q.x}" y="${q.y}" width="${q.width}" height="${q.height}"`);
    }
  });

  it("sizes the image to the drawing, margin included", () => {
    const svg = renderSvg(doc);
    const layout = layoutMatrix(doc);
    const w = Number(/width="(\d+)"/.exec(svg)![1]);
    expect(w).toBe(Math.ceil(layout.bounds.width + 64));
  });

  it("draws the title above the matrix when given one", () => {
    const bare = renderSvg(doc);
    const titled = renderSvg(doc, { title: "Priorities" });
    expect(titled).toContain(">Priorities</text>");
    const h = (svg: string) => Number(/height="(\d+)"/.exec(svg)![1]);
    expect(h(titled)).toBeGreaterThan(h(bare));
  });

  it("draws an empty matrix", () => {
    const svg = renderSvg(parseMatrix("---\ntype: matrix2x2\n---\n\n## Items\n"));
    expect(svg).toContain("<svg");
    expect(svg.match(/<rect /g)).toHaveLength(1 + 4);
  });
});

describe("renderHtml", () => {
  it("is one inert file with the title, the date and the drawing", () => {
    const doc = parseMatrix(NOTE);
    const html = renderHtml(doc, { title: "Priorities", exportedOn: "2026-10-10", stickies: [] });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>Priorities</title>");
    expect(html).toContain("exported 2026-10-10");
    expect(html).toContain("<svg");
    // No script, no external reference.
    expect(html).not.toMatch(/<script/);
    expect(html).not.toMatch(/(src|href)="https?:/);
  });
});
