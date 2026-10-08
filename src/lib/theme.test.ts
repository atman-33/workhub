import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, isThemePreference, parseTheme, resolveTheme } from "./theme";

describe("parseTheme", () => {
  it("accepts the three preferences", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("system")).toBe("system");
  });

  it("falls back to the default for anything else", () => {
    expect(parseTheme(null)).toBe(DEFAULT_THEME);
    expect(parseTheme("")).toBe(DEFAULT_THEME);
    expect(parseTheme("Light")).toBe(DEFAULT_THEME);
  });
});

describe("isThemePreference", () => {
  it("rejects non-preferences", () => {
    expect(isThemePreference("auto")).toBe(false);
    expect(isThemePreference(undefined)).toBe(false);
  });
});

describe("resolveTheme", () => {
  it("keeps an explicit choice regardless of the OS", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("follows the OS for system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});
