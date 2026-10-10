import { describe, expect, it } from "vitest";
import { renderBody, renderHtml, renderSvg } from "./export";
import { layoutArchitecture } from "./layout";
import { parseArchitecture } from "./parse";

const NOTE = `---
type: architecture
title: Booking
created: 2026-10-10
updated: 2026-10-10
---

## Frames

- G-001 Client #blue

## Nodes

- C-001 Screen frame:G-001
- C-002 API frame:G-001

## Edges

- C-001 <-> C-002 "HTTPS"

## Stickies
`;

const docOf = () => parseArchitecture(NOTE);

describe("architecture export", () => {
  it("draws the frame, the blocks and a head at each end of a two-way arrow", () => {
    const doc = docOf();
    const layout = layoutArchitecture(doc);
    const svg = renderSvg(doc, { title: "Booking" });
    const frame = layout.frameById.get("G-001")!;
    expect(svg).toContain(
      `<rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}"`,
    );
    expect(svg).toContain(">Client</text>");
    expect(svg).toContain(">Screen</text>");
    expect(svg).toContain(">API</text>");
    // One line plus two heads, and nothing else filled in edge ink.
    expect(svg.match(/fill="#4b5563"/g)).toHaveLength(2);
    expect(svg).toContain(">HTTPS</text>");
  });

  it("renders what the layout placed: the same body the canvas draws", () => {
    const doc = docOf();
    const layout = layoutArchitecture(doc);
    const body = renderBody(layout);
    for (const n of layout.nodes) {
      // Both blocks are plain rects: the outline carries the placed box.
      expect(body).toContain(`<rect x="${n.x}" y="${n.y}"`);
    }
    expect(layout.bounds.width).toBeGreaterThan(0);
    const framed = renderSvg(doc);
    expect(framed).toContain("<svg");
  });

  it("wraps the drawing in a page with its title", () => {
    const html = renderHtml(docOf(), { title: "Booking", exportedOn: "2026-10-10" });
    expect(html).toContain("Booking");
    expect(html).toContain("<svg");
  });
});
