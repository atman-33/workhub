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

describe("usecase symbols", () => {
  it("has a person, a system and an external service, in that order", () => {
    expect(NODE_KINDS).toEqual(["person", "system", "ext"]);
    expect(DEFAULT_KIND).toBe("person");
  });

  it("maps marks to kinds, and an unknown mark to nothing", () => {
    expect(symbolOfMark("^system")?.kind).toBe("system");
    expect(symbolOfMark("^ext")?.kind).toBe("ext");
    expect(symbolOfMark("^person")?.kind).toBe("person");
    expect(symbolOfMark("^foo")).toBeUndefined();
  });

  it("writes a person without a mark and the others with theirs", () => {
    expect(markOfKind("person")).toBe("");
    expect(markOfKind("system")).toBe("^system");
    expect(markOfKind("ext")).toBe("^ext");
  });

  it("falls back to a person for an unknown kind", () => {
    expect(symbolOfKind("nope").kind).toBe("person");
  });

  it("draws a person, a system and an external service with registered shapes", () => {
    expect(shapeOfKind("person")).toBe("person");
    expect(shapeOfKind("system")).toBe("rect");
    expect(shapeOfKind("ext")).toBe("rounded");
    for (const s of SYMBOLS) expect(shapeOf(s.shape).id).toBe(s.shape);
  });

  it("puts only the system in the middle, gives only a person a bubble, and dashes only the external service", () => {
    expect(SYMBOLS.filter((s) => s.centre).map((s) => s.kind)).toEqual(["system"]);
    expect(SYMBOLS.filter((s) => s.bubble).map((s) => s.kind)).toEqual(["person"]);
    expect(SYMBOLS.filter((s) => "dash" in s).map((s) => s.kind)).toEqual(["ext"]);
    expect(symbolOfKind("system").strokeWidth).toBeGreaterThan(symbolOfKind("person").strokeWidth);
  });

  it("gives every symbol a label in both languages", () => {
    for (const s of SYMBOLS) {
      expect(s.label.en).toBeTruthy();
      expect(s.label.ja).toBeTruthy();
    }
  });
});
