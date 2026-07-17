import { describe, expect, it } from "vitest";
import {
  AUTO_PASTE_MAX_CHARS,
  AUTO_PASTE_MAX_LINES,
  shouldAutoPaste,
} from "./clipboard-paste";

describe("shouldAutoPaste", () => {
  it("rejects empty text", () => {
    expect(shouldAutoPaste("")).toBe(false);
  });

  it("accepts a short single line (the Slack-link use case)", () => {
    expect(shouldAutoPaste("https://myteam.slack.com/archives/C1/p2")).toBe(true);
  });

  it("accepts exactly the char limit, rejects one past it", () => {
    expect(shouldAutoPaste("a".repeat(AUTO_PASTE_MAX_CHARS))).toBe(true);
    expect(shouldAutoPaste("a".repeat(AUTO_PASTE_MAX_CHARS + 1))).toBe(false);
  });

  it("accepts exactly the line limit, rejects one past it", () => {
    expect(shouldAutoPaste(Array(AUTO_PASTE_MAX_LINES).fill("x").join("\n"))).toBe(true);
    expect(shouldAutoPaste(Array(AUTO_PASTE_MAX_LINES + 1).fill("x").join("\n"))).toBe(
      false,
    );
  });
});
