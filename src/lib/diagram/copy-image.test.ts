import { afterEach, describe, expect, it, vi } from "vitest";
import { copyBase64Png, copySvgAsPng, pngBlobFromBase64 } from "./copy-image";

class FakeClipboardItem {
  constructor(public data: Record<string, Blob>) {}
}

function stubClipboard(write: (items: FakeClipboardItem[]) => Promise<void>) {
  vi.stubGlobal("ClipboardItem", FakeClipboardItem);
  vi.stubGlobal("navigator", { clipboard: { write } });
}

/** A 1x1 transparent PNG. */
const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("pngBlobFromBase64", () => {
  it("decodes to an image/png Blob", async () => {
    const blob = pngBlobFromBase64(PIXEL);
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBeGreaterThan(0);
  });

  it("accepts a data: URL prefix", async () => {
    const blob = pngBlobFromBase64(`data:image/png;base64,${PIXEL}`);
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBe((await pngBlobFromBase64(PIXEL).arrayBuffer()).byteLength);
  });

  it("rejects empty input", () => {
    expect(() => pngBlobFromBase64("")).toThrow();
    expect(() => pngBlobFromBase64("data:image/png;base64,")).toThrow();
  });
});

describe("copyBase64Png", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes image/png to the clipboard", async () => {
    let written: FakeClipboardItem[] = [];
    stubClipboard(async (items) => {
      written = items;
    });
    const result = await copyBase64Png(PIXEL);
    expect(result).toEqual({ ok: true });
    expect(written).toHaveLength(1);
    const blob = written[0].data["image/png"];
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBeGreaterThan(0);
  });

  it("reports bad input instead of throwing", async () => {
    stubClipboard(async () => {});
    const result = await copyBase64Png("");
    expect(result.ok).toBe(false);
  });

  it("reports a clipboard failure instead of throwing", async () => {
    stubClipboard(async () => {
      throw new Error("denied");
    });
    const result = await copyBase64Png(PIXEL);
    expect(result).toEqual({ ok: false, error: "denied" });
  });

  it("reports when image clipboard writes are unavailable", async () => {
    vi.stubGlobal("navigator", { clipboard: { write: async () => {} } });
    const result = await copyBase64Png(PIXEL);
    expect(result.ok).toBe(false);
  });
});

describe("copySvgAsPng", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rasterizes and writes in one step", async () => {
    let written: FakeClipboardItem[] = [];
    stubClipboard(async (items) => {
      written = items;
    });
    const result = await copySvgAsPng("<svg></svg>", { rasterize: "r", canvas: "c" }, async () => PIXEL);
    expect(result).toEqual({ ok: true });
    expect(written).toHaveLength(1);
  });

  it("maps a rasterize failure to { ok: false }", async () => {
    stubClipboard(async () => {});
    const result = await copySvgAsPng(
      "<svg></svg>",
      { rasterize: "raster failed", canvas: "c" },
      async () => {
        throw new Error("raster failed");
      },
    );
    expect(result).toEqual({ ok: false, error: "raster failed" });
  });
});
