import { describe, expect, it } from "vitest";

import { optionSearchValue } from "@/lib/combobox-options";

describe("optionSearchValue", () => {
  it("is the option itself when there is no decoration", () => {
    expect(optionSearchValue("B-007")).toBe("B-007");
    expect(optionSearchValue("B-007", {})).toBe("B-007");
  });

  it("carries the label and meta so a title can be searched for", () => {
    expect(optionSearchValue("B-007", { label: "Mindmap", meta: "doing" })).toBe(
      "B-007 Mindmap doing",
    );
  });

  it("skips absent and blank parts instead of leaving separators behind", () => {
    expect(optionSearchValue("B-007", { label: "Mindmap" })).toBe("B-007 Mindmap");
    expect(optionSearchValue("B-007", { meta: "idea" })).toBe("B-007 idea");
    expect(optionSearchValue("B-007", { label: "  ", meta: "" })).toBe("B-007");
  });

  it("trims the parts it keeps", () => {
    expect(optionSearchValue("B-007", { label: " Mindmap " })).toBe("B-007 Mindmap");
  });
});
