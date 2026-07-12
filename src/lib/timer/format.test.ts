import { describe, expect, it } from "vitest";
import { formatRemaining } from "./format";

describe("formatRemaining", () => {
  it("formats sub-hour durations as m:ss", () => {
    expect(formatRemaining(0)).toBe("0:00");
    expect(formatRemaining(5)).toBe("0:05");
    expect(formatRemaining(65)).toBe("1:05");
    expect(formatRemaining(30 * 60)).toBe("30:00");
    expect(formatRemaining(59 * 60 + 59)).toBe("59:59");
  });

  it("formats an hour or more as h:mm:ss", () => {
    expect(formatRemaining(3600)).toBe("1:00:00");
    expect(formatRemaining(3661)).toBe("1:01:01");
  });

  it("floors fractional seconds and clamps negatives to zero", () => {
    expect(formatRemaining(9.9)).toBe("0:09");
    expect(formatRemaining(-5)).toBe("0:00");
  });
});
