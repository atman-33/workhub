import { beforeEach, describe, expect, it } from "vitest";
import {
  allocateIds,
  clipboardShortcut,
  clipboardSubscribe,
  edgesWithin,
  hasClip,
  readClip,
  remapEdges,
  resetClipboard,
  setClip,
  takePasteRound,
} from "./clipboard";

describe("allocateIds", () => {
  it("numbers each prefix after the highest id present", () => {
    const map = allocateIds(["F-001", "F-007", "L-002"], ["F-001", "F-007"]);
    expect(map.get("F-001")).toBe("F-008");
    expect(map.get("F-007")).toBe("F-009");
  });

  it("keeps a separate counter per prefix", () => {
    const map = allocateIds(["P-003", "D-001"], ["P-003", "D-001", "P-001"]);
    expect(map.get("P-003")).toBe("P-004");
    expect(map.get("D-001")).toBe("D-002");
    expect(map.get("P-001")).toBe("P-005");
  });

  it("never reuses the number of an element deleted from the middle", () => {
    const map = allocateIds(["N-001", "N-003"], ["N-001"]);
    expect(map.get("N-001")).toBe("N-004");
  });

  it("starts at 001 for a prefix nobody has used", () => {
    expect(allocateIds([], ["M-010"]).get("M-010")).toBe("M-001");
  });

  it("refuses an id that does not look like one", () => {
    expect(() => allocateIds([], ["nope"])).toThrow();
  });
});

describe("edgesWithin / remapEdges", () => {
  const edges = [
    { from: "F-001", to: "F-002", label: "ok" },
    { from: "F-002", to: "F-003" },
    { from: "F-009", to: "F-001" },
  ];

  it("keeps only the arrows whose two ends are both in the selection", () => {
    expect(edgesWithin(edges, new Set(["F-001", "F-002"]))).toEqual([edges[0]]);
  });

  it("keeps nothing for a lone node", () => {
    expect(edgesWithin(edges, new Set(["F-002"]))).toEqual([]);
  });

  it("rewrites both ends and keeps the other fields", () => {
    const map = new Map([
      ["F-001", "F-010"],
      ["F-002", "F-011"],
    ]);
    expect(remapEdges([edges[0]], map)).toEqual([{ from: "F-010", to: "F-011", label: "ok" }]);
  });
});

describe("the in-app clipboard", () => {
  beforeEach(() => resetClipboard());

  it("hands back what was copied, for the same kind and file", () => {
    setClip("flow", "a.md", { n: 1 });
    expect(readClip("flow", "a.md")?.payload).toEqual({ n: 1 });
    expect(hasClip("flow", "a.md")).toBe(true);
  });

  it("is empty for another file or another kind", () => {
    setClip("flow", "a.md", { n: 1 });
    expect(readClip("flow", "b.md")).toBeNull();
    expect(readClip("pfd", "a.md")).toBeNull();
    expect(hasClip("pfd", "a.md")).toBe(false);
  });

  it("counts pastes, so each one lands a step further on", () => {
    setClip("matrix2x2", "a.md", {});
    expect(takePasteRound("matrix2x2", "a.md")).toBe(1);
    expect(takePasteRound("matrix2x2", "a.md")).toBe(2);
    setClip("matrix2x2", "a.md", {});
    expect(takePasteRound("matrix2x2", "a.md")).toBe(1);
  });

  it("tells subscribers when the clipboard changes", () => {
    let calls = 0;
    const off = clipboardSubscribe(() => calls++);
    setClip("flow", "a.md", {});
    off();
    setClip("flow", "a.md", {});
    expect(calls).toBe(1);
  });
});

describe("clipboardShortcut", () => {
  const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  });

  it("reads Ctrl+C and Ctrl+V, and Cmd on a Mac", () => {
    expect(clipboardShortcut(key("c", { ctrlKey: true }))).toBe("copy");
    expect(clipboardShortcut(key("V", { ctrlKey: true }))).toBe("paste");
    expect(clipboardShortcut(key("v", { metaKey: true }))).toBe("paste");
  });

  it("ignores a bare letter and any extra modifier", () => {
    expect(clipboardShortcut(key("c"))).toBeNull();
    expect(clipboardShortcut(key("v", { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(clipboardShortcut(key("c", { ctrlKey: true, altKey: true }))).toBeNull();
    expect(clipboardShortcut(key("x", { ctrlKey: true }))).toBeNull();
  });
});
