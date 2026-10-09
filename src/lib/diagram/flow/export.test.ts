import { describe, expect, it } from "vitest";
import { renderHtml, renderSvg } from "./export";
import { layoutFlow } from "./layout";
import { parseFlow } from "./parse";

const doc = parseFlow(`---
type: flow
title: 受注フロー
---

## Lanes

- L-001 営業 #blue
- L-002 経理

## Steps

- F-001 受注 ^start lane:L-001
- F-002 金額は <b>1万円</b>超? ^decision lane:L-001 task:T-0100
- F-003 承認 & 確認 lane:L-002 #green
- F-004 完了 ^end lane:L-001

## Edges

- F-001 -> F-002
- F-002 -> F-003 "はい"
- F-002 -> F-004 "いいえ"
- F-003 -> F-004
- F-004 -> F-001 "やり直し"
`);

describe("flow export", () => {
  it("renders a standalone SVG with every band, arrow and step", () => {
    const svg = renderSvg(doc, { title: doc.title });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("</svg>");
    expect(svg).toContain("受注フロー");
    // 2 bands + 2 header strips, 5 arrows with heads, 4 steps.
    expect(svg).toContain("営業");
    expect(svg).toContain("経理");
    expect((svg.match(/<polygon /g) ?? []).length).toBe(1); // the decision diamond
    expect(svg).toContain("はい");
    expect(svg).toContain("やり直し");
    expect(svg).toContain("T-0100");
  });

  it("escapes user text", () => {
    const svg = renderSvg(doc);
    expect(svg).not.toContain("<b>");
    expect(svg).toContain("&lt;b&gt;1万円&lt;/b&gt;");
    expect(svg).toContain("承認 &amp; 確認");
  });

  it("draws the same geometry as the layout the canvas uses", () => {
    const layout = layoutFlow(doc);
    const svg = renderSvg(doc);
    for (const edge of layout.edges) expect(svg).toContain(`d="${edge.geometry.d}"`);
    const first = layout.byId.get("F-003")!;
    expect(svg).toContain(`x="${first.x}" y="${first.y}" width="${first.width}" height="${first.height}"`);
    // The image is exactly the diagram plus margins.
    const width = Number(/width="(\d+)"/.exec(svg)![1]);
    expect(width).toBe(Math.ceil(layout.bounds.width + 64));
  });

  it("draws stickies when given, and none when the note hides them", () => {
    const sticky = { id: "S-001", targetId: "F-003", dx: 40, dy: -20, text: "要確認の付箋" };
    expect(renderSvg(doc, { stickies: [sticky] })).toContain("要確認の付箋");
    expect(renderSvg(doc, { stickies: [] })).not.toContain("要確認の付箋");
    expect(renderSvg(doc)).not.toContain("要確認の付箋");
  });

  it("names the unassigned band with the given label", () => {
    const loose = parseFlow("## Lanes\n\n- L-001 a\n\n## Steps\n\n- F-001 x\n");
    expect(renderSvg(loose, { unassignedLabel: "未割当" })).toContain("未割当");
  });

  it("wraps the SVG in a single self-contained page", () => {
    const html = renderHtml(doc, { title: "受注フロー", exportedOn: "2026-10-10" });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<svg");
    // The SVG namespace is the one URL allowed in the file.
    expect(html.replace("http://www.w3.org/2000/svg", "")).not.toMatch(/<script|<link|https?:\/\//);
    // The SVG namespace is the one URL allowed in the file.
  });
});
