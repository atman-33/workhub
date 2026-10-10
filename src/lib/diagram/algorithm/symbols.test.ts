import { describe, expect, it } from "vitest";
import { shapeOf } from "../shapes";
import {
  DEFAULT_KIND,
  markOfKind,
  NODE_KINDS,
  shapeOfKind,
  SYMBOLS,
  symbolOfKind,
  symbolOfMark,
} from "./symbols";

describe("algorithm symbols", () => {
  it("lists the seven symbols, each with a distinct kind and mark", () => {
    expect(NODE_KINDS).toEqual(["start", "end", "process", "decision", "io", "sub", "doc"]);
    expect(new Set(SYMBOLS.map((s) => s.mark)).size).toBe(SYMBOLS.length);
    for (const s of SYMBOLS) expect(s.mark).toBe(`^${s.kind}`);
  });

  it("maps every symbol to a registered shape (not the rect fallback by accident)", () => {
    expect(shapeOfKind("start")).toBe("pill");
    expect(shapeOfKind("end")).toBe("pill");
    expect(shapeOfKind("process")).toBe("rect");
    expect(shapeOfKind("decision")).toBe("diamond");
    expect(shapeOfKind("io")).toBe("parallelogram");
    expect(shapeOfKind("sub")).toBe("subroutine");
    expect(shapeOfKind("doc")).toBe("document");
    for (const s of SYMBOLS) {
      const outline = shapeOf(s.shape).outline({ x: 0, y: 0, width: 100, height: 40 });
      expect(outline).toBeTruthy();
    }
  });

  it("resolves marks, and leaves unknown ones alone", () => {
    expect(symbolOfMark("^io")?.kind).toBe("io");
    expect(symbolOfMark("^process")?.kind).toBe("process");
    expect(symbolOfMark("^foo")).toBeUndefined();
    expect(symbolOfMark("io")).toBeUndefined();
  });

  it("writes no mark for a process, and falls back to it for an unknown kind", () => {
    expect(DEFAULT_KIND).toBe("process");
    expect(markOfKind("process")).toBe("");
    expect(markOfKind("sub")).toBe("^sub");
    expect(symbolOfKind("nonsense").kind).toBe("process");
  });

  it("names every symbol in both languages", () => {
    for (const s of SYMBOLS) {
      expect(s.label.en.length).toBeGreaterThan(0);
      expect(s.label.ja.length).toBeGreaterThan(0);
    }
  });
});
