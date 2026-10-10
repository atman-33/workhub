import { describe, expect, it } from "vitest";
import { renderBody, renderHtml, renderSvg } from "./export";
import { layoutUsecase } from "./layout";
import { parseUsecase } from "./parse";

const doc = parseUsecase(`---
type: usecase
title: 施設予約
---

## Nodes

- U-001 予約システム & 管理 ^system
  hover のメモ
- U-002 窓口 <b>担当者</b> #blue task:T-0100
  空き状況を見る
  予約を代理で登録する & 確認する
- U-003 利用者 @500,420
  申し込む
- U-004 決済サービス ^ext
- U-005 空の人

## Edges

- U-002 -- U-001
- U-003 -- U-001
- U-001 -> U-004 "決済を依頼"
- U-004 -- U-004

## Stickies

- S-001 node:U-003 @40,-30 #red 要確認
`);

describe("usecase export", () => {
  it("renders a standalone SVG with every node, line, label and bubble", () => {
    const svg = renderSvg(doc, { title: doc.title });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("予約システム &amp; 管理");
    expect(svg).toContain("&lt;b&gt;担当者&lt;/b&gt;");
    expect(svg).toContain("決済を依頼");
    expect(svg).toContain("T-0100");
    expect(svg).toContain("空き状況を見る");
    expect(svg).toContain("予約を代理で登録する &amp;");
    expect(svg).toContain(">確認する<");
    expect(svg).not.toContain("<b>");
  });

  it("draws the bullets of the bubble, not the file", () => {
    const svg = renderSvg(doc);
    expect(svg.match(/>・</g)).toHaveLength(3);
  });

  it("matches the on-screen layout: the same boxes, bubbles and lines", () => {
    const layout = layoutUsecase(doc);
    const svg = renderSvg(doc);
    expect(renderBody(layout)).toContain(layout.edges[0].geometry.d);
    expect(svg).toContain(layout.edges[0].geometry.d);
    for (const b of layout.bubbles) {
      // the bubble is one closed path with its tail
      const d = `M ${b.x + 6} ${b.y}`;
      expect(svg).toContain(`d="${d}`);
    }
    for (const n of layout.nodes.filter((x) => x.kind !== "person")) {
      expect(svg).toContain(`x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}"`);
    }
    // a person: the icon path starts at the node's top centre
    const p = layout.byId.get("U-002")!;
    expect(svg).toContain(`<text x="${p.cx}"`);
  });

  it("draws a head for an arrow only", () => {
    const withArrow = renderBody(layoutUsecase(doc));
    const noArrow = renderBody(
      layoutUsecase({ nodes: doc.nodes, edges: doc.edges.map((e) => ({ ...e, arrow: false })) }),
    );
    const heads = (s: string) => (s.match(/fill="#4b5563" \/>/g) ?? []).length;
    expect(heads(withArrow)).toBe(1);
    expect(heads(noArrow)).toBe(0);
  });

  it("draws the external service dashed, the system thick, nothing else dashed", () => {
    const svg = renderSvg(doc);
    expect(svg.match(/stroke-dasharray/g)).toHaveLength(1);
    expect(svg).toContain('stroke-width="2.5"');
  });

  it("draws stickies when given, and none otherwise", () => {
    expect(renderSvg(doc)).not.toContain("要確認");
    expect(renderSvg(doc, { stickies: doc.stickies })).toContain("要確認");
  });

  it("wraps the SVG in a single-file HTML page", () => {
    const html = renderHtml(doc, { title: "施設予約", exportedOn: "2026-10-10" });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<svg");
    expect(html).toContain("施設予約");
  });

  it("renders an empty diagram without throwing", () => {
    expect(renderSvg({ nodes: [], edges: [] })).toContain("<svg");
  });
});
