import { describe, expect, it } from "vitest";
import { detectEol, toLf, withEol } from "./note-eol";

describe("note line endings", () => {
  it("detects what a file uses", () => {
    expect(detectEol("a\nb")).toBe("\n");
    expect(detectEol("a\r\nb")).toBe("\r\n");
    expect(detectEol("")).toBe("\n");
  });

  it("normalizes to LF and back", () => {
    expect(toLf("a\r\nb\r\n")).toBe("a\nb\n");
    expect(withEol("a\nb\n", "\r\n")).toBe("a\r\nb\r\n");
    expect(withEol("a\nb\n", "\n")).toBe("a\nb\n");
  });

  it("leaves a lone CR alone — it is not a line ending here", () => {
    expect(toLf("a\rb")).toBe("a\rb");
  });

  it("round-trips a CRLF file unchanged", () => {
    const src = "---\r\ntitle: t\r\n---\r\n\r\n## Nodes\r\n\r\n- N-001 a\r\n";
    expect(withEol(toLf(src), detectEol(src))).toBe(src);
  });
});
