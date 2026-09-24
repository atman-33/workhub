import { describe, expect, it } from "vitest";
import {
  EMPTY_SELECTION,
  formatPaths,
  orderedPaths,
  pathsToCopy,
  rangeSelection,
  toggleSelection,
} from "./multi-select";

const order = ["G:/d/a.md", "G:/d/b.md", "G:/d/c.md", "G:/d/e.md"];
const [a, b, c, e] = order;

describe("toggleSelection", () => {
  it("carries the open file along on the first pick", () => {
    expect(toggleSelection(EMPTY_SELECTION, c, order, a)).toEqual({ paths: [a, c], anchor: c });
  });

  it("does not carry an open file that is not on screen", () => {
    expect(toggleSelection(EMPTY_SELECTION, c, order, "G:/other/x.md").paths).toEqual([c]);
  });

  it("does not double the open file when it is the one clicked", () => {
    expect(toggleSelection(EMPTY_SELECTION, a, order, a).paths).toEqual([a]);
  });

  it("takes a picked file out again", () => {
    const sel = { paths: [a, c], anchor: c };
    expect(toggleSelection(sel, a, order, a)).toEqual({ paths: [c], anchor: a });
  });
});

describe("rangeSelection", () => {
  it("picks the run from the anchor, either direction", () => {
    expect(rangeSelection({ paths: [e], anchor: e }, b, order, "").paths).toEqual([b, c, e]);
    expect(rangeSelection({ paths: [a], anchor: a }, c, order, "").paths).toEqual([a, b, c]);
  });

  it("keeps the anchor so a second shift-click resizes the range", () => {
    const first = rangeSelection({ paths: [a], anchor: a }, e, order, "");
    expect(rangeSelection(first, b, order, "")).toEqual({ paths: [a, b], anchor: a });
  });

  it("starts at the open file when there is no anchor", () => {
    expect(rangeSelection(EMPTY_SELECTION, c, order, b)).toEqual({ paths: [b, c], anchor: b });
  });

  it("is just the clicked file with neither", () => {
    expect(rangeSelection(EMPTY_SELECTION, c, order, "").paths).toEqual([c]);
  });

  it("ignores a click on something not in the list", () => {
    const sel = { paths: [a], anchor: a };
    expect(rangeSelection(sel, "G:/x.md", order, "")).toBe(sel);
  });
});

describe("pathsToCopy", () => {
  const sel = { paths: [e, a], anchor: a };

  it("copies the whole selection in screen order from a picked row", () => {
    expect(pathsToCopy(sel, e, order)).toEqual([a, e]);
  });

  it("copies only the clicked row from outside the selection", () => {
    expect(pathsToCopy(sel, b, order)).toEqual([b]);
  });
});

describe("orderedPaths", () => {
  it("puts picked paths that left the list last", () => {
    expect(orderedPaths({ paths: ["G:/gone.md", c, a], anchor: a }, order)).toEqual([
      a,
      c,
      "G:/gone.md",
    ]);
  });
});

describe("formatPaths", () => {
  it("writes Windows paths, one per CRLF line", () => {
    expect(formatPaths([a, "//server/share/x.md"])).toBe(
      "G:\\d\\a.md\r\n\\\\server\\share\\x.md",
    );
  });
});
