/**
 * Copying a diagram to the clipboard as a PNG image (T-0725 part A).
 *
 * The views already know how to draw themselves as an export SVG (the same
 * markup the PNG file export rasterizes via `svgToPngBase64`), so this module
 * only does the last two steps: base64 PNG -> `Blob`, and `Blob` ->
 * clipboard as `ClipboardItem({ "image/png": blob })`.
 *
 * The contract mirrors `copyToMiro`: every entry point returns
 * `{ ok: true }` when the clipboard holds the image and
 * `{ ok: false, error }` otherwise, and never throws. There is deliberately
 * no Rust fallback — like the Miro copy, whether the Tauri WebView2 accepts
 * `ClipboardItem` with `image/png` is unverified and a failure surfaces its
 * reason in the view's status line.
 */

import { svgToPngBase64, type RasterErrors } from "./raster";

export type ImageCopyResult = { ok: true } | { ok: false; error: string };

/** The part of a `data:image/png;base64,...` URL `svgToPngBase64` returns. */
function payloadOf(base64: string): string {
  const comma = base64.lastIndexOf(",");
  return (comma >= 0 ? base64.slice(comma + 1) : base64).replace(/\s/g, "");
}

function decodeBase64(clean: string): Uint8Array<ArrayBuffer> {
  const decoder =
    typeof globalThis.atob === "function"
      ? (s: string) => globalThis.atob(s)
      : // Node fallback (tests): `Buffer` is always available there.
        (s: string) => Buffer.from(s, "base64").toString("binary");
  return Uint8Array.from(decoder(clean), (ch) => ch.charCodeAt(0));
}

/**
 * The pure step: a base64 PNG (with or without its `data:` URL prefix) as an
 * `image/png` Blob. Throws on empty or undecodable input — the `copy*`
 * wrappers below turn that into `{ ok: false, error }`.
 */
export function pngBlobFromBase64(base64: string): Blob {
  const payload = payloadOf(base64);
  if (!payload) throw new Error("the image is empty");
  return new Blob([decodeBase64(payload)], { type: "image/png" });
}

async function writePngBlob(blob: Blob): Promise<ImageCopyResult> {
  try {
    const globals = globalThis as unknown as {
      ClipboardItem?: new (data: Record<string, Blob>) => ClipboardItem;
      navigator?: Navigator | undefined;
    };
    if (!globals.ClipboardItem) {
      return { ok: false, error: "this view cannot write images to the clipboard" };
    }
    const clipboard = globals.navigator?.clipboard;
    if (!clipboard) {
      return { ok: false, error: "no clipboard is available" };
    }
    await clipboard.write([new globals.ClipboardItem({ "image/png": blob })]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Writes an already-rasterized PNG (base64, as `svgToPngBase64` returns) to
 * the clipboard. Never throws. */
export async function copyBase64Png(base64: string): Promise<ImageCopyResult> {
  try {
    return await writePngBlob(pngBlobFromBase64(base64));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The full pipeline a toolbar button calls: rasterize the export SVG the view
 * already builds (the same call its PNG file export makes) and put the image
 * on the clipboard. `rasterize` is injectable so tests can skip the DOM.
 * Never throws.
 */
export async function copySvgAsPng(
  svg: string,
  errors: RasterErrors,
  rasterize: (svg: string, errors: RasterErrors) => Promise<string> = svgToPngBase64,
): Promise<ImageCopyResult> {
  try {
    return await copyBase64Png(await rasterize(svg, errors));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
