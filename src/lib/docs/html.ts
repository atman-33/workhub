/**
 * HTML-file preparation for the Docs tab (T-0271).
 *
 * An HTML file on the share is shown in a sandboxed frame with scripts off, so
 * what the frame gets has to be self-contained: the frame cannot reach the
 * share, and the tab deliberately fetches nothing off the web. Relative images
 * and stylesheets are therefore read through the backend (and its containment
 * guard) and inlined before the document is handed over, and a CSP is written
 * into it so anything left pointing elsewhere stays unloaded.
 *
 * The work is done on a `Document` the caller parsed, which keeps this free of
 * any one DOM implementation — the component passes a `DOMParser` result, the
 * tests a happy-dom one.
 */
import { isExternalSrc, resolveDocRelative } from "./markdown";

/**
 * The policy written into every previewed HTML document: inline styles and
 * `data:` media only. Scripts are already off through the frame's sandbox;
 * this is what keeps the frame off the network.
 */
export const HTML_PREVIEW_CSP =
  "default-src 'none'; img-src data:; media-src data:; font-src data:; style-src 'unsafe-inline'";

/** How the frame gets at the share: both go through the backend's guard. */
export interface HtmlAssetLoaders {
  /** A text file (a stylesheet), by absolute path. */
  readText: (path: string) => Promise<string>;
  /** An image, by absolute path, as a `data:` URI. */
  readImage: (path: string) => Promise<string>;
}

/**
 * Makes `doc` safe and self-contained for the preview frame, in place.
 *
 * - A `<meta http-equiv="refresh">` is removed (it would navigate the frame
 *   away) and so is `<base>` (it would re-point the relative links this just
 *   resolved).
 * - Relative `<img src>` becomes a `data:` URI; `srcset` is dropped, since it
 *   would bypass the rewritten `src`. An image that cannot be read keeps its
 *   original `src`, which the CSP then leaves unloaded — a broken image, not a
 *   broken page.
 * - A relative `<link rel="stylesheet">` becomes a `<style>` with the file's
 *   text. One that cannot be read is dropped.
 * - The CSP meta goes first in `<head>`, ahead of everything it governs.
 *
 * Reads run in parallel: on a streamed Drive share each one can be a network
 * round trip.
 */
export async function prepareHtmlDocument(
  doc: Document,
  docPath: string,
  loaders: HtmlAssetLoaders,
): Promise<void> {
  for (const el of Array.from(doc.querySelectorAll("meta[http-equiv], base"))) {
    const equiv = el.getAttribute("http-equiv")?.toLowerCase();
    if (el.tagName.toLowerCase() === "base" || equiv === "refresh") el.remove();
  }

  const jobs: Promise<void>[] = [];

  for (const img of Array.from(doc.querySelectorAll("img"))) {
    img.removeAttribute("srcset");
    const src = img.getAttribute("src") ?? "";
    const target = localTarget(docPath, src);
    if (!target) continue;
    jobs.push(
      loaders.readImage(target).then(
        (uri) => img.setAttribute("src", uri),
        () => undefined,
      ),
    );
  }

  for (const link of Array.from(doc.querySelectorAll("link"))) {
    const rel = (link.getAttribute("rel") ?? "").toLowerCase().split(/\s+/);
    if (!rel.includes("stylesheet")) continue;
    const target = localTarget(docPath, link.getAttribute("href") ?? "");
    if (!target) continue;
    jobs.push(
      loaders.readText(target).then(
        (css) => {
          const style = doc.createElement("style");
          style.textContent = css;
          link.replaceWith(style);
        },
        () => link.remove(),
      ),
    );
  }

  await Promise.all(jobs);

  const csp = doc.createElement("meta");
  csp.setAttribute("http-equiv", "Content-Security-Policy");
  csp.setAttribute("content", HTML_PREVIEW_CSP);
  doc.head.prepend(csp);
}

/** Serializes a prepared document for the frame's `srcdoc`. */
export function serializeHtmlDocument(doc: Document): string {
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

/**
 * The share path a relative reference points at; `null` for anything else.
 *
 * Stricter than the Markdown side: in HTML `//host/x.css` is a
 * protocol-relative URL, not a UNC path, and a `?v=2` cache-buster or a
 * `#fragment` is not part of the file name.
 */
function localTarget(docPath: string, ref: string): string | null {
  const raw = ref.trim();
  if (!raw || raw.startsWith("//") || isExternalSrc(raw)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[a-z]:[\\/]/i.test(raw)) return null;
  return resolveDocRelative(docPath, raw.replace(/[?#].*$/, ""));
}
