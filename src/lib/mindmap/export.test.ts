import { describe, expect, it } from "vitest";
import { toHtml, toSvg } from "./export";
import { toMermaid } from "./mermaid";
import { parseMindmap } from "./parse";

const tree = (lines: string[]) =>
  parseMindmap(`---\ntype: mindmap\ntitle: t\n---\n\n## Nodes\n\n${lines.join("\n")}\n`).roots;

const sample = () => tree(["- N-001 root #blue", "  - N-002 tasks #green", "  - N-003 <script>"]);

describe("toSvg", () => {
  it("renders one box per node and one path per edge", () => {
    const svg = toSvg(sample());
    // Three node rects plus the background rect.
    expect(svg.match(/<rect /g)).toHaveLength(4);
    expect(svg.match(/<path /g)).toHaveLength(2);
  });

  it("escapes user text", () => {
    const svg = toSvg(sample());
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).not.toContain("<script>");
  });

  it("sizes the viewBox to the drawing, not to a window", () => {
    const small = toSvg(tree(["- N-001 a"]));
    const large = toSvg(sample());
    const w = (svg: string) => Number(/width="(\d+)"/.exec(svg)![1]);
    expect(w(large)).toBeGreaterThan(w(small));
  });

  it("draws a heading only when one is asked for", () => {
    expect(toSvg(sample(), { title: "my map" })).toContain("my map");
    expect(toSvg(sample())).not.toContain("my map");
  });

  it("marks a collapsed node with its hidden child count", () => {
    const svg = toSvg(tree(["- N-001 root", "  - N-002 p ^collapsed", "    - N-003 x", "    - N-004 y"]));
    expect(svg).toContain("<circle");
    expect(svg).toContain(">2</text>");
  });

  it("renders an empty document without failing", () => {
    expect(toSvg([])).toContain("<svg");
  });

  it("draws the stickies it is given, and none when it is given none", () => {
    const stickies = [{ id: "S-001", nodeId: "N-002", dx: 96, dy: 24, text: "check me" }];
    const withStickies = toSvg(sample(), { stickies });

    expect(withStickies).toContain("check me");
    // The sticky adds its paper to the rect count and its leader line to the
    // path count.
    expect(withStickies.match(/<rect /g)).toHaveLength(5);
    expect(withStickies.match(/<path /g)).toHaveLength(3);
    // A hidden map passes none, and the export then matches the screen.
    expect(toSvg(sample())).not.toContain("check me");
  });

  it("escapes sticky text", () => {
    const svg = toSvg(sample(), {
      stickies: [{ id: "S-001", nodeId: "N-001", dx: 0, dy: 0, text: "<script>" }],
    });
    expect(svg).not.toContain("<script>");
  });
});

describe("toHtml", () => {
  it("is a single self-contained file", () => {
    const html = toHtml(sample(), { title: "ideas", exportedOn: "2026-08-26" });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<svg");
    // Nothing is fetched: no linked stylesheet, image, font or import. (The
    // SVG namespace URL is a name, not a request.)
    expect(html).not.toContain("<link");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("@import");
    expect(html).not.toContain("url(");
    // Inert: nothing to execute.
    expect(html).not.toContain("<script");
  });

  it("includes the mermaid source when given one", () => {
    const html = toHtml(sample(), {
      title: "ideas",
      exportedOn: "2026-08-26",
      mermaid: toMermaid(sample()),
    });
    expect(html).toContain("root((root))");
  });

  it("escapes the title", () => {
    const html = toHtml(sample(), { title: '"><b>x', exportedOn: "2026-08-26" });
    expect(html).not.toContain("<b>x");
  });
});

describe("attributes in the export", () => {
  const attrTree = () => tree(["- N-001 root", "  - N-002 auth prio:high tags:検討中"]);

  it("draws the chips, so an export looks like the screen", () => {
    const svg = toSvg(attrTree());
    expect(svg).toContain("prio: high");
    expect(svg).toContain("検討中");
  });

  it("carries the filter's dimming into the image", () => {
    const svg = toSvg(attrTree(), {
      attrView: { chips: "all", color: "", filter: { key: "prio", value: "high" } },
    });
    expect(svg).toContain("opacity=");
  });

  it("draws nothing extra for a map without attributes", () => {
    expect(toSvg(tree(["- N-001 root", "  - N-002 plain"]))).not.toContain("opacity=");
  });
});
