import { afterEach, describe, expect, it } from "vitest";
import { renderHtml, renderSvg } from "./export";
import { layoutPfd } from "./layout";
import { parsePfd, serializePfd } from "./parse";
import { SYMBOLS } from "./symbols";

const doc = parsePfd(`---
type: pfd
title: 開発の流れ
---

## Nodes

- P-001 要件を整理する
- D-001 要件 <b>定義書</b> task:T-0100 #green
  メモ
- P-002 設計 & 確認 @400,260
- D-002 設計書

## Edges

- P-001 -> D-001
- D-001 -> P-002
- P-002 -> D-002
- P-001 -> P-002

## Stickies

- S-001 node:D-001 @40,-20 #red 要確認
`);

describe("pfd export", () => {
  it("renders a standalone SVG with every node and arrow", () => {
    const svg = renderSvg(doc, { title: doc.title });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("</svg>");
    expect(svg).toContain("開発の流れ");
    expect((svg.match(/<ellipse /g) ?? []).length).toBe(2); // the two processes
    expect((svg.match(/<path d="M [^"]* Z" fill="#ffffff"/g) ?? []).length).toBe(2); // the two documents
    // 4 drawn arrows (the same-kind one too) with a head each.
    expect((svg.match(/stroke="#4b5563"/g) ?? []).length).toBe(4);
    expect(svg).toContain("T-0100");
  });

  it("escapes user text", () => {
    const svg = renderSvg(doc);
    expect(svg).not.toContain("<b>");
    expect(svg).toContain("要件 &lt;b&gt;定義書&lt;/b&gt;");
    expect(svg).toContain("設計 &amp; 確認");
  });

  it("draws the same geometry as the layout the canvas uses", () => {
    const layout = layoutPfd(doc);
    const svg = renderSvg(doc);
    for (const edge of layout.edges) expect(svg).toContain(`d="${edge.geometry.d}"`);
    const ellipse = layout.byId.get("P-002")!;
    expect(svg).toContain(`cx="${ellipse.cx}" cy="${ellipse.cy}"`);
    // The image is exactly the diagram plus margins.
    const m = /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(svg)!;
    expect(Number(m[3])).toBeCloseTo(layout.bounds.width + 64, 5);
    expect(Number(m[4])).toBeCloseTo(layout.bounds.height + 64, 5);
  });

  it("draws stickies only when they are passed (a hidden note exports without them)", () => {
    expect(renderSvg(doc)).not.toContain("要確認");
    expect(renderSvg(doc, { stickies: doc.stickies })).toContain("要確認");
  });

  it("wraps the SVG in a single self-contained page", () => {
    const html = renderHtml(doc, { title: "開発の流れ", exportedOn: "2026-10-10" });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<svg");
    expect(html).not.toMatch(/<script|<link|src=|href=/);
    expect(html).toContain("2026-10-10");
  });
});

describe("a symbol added to the registry", () => {
  const original = SYMBOLS.map((s) => ({ ...s, next: [...s.next] }));
  afterEach(() => {
    SYMBOLS.length = 0;
    SYMBOLS.push(...original.map((s) => ({ ...s, next: [...s.next] })));
  });

  it("parses, lays out, draws and round-trips without touching anything else", () => {
    SYMBOLS.push({
      prefix: "R",
      name: "record",
      shape: "rounded",
      label: { en: "Record", ja: "台帳" },
      next: ["P"],
    });
    // The process may now lead on to it as well - one more entry in its own list.
    SYMBOLS[0].next.push("R");
    const text = `---
type: pfd
title: t
updated: 2026-10-09
---

## Nodes

- P-001 登録する
- R-001 顧客台帳 @300,0
  メモ

## Edges

- P-001 -> R-001
- R-001 -> P-001

## Memo

keep
`;
    const model = parsePfd(text);
    expect(model.nodes.map((n) => n.id)).toEqual(["P-001", "R-001"]);
    expect(model.edges).toHaveLength(2);
    expect(model.rawNodes).toEqual([]);
    expect(layoutPfd(model).byId.get("R-001")).toMatchObject({ shape: "rounded", prefix: "R" });
    const svg = renderSvg(model);
    expect(svg).toContain("顧客台帳");
    expect(svg).toContain("<rect "); // the rounded outline, plus the page background
    expect(serializePfd(text, model, "2026-10-10")).toBe(text.replace("updated: 2026-10-09", "updated: 2026-10-10"));
  });
});
