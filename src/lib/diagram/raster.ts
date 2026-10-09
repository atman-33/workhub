/**
 * Rasterizes an export SVG to a PNG.
 *
 * Going through the very SVG the HTML export embeds, rather than a second
 * renderer, is what keeps the outputs from drifting into slightly different
 * pictures. The 2x scale is for the usual reason - a diagram pasted into a
 * document and then zoomed should not be a blur.
 */

export interface RasterErrors {
  /** The browser could not load the SVG as an image. */
  rasterize: string;
  /** No 2d canvas context was available. */
  canvas: string;
}

/** The pixel size an export SVG declares (`width`/`height` of its root). */
export function svgSize(svg: string): { width: number; height: number } {
  return {
    width: Number(/width="(\d+)"/.exec(svg)?.[1] ?? 800),
    height: Number(/height="(\d+)"/.exec(svg)?.[1] ?? 600),
  };
}

/** The base64 payload of a PNG of `svg` (what `export_*_png` takes). */
export async function svgToPngBase64(svg: string, errors: RasterErrors, scale = 2): Promise<string> {
  const { width, height } = svgSize(svg);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(errors.rasterize));
    img.src = url;
  });
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(errors.canvas);
  ctx.scale(scale, scale);
  ctx.drawImage(image, 0, 0);
  return canvas.toDataURL("image/png").split(",")[1] ?? "";
}
