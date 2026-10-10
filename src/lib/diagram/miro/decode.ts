/**
 * Reading `miro-data-v1` back (T-0720).
 *
 * The app never parses Miro data at runtime - this module is for tests and
 * for analysing new samples when Miro changes the format. It inverts
 * `encode.ts` exactly: base64 to bytes, each byte plus 197 (mod 256), UTF-8
 * JSON.
 */

/** Pulls the base64 payload out of clipboard `text/html`. Throws when the span is missing. */
export function extractMiroBase64(html: string): string {
  const unescaped = html.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const m = /<--\(miro-data-v1\)([\s\S]*?)\(\/miro-data-v1\)-->/.exec(unescaped);
  if (!m) throw new Error("no miro-data-v1 span in html");
  return m[1].replace(/\s+/g, "");
}

/** Decodes the base64 in `data-meta` back to the payload object. */
export function decodeMiroData(base64: string): unknown {
  const bin = atob(base64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = (bin.charCodeAt(i) + 197) & 255;
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Decodes clipboard `text/html` straight to the payload object. */
export function decodeMiroHtml(html: string): unknown {
  return decodeMiroData(extractMiroBase64(html));
}
