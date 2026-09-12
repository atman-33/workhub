/**
 * Turning a text selection into an anchor a note can keep, and finding that
 * passage again later (T-0299).
 *
 * The anchor is the quoted text plus which occurrence of it this is, and — when
 * the renderer could report one — the source line. That order is deliberate:
 * a block index would be cheaper, but the documents being annotated sit on a
 * share a colleague also edits, so any anchor that depends on the document
 * standing still is an anchor that silently drifts. The quote survives
 * paragraphs being added above it, and it is also the form the agent can act
 * on, since it re-reads the file rather than trusting our numbering.
 *
 * Everything here walks the DOM of whichever document it is given, so the same
 * functions serve the Markdown preview and the sandboxed frame an HTML file is
 * shown in.
 */

/** What a note stores about where it was put. */
export interface Anchor {
  quote: string;
  /** 0-based: which occurrence of `quote` within the rendered document. */
  occurrence: number;
  /** 1-based source line, when an ancestor carries `data-line`. */
  line?: number;
}

/**
 * The text nodes of `root` in document order, with where each one starts in
 * the document's text.
 *
 * `SCRIPT` and `STYLE` are skipped so a page that embeds a stylesheet does not
 * make its rules part of the text — and, more importantly, so capture and
 * lookup agree on what "the document's text" is. Every offset in this module
 * is relative to this concatenation and to nothing else.
 */
function textNodes(root: Node): {
  nodes: Text[];
  starts: number[];
  text: string;
} {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const tag = node.parentElement?.tagName;
      if (tag === "SCRIPT" || tag === "STYLE") return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push(node as Text);
    starts.push(text.length);
    text += node.nodeValue ?? "";
  }
  return { nodes, starts, text };
}

/** Where a (node, offset) boundary falls in the document's text. */
function offsetOf(index: ReturnType<typeof textNodes>, node: Node, offset: number): number | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const at = index.nodes.indexOf(node as Text);
    return at < 0 ? null : index.starts[at] + offset;
  }
  // An element boundary: the selection starts before its `offset`-th child, so
  // take the first text node from there on.
  const child = node.childNodes[offset] ?? null;
  if (!child) return null;
  for (let i = 0; i < index.nodes.length; i++) {
    if (child === index.nodes[i] || child.contains(index.nodes[i])) return index.starts[i];
  }
  return null;
}

/** The source line of the element a selection starts in, if it is known. */
function lineAt(node: Node): number | undefined {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const carrier = element?.closest("[data-line]");
  const raw = carrier?.getAttribute("data-line");
  const line = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(line) && line > 0 ? line : undefined;
}

/**
 * Reads the anchor out of a live selection.
 *
 * Called while the selection still exists — on the `contextmenu` event, not
 * when the note is saved: focusing the comment box collapses the selection,
 * and a capture done then reads an empty range.
 */
export function captureAnchor(root: Node, range: Range): Anchor | null {
  const quote = range.toString().trim();
  if (!quote) return null;
  const index = textNodes(root);
  const start = offsetOf(index, range.startContainer, range.startOffset);
  // Count how many times the same text appears before this one. A document
  // that repeats a phrase is normal; a note on the third "TODO" must not come
  // back on the first.
  let occurrence = 0;
  if (start !== null) {
    for (
      let at = index.text.indexOf(quote);
      at >= 0 && at < start;
      at = index.text.indexOf(quote, at + 1)
    ) {
      occurrence++;
    }
  }
  return { quote, occurrence, line: lineAt(range.startContainer) };
}

/**
 * Finds the passage an anchor points at, as a Range in `root`'s document.
 *
 * Falls back to the first occurrence when the recorded one is gone, and gives
 * up when the text itself is gone — which is the case the caller has to show,
 * since a note whose passage has been rewritten is exactly the one the reader
 * needs to look at again.
 */
export function findRange(root: Node, anchor: Anchor): Range | null {
  const quote = anchor.quote.trim();
  if (!quote) return null;
  const index = textNodes(root);

  let at = index.text.indexOf(quote);
  if (at < 0) return null;
  for (let seen = 0; seen < anchor.occurrence; seen++) {
    const next = index.text.indexOf(quote, at + 1);
    if (next < 0) break;
    at = next;
  }
  return rangeAt(index, at, at + quote.length);
}

/** A Range over `[start, end)` of the document's text. */
function rangeAt(index: ReturnType<typeof textNodes>, start: number, end: number): Range | null {
  const doc = index.nodes[0]?.ownerDocument;
  if (!doc) return null;
  const place = (offset: number): [Text, number] | null => {
    for (let i = index.nodes.length - 1; i >= 0; i--) {
      const nodeStart = index.starts[i];
      const length = index.nodes[i].nodeValue?.length ?? 0;
      if (offset >= nodeStart && offset <= nodeStart + length) {
        return [index.nodes[i], offset - nodeStart];
      }
    }
    return null;
  };
  const from = place(start);
  const to = place(end);
  if (!from || !to) return null;
  const range = doc.createRange();
  range.setStart(from[0], from[1]);
  range.setEnd(to[0], to[1]);
  return range;
}
