import { describe, expect, it } from "vitest";
import { isPanelOpen, withPanelOpen } from "./diagram-panels";

describe("diagram panels", () => {
  it("is open unless hidden, per kind and side", () => {
    const hidden = ["flow:right"];
    expect(isPanelOpen(hidden, "flow", "right")).toBe(false);
    expect(isPanelOpen(hidden, "flow", "left")).toBe(true);
    expect(isPanelOpen(hidden, "pfd", "right")).toBe(true);
    expect(isPanelOpen([], "schedule", "left")).toBe(true);
  });

  it("hides and restores without duplicates or touching the input", () => {
    const start = ["pfd:left"];
    const hidden = withPanelOpen(start, "mindmap", "right", false);
    expect(hidden).toEqual(["pfd:left", "mindmap:right"]);
    expect(withPanelOpen(hidden, "mindmap", "right", false)).toEqual(hidden);
    expect(withPanelOpen(hidden, "mindmap", "right", true)).toEqual(["pfd:left"]);
    expect(start).toEqual(["pfd:left"]);
  });
});
