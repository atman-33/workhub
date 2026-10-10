import { describe, expect, it } from "vitest";
import { DEFAULT_CAPTIONS, renderBody, renderHtml, renderSvg } from "./export";
import { layoutIfdam } from "./layout";
import { parseIfdam } from "./parse";

const doc = parseIfdam(`---
type: ifdam
title: Todo の登録
---

## Nodes

- V-001 Todo 一覧 <b>&</b> ^screen
  show: 登録済みの Todo の一覧
  input: 検索語
  action: 「追加」ボタン
  hover memo
- V-002 「追加」をクリック ^trigger
- V-003 Todo 追加 ^screen #green
- V-004 Todo を登録する task:T-0100
- V-005 Todo ^store
- V-006 「登録しました」を表示する ^message
- V-007 一覧を取得する

## Edges

- V-001 -> V-002
- V-002 -> V-003
- V-003 -> V-004
- V-004 -> V-005
- V-005 -> V-004
- V-004 -> V-006 "成功"
- V-006 -> V-007
- V-007 -> V-001 "戻る"
- V-007 -> V-007

## Stickies

- S-001 node:V-004 @40,-30 #red 要確認
`);

const count = (text: string, needle: string) => text.split(needle).length - 1;

describe("ifdam export", () => {
  it("renders a standalone SVG with every node, arrow and label", () => {
    const svg = renderSvg(doc, { title: doc.title });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("</svg>");
    expect(svg).toContain("Todo の登録");
    expect(svg).toContain("成功");
    expect(svg).toContain("戻る");
    expect(svg).toContain("T-0100");
    expect(count(svg, "<polygon ")).toBe(1); // the trigger
    expect(count(svg, "<ellipse ")).toBe(2); // the two processes
    // 9 arrows are written, the one to itself is not drawn: 8 lines with a head each.
    expect(count(svg, 'stroke="#4b5563"')).toBe(8);
  });

  it("escapes user text", () => {
    const svg = renderSvg(doc);
    expect(svg).toContain("Todo 一覧 &lt;b&gt;&amp;&lt;/b&gt;");
    expect(svg).not.toContain("<b>");
  });

  it("draws a screen's title, section names and items, and nothing of its memo", () => {
    const svg = renderSvg(doc);
    for (const text of ["表示項目", "入力項目", "操作項目", "登録済みの Todo の一覧", "検索語", "「追加」ボタン"]) {
      expect(svg).toContain(text);
    }
    expect(svg).not.toContain("hover memo");
    // a screen with nothing in it has no section names of its own: 3 names, from the first screen only
    expect(count(svg, "表示項目")).toBe(1);
  });

  it("takes the section names as an argument", () => {
    const svg = renderSvg(doc, { captions: { show: "Shows", input: "Inputs", action: "Actions" } });
    expect(svg).toContain("Shows");
    expect(svg).toContain("Inputs");
    expect(svg).toContain("Actions");
    expect(svg).not.toContain("表示項目");
    expect(DEFAULT_CAPTIONS).toEqual({ show: "表示項目", input: "入力項目", action: "操作項目" });
  });

  it("matches the layout the canvas draws: the rules, the box and the arrows", () => {
    const layout = layoutIfdam(doc);
    const svg = renderSvg(doc);
    const screen = layout.byId.get("V-001")!;
    // the outline of the screen is the shape's path with the layout's rules
    expect(svg).toContain(`M ${screen.x} ${screen.y} H ${screen.x + screen.width}`);
    for (const r of screen.rules) {
      expect(svg).toContain(`M ${screen.x} ${Math.round((screen.y + r) * 100) / 100} H ${screen.x + screen.width}`);
    }
    for (const e of layout.edges) expect(svg).toContain(`d="${e.geometry.d}"`);
    // the body is what the frame wraps
    expect(svg).toContain(renderBody(layout));
    // the drawing is inside the image
    const m = /viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/.exec(svg)!;
    expect(Number(m[1])).toBeLessThanOrEqual(layout.bounds.x);
    expect(Number(m[2])).toBeLessThanOrEqual(layout.bounds.y);
    expect(Number(m[1]) + Number(m[3])).toBeGreaterThanOrEqual(layout.bounds.x + layout.bounds.width);
    expect(Number(m[2]) + Number(m[4])).toBeGreaterThanOrEqual(layout.bounds.y + layout.bounds.height);
  });

  it("is the same every time, and draws a bare diagram", () => {
    expect(renderSvg(doc)).toBe(renderSvg(doc));
    const bare = renderSvg({ nodes: [], edges: [] });
    expect(bare.startsWith("<svg")).toBe(true);
  });

  it("draws the stickies it is given and none otherwise", () => {
    expect(renderSvg(doc)).not.toContain("要確認");
    expect(renderSvg(doc, { stickies: doc.stickies })).toContain("要確認");
  });

  it("wraps the SVG in a single-file page with no external reference", () => {
    const html = renderHtml(doc, { title: "Todo の登録", exportedOn: "2026-10-10", stickies: doc.stickies });
    expect(html.startsWith("<!doctype html>") || html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("<svg");
    expect(html).toContain("要確認");
    expect(html).not.toMatch(/(src|href)="https?:/);
  });
});
