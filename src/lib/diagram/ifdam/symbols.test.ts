import { describe, expect, it } from "vitest";
import { shapeOf } from "../shapes";
import {
  DEFAULT_KIND,
  markOfKind,
  nextKindOf,
  NODE_KINDS,
  shapeOfKind,
  SYMBOLS,
  symbolOfKind,
  symbolOfMark,
} from "./symbols";

describe("ifdam symbols", () => {
  it("lists the five elements, each with a distinct kind and mark", () => {
    expect(NODE_KINDS).toEqual(["screen", "trigger", "process", "store", "message"]);
    expect(new Set(SYMBOLS.map((s) => s.mark)).size).toBe(SYMBOLS.length);
    for (const s of SYMBOLS) expect(s.mark).toBe(`^${s.kind}`);
  });

  it("maps every element to the shape the design names", () => {
    expect(shapeOfKind("screen")).toBe("screen");
    expect(shapeOfKind("trigger")).toBe("hexagon");
    expect(shapeOfKind("process")).toBe("ellipse");
    expect(shapeOfKind("store")).toBe("cylinder");
    expect(shapeOfKind("message")).toBe("rounded");
    for (const s of SYMBOLS) {
      expect(shapeOf(s.shape).id).toBe(s.shape); // registered, not the rect fallback
    }
  });

  it("resolves marks, and leaves unknown ones alone", () => {
    expect(symbolOfMark("^store")?.kind).toBe("store");
    expect(symbolOfMark("^process")?.kind).toBe("process");
    expect(symbolOfMark("^foo")).toBeUndefined();
    expect(symbolOfMark("store")).toBeUndefined();
  });

  it("writes no mark for a process, and falls back to it for an unknown kind", () => {
    expect(DEFAULT_KIND).toBe("process");
    expect(markOfKind("process")).toBe("");
    expect(markOfKind("screen")).toBe("^screen");
    expect(symbolOfKind("nonsense").kind).toBe("process");
  });

  it("chains the + button: screen, trigger, process, message, screen; store to process", () => {
    expect(nextKindOf("screen")).toBe("trigger");
    expect(nextKindOf("trigger")).toBe("process");
    expect(nextKindOf("process")).toBe("message");
    expect(nextKindOf("message")).toBe("screen");
    expect(nextKindOf("store")).toBe("process");
  });

  it("names every element in both languages", () => {
    for (const s of SYMBOLS) {
      expect(s.label.en.length).toBeGreaterThan(0);
      expect(s.label.ja.length).toBeGreaterThan(0);
    }
  });
});
