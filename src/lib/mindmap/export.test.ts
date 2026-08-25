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
