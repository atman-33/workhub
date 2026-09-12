/**
 * Drawing the passages that carry a note, with the CSS Custom Highlight API
 * (T-0299).
 *
 * The obvious way to mark a range in rendered Markdown is to wrap it in a
 * `<mark>`, and the obvious way to avoid touching the render is to measure the
 * range and lay absolutely-positioned rectangles over it. Both are worse than
 * they look here: wrapping means mutating a tree React owns, and rectangles
 * have to be recomputed on every reflow — and this pane reflows a lot, since
 * its zoom is CSS `zoom` and its width is a draggable split.
 *
 * A highlight registry avoids both. Ranges are handed to the browser, which
 * paints them as part of layout; nothing is inserted into the DOM and nothing
 * needs re-measuring. The ranges do still have to be re-derived after the
 * document re-renders, because the old ones point at discarded nodes.
 *
 * Availability is checked rather than assumed. It is a Chromium 105 feature
 * and the app runs on WebView2, so in practice it is there; when it is not,
 * the caller is told and the notes simply go unmarked — the list in the
 * sidebar is what the feature actually needs to work.
 */

/** The registry name, and the `::highlight()` selector, for noted passages. */
export const NOTE_HIGHLIGHT = "docs-note";

/**
 * The style for the highlight. Injected into the HTML preview's frame, whose
 * CSP allows inline styles; the main document carries the same rule in
 * `src/index.css`.
 */
export const NOTE_HIGHLIGHT_CSS = `::highlight(${NOTE_HIGHLIGHT}) {
  background-color: color-mix(in srgb, var(--primary, #eab308) 28%, transparent);
  text-decoration-line: underline;
  text-decoration-style: wavy;
  text-decoration-color: var(--primary, #eab308);
  text-underline-offset: 3px;
}`;

interface HighlightRegistry {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
}

/** The window's highlight registry, or null where the API is missing. */
function registryOf(view: Window | null): HighlightRegistry | null {
  const css = (view as unknown as { CSS?: { highlights?: HighlightRegistry } } | null)?.CSS;
  return css?.highlights ?? null;
}

/** True when this document can paint highlights at all. */
export function highlightsSupported(doc: Document | null | undefined): boolean {
  const view = doc?.defaultView ?? null;
  return (
    !!registryOf(view) &&
    typeof (view as unknown as { Highlight?: unknown })?.Highlight === "function"
  );
}

/**
 * Paints exactly `ranges` as the noted passages of `doc`, replacing whatever
 * was painted before. An empty list clears them.
 *
 * The `Highlight` constructor is taken from the document's own window: for the
 * HTML preview that is the frame's realm, and a Range from one realm is not
 * accepted by another's constructor.
 */
export function paintNoteHighlights(doc: Document | null | undefined, ranges: Range[]): void {
  const view = doc?.defaultView ?? null;
  const registry = registryOf(view);
  if (!registry) return;
  if (ranges.length === 0) {
    registry.delete(NOTE_HIGHLIGHT);
    return;
  }
  const ctor = (view as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (typeof ctor !== "function") return;
  try {
    registry.set(NOTE_HIGHLIGHT, new ctor(...ranges));
  } catch {
    // A range whose nodes have been replaced since it was made — the caller
    // re-derives them on the next render, so dropping this paint is enough.
    registry.delete(NOTE_HIGHLIGHT);
  }
}

/** Adds the highlight rule to a document that does not carry it (the frame). */
export function injectHighlightStyle(doc: Document): void {
  if (doc.getElementById("docs-note-highlight-style")) return;
  const style = doc.createElement("style");
  style.id = "docs-note-highlight-style";
  style.textContent = NOTE_HIGHLIGHT_CSS;
  doc.head.append(style);
}
