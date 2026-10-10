import { describe, expect, it } from "vitest";
import {
  DEFAULT_KIND,
  NODE_KINDS,
  SYMBOLS,
  markOfKind,
  shapeOfKind,
  symbolOfKind,
  symbolOfMark,
} from "./symbols";

describe("architecture symbols", () => {
  it("registers the first five shapes, in file order", () => {
    expect(SYMBOLS.map((s) => s.kind)).toEqual(["block", "round", "db", "user", "cloud"]);
    expect(NODE_KINDS).toEqual(["block", "round", "db", "user", "cloud"]);
    expect(DEFAULT_KIND).toBe("block");
  });

  it("maps every mark to its shape", () => {
    expect(shapeOfKind("block")).toBe("rect");
    expect(shapeOfKind("round")).toBe("rounded");
    expect(shapeOfKind("db")).toBe("cylinder");
    expect(shapeOfKind("user")).toBe("person");
    expect(shapeOfKind("cloud")).toBe("cloud");
  });

  it("reads an explicit ^block as a block, and writes a block without a mark", () => {
    expect(symbolOfMark("^block")?.kind).toBe("block");
    expect(markOfKind("block")).toBe("");
    expect(markOfKind("db")).toBe("^db");
  });

  it("falls back to a block for an unknown kind, and to undefined for an unknown mark", () => {
    expect(symbolOfKind("queue").kind).toBe("block");
    expect(symbolOfMark("^queue")).toBeUndefined();
  });

  it("labels every symbol in both languages", () => {
    for (const s of SYMBOLS) {
      expect(s.label.en.length).toBeGreaterThan(0);
      expect(s.label.ja.length).toBeGreaterThan(0);
    }
  });
});
