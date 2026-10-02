import { describe, expect, it } from "vitest";
import { countLines, MAX_LINES, overBudget } from "./check-claude-md-budget.mjs";

describe("countLines", () => {
  it("does not count the final newline", () => {
    expect(countLines("a\nb\n")).toBe(2);
    expect(countLines("a\nb")).toBe(2);
  });

  it("counts CRLF endings the same as LF", () => {
    expect(countLines("a\r\nb\r\n")).toBe(2);
  });

  it("treats an empty file as zero lines", () => {
    expect(countLines("")).toBe(0);
  });
});

describe("overBudget", () => {
  it("passes at the budget and fails one line past it", () => {
    expect(overBudget(MAX_LINES)).toBeNull();
    expect(overBudget(MAX_LINES + 1)).toContain(`${MAX_LINES + 1} lines`);
  });
});
