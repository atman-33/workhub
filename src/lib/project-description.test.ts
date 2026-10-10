import { describe, expect, it } from "vitest";
import {
  DESCRIPTION_MAX_HEIGHT_PX,
  DESCRIPTION_MIN_HEIGHT_PX,
  clampAutoGrowHeight,
  isTruncatedExcerpt,
} from "./project-description";

describe("isTruncatedExcerpt", () => {
  it("flags text ending in the backend's ellipsis", () => {
    expect(isTruncatedExcerpt("A long first paragraph cut…")).toBe(true);
  });

  it("passes plain descriptions through", () => {
    expect(isTruncatedExcerpt("A short blurb.")).toBe(false);
  });

  it("passes an empty description through", () => {
    expect(isTruncatedExcerpt("")).toBe(false);
  });

  it("ignores a mid-text ellipsis", () => {
    expect(isTruncatedExcerpt("Wait… what was that")).toBe(false);
  });
});

describe("clampAutoGrowHeight", () => {
  it("keeps an in-range height as measured", () => {
    expect(clampAutoGrowHeight(120)).toBe(120);
  });

  it("floors short content at the minimum", () => {
    expect(clampAutoGrowHeight(10)).toBe(DESCRIPTION_MIN_HEIGHT_PX);
  });

  it("caps tall content at the maximum, past which the field scrolls", () => {
    expect(clampAutoGrowHeight(10_000)).toBe(DESCRIPTION_MAX_HEIGHT_PX);
  });

  it("falls back to the minimum when nothing was measured", () => {
    expect(clampAutoGrowHeight(NaN)).toBe(DESCRIPTION_MIN_HEIGHT_PX);
  });

  it("honours explicit bounds", () => {
    expect(clampAutoGrowHeight(50, 100, 200)).toBe(100);
    expect(clampAutoGrowHeight(250, 100, 200)).toBe(200);
    expect(clampAutoGrowHeight(150, 100, 200)).toBe(150);
  });
});
