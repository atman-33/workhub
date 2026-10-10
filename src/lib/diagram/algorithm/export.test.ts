import { describe, expect, it } from "vitest";
import { renderHtml, renderSvg } from "./export";
import { layoutAlgorithm } from "./layout";
import { parseAlgorithm } from "./parse";

const doc = parseAlgorithm(`---
type: algorithm
title: 注文の在庫引当
---

## Nodes

- A-001 引当開始 ^start
- A-002 注文 <b>を</b> 読み込む ^io task:T-0100
  メモ
- A-003 在庫あり? ^decision
- A-004 引き当てる & 記録 ^sub #green
- A-005 入荷を待つ @420,300
- A-006 帳票を出す ^doc
- A-007 終了 ^end

## Edges

- A-001 -> A-002
- A-002 -> A-003
- A-003 -> A-004 "はい"
- A-003 -> A-005 "いいえ"
- A-004 -> A-006
- A-006 -> A-007
- A-005 -> A-002 "入荷後に再試行"
- A-007 -> A-007

## Stickies

- S-001 node:A-003 @40,-30 #red 要確認
`);

describe("algorithm export", () => {
  it("renders a standalone SVG with every node, arrow and label", () => {
    const svg = renderSvg(doc, { title: doc.title });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("</svg>");
    expect(svg).toContain("注文の在庫引当");
    expect((svg.match(/<polygon /g) ?? []).length).toBe(2); // the input and the decision
    expect(svg).toContain("はい");
    expect(svg).toContain("いいえ");
    expect(svg).toContain("入荷後に再試行");
    expect(svg).toContain("T-0100");
    // 8 arrows are written, the one to itself is not drawn: 7 lines with a head each.
    expect((svg.match(/stroke="#4b5563"/g) ?? []).length).toBe(7);
    expect((svg.match(/<path d="M [^"]*" fill="#4b5563"/g) ?? []).length).toBe(7);
  });

  it("draws each kind with its own outline", () => {
    const svg = renderSvg(doc);
    expect(svg).toContain("<rect "); // page, a process, the terminals
    expect((svg.match(/<polygon /g) ?? []).length).toBeGreaterThanOrEqual(2); // io + diamond
    // The predefined process is one path with the two inner rules in it.
    expect(svg).toMatch(/<path d="M [^"]*" fill="#ffffff" stroke="#22c55e"/);
  });

  it("escapes user text", () => {
    const svg = renderSvg(doc);
    expect(svg).not.toContain("<b>");
    expect(svg).toContain("注文 &lt;b&gt;を&lt;/b&gt; 読み込む");
    expect(svg).toContain("引き当てる &amp; 記録");
  });

  it("draws the same geometry as the layout the canvas uses", () => {
    const layout = layoutAlgorithm(doc);
    const svg = renderSvg(doc);
    for (const edge of layout.edges) expect(svg).toContain(`d="${edge.geometry.d}"`);
    for (const edge of layout.edges) {
      if (!edge.labelBox) continue;
      expect(svg).toContain(`<rect x="${edge.labelBox.x}" y="${edge.labelBox.y}"`);
    }
    // A pinned node is where the file puts it.
    const pinned = layout.byId.get("A-005")!;
    expect(pinned).toMatchObject({ cx: 420, cy: 300 });
    expect(svg).toContain(`x="${pinned.cx}"`);
    // The image is exactly the diagram plus margins.
    const m = /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(svg)!;
    expect(Number(m[3])).toBeCloseTo(layout.bounds.width + 64, 5);
    expect(Number(m[4])).toBeCloseTo(layout.bounds.height + 64, 5);
  });

  it("draws stickies only when they are passed (a hidden note exports without them)", () => {
    expect(renderSvg(doc)).not.toContain("要確認");
    expect(renderSvg(doc, { stickies: doc.stickies })).toContain("要確認");
  });

  it("draws nothing but a page for an empty note", () => {
    const svg = renderSvg({ nodes: [], edges: [] });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toContain("<path");
  });

  it("wraps the SVG in a single self-contained page", () => {
    const html = renderHtml(doc, { title: "注文の在庫引当", exportedOn: "2026-10-10" });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<svg");
    expect(html).not.toMatch(/<script|<link|src=|href=/);
    expect(html).toContain("2026-10-10");
  });
});
