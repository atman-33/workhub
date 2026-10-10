import { describe, expect, it } from "vitest";
import { COLOR_HEX, STICKY_FILL_HEX } from "../colors";
import { colorToMiroRgb, hexToMiroRgb, stickyToMiroRgb } from "./palette";

describe("miro palette", () => {
  it("parses #rrggbb into a 24-bit int", () => {
    expect(hexToMiroRgb("#3b82f6")).toBe(0x3b82f6);
    expect(hexToMiroRgb("#ffffff")).toBe(16777215);
    expect(() => hexToMiroRgb("red")).toThrow();
  });

  it("reuses the app palette for borders and sticky paper", () => {
    expect(colorToMiroRgb("green")).toBe(hexToMiroRgb(COLOR_HEX.green));
    expect(stickyToMiroRgb("red")).toBe(hexToMiroRgb(STICKY_FILL_HEX.red));
  });
});
