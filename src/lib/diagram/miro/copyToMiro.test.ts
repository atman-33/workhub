import { afterEach, describe, expect, it, vi } from "vitest";
import { copyToMiro } from "./copyToMiro";
import { emptyScene } from "./model";

class FakeClipboardItem {
  constructor(public data: Record<string, Blob>) {}
}

function stubClipboard(write: (items: FakeClipboardItem[]) => Promise<void>) {
  vi.stubGlobal("ClipboardItem", FakeClipboardItem);
  vi.stubGlobal("navigator", { clipboard: { write } });
}

function sceneWithText() {
  const scene = emptyScene();
  scene.shapes.push({
    kind: "shape",
    key: "P-001",
    shape: "rect",
    cx: 0,
    cy: 0,
    width: 240,
    height: 120,
    text: "テスト",
    border: null,
    fontSize: 13,
  });
  return scene;
}

describe("copyToMiro", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes text/html and text/plain to the clipboard", async () => {
    let written: FakeClipboardItem[] = [];
    stubClipboard(async (items) => {
      written = items;
    });
    const result = await copyToMiro(sceneWithText());
    expect(result).toEqual({ ok: true });
    expect(written).toHaveLength(1);
    const html = await written[0].data["text/html"].text();
    expect(html).toContain("miro-data-v1");
    expect(await written[0].data["text/plain"].text()).toBe("テスト");
  });

  it("reports a clipboard failure instead of throwing", async () => {
    stubClipboard(async () => {
      throw new Error("denied");
    });
    const result = await copyToMiro(sceneWithText());
    expect(result).toEqual({ ok: false, error: "denied" });
  });

  it("reports when HTML clipboard writes are unavailable", async () => {
    vi.stubGlobal("navigator", { clipboard: { write: async () => {} } });
    const result = await copyToMiro(sceneWithText());
    expect(result.ok).toBe(false);
  });
});
