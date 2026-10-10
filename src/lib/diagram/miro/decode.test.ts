import { describe, expect, it } from "vitest";
import { decodeMiroData, decodeMiroHtml, extractMiroBase64 } from "./decode";
import { encodeMiroData, toMiroHtml, type MiroPayload } from "./encode";
import connectorLabel from "./fixtures/connector-label.json";
import frameWithRect from "./fixtures/frame-with-rect.json";
import rectText from "./fixtures/rect-text.json";
import shapeRounded from "./fixtures/shape-rounded.json";
import stickyText from "./fixtures/sticky-text.json";
import textOnly from "./fixtures/text-only.json";

/**
 * Codec round trips against the stripped Miro samples. The fixtures are
 * real clipboard decodings with only `boardId`/`orgId` blanked, so a
 * round trip through our codec proves `decode.ts` reads Miro-shaped data
 * (and that the encoder's base64 is byte-stable).
 */
const fixtures: Record<string, unknown> = {
  "connector-label": connectorLabel,
  "frame-with-rect": frameWithRect,
  "rect-text": rectText,
  "shape-rounded": shapeRounded,
  "sticky-text": stickyText,
  "text-only": textOnly,
};

describe("miro decode", () => {
  it.each(Object.keys(fixtures))("round-trips the %s sample", (name) => {
    const fixture = fixtures[name];
    const base64 = encodeMiroData(fixture as MiroPayload);
    expect(decodeMiroData(base64)).toEqual(fixture);
    // Decoding and re-encoding is byte-identical.
    expect(encodeMiroData(decodeMiroData(base64) as MiroPayload)).toBe(base64);
  });

  it.each(Object.keys(fixtures))("reads the %s sample out of clipboard html", (name) => {
    const fixture = fixtures[name];
    const html = toMiroHtml(fixture as MiroPayload, "test");
    expect(decodeMiroHtml(html)).toEqual(fixture);
    expect(extractMiroBase64(html)).toBe(encodeMiroData(fixture as MiroPayload));
  });

  it("decodes Japanese text through the byte shift", () => {
    const payload = {
      text: "テスト",
      nested: { caption: "はい" },
    };
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    let bin = "";
    for (const byte of bytes) bin += String.fromCharCode((byte - 197 + 256) & 255);
    expect(decodeMiroData(btoa(bin))).toEqual(payload);
  });

  it("throws on html without the miro span", () => {
    expect(() => extractMiroBase64("<span>plain</span>")).toThrow();
  });
});
