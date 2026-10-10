import { describe, expect, it } from "vitest";
import { EDGE_LABEL_CANDIDATES, isCandidateLabel } from "./labels";

describe("edge label candidates", () => {
  it("offers yes and no in the interface language, in that order", () => {
    expect(EDGE_LABEL_CANDIDATES.ja).toEqual(["はい", "いいえ"]);
    expect(EDGE_LABEL_CANDIDATES.en).toEqual(["Yes", "No"]);
  });

  it("recognises a candidate in either language, ignoring surrounding space", () => {
    expect(isCandidateLabel("はい")).toBe(true);
    expect(isCandidateLabel(" No ")).toBe(true);
    expect(isCandidateLabel("入荷後に再試行")).toBe(false);
    expect(isCandidateLabel(undefined)).toBe(false);
  });
});
