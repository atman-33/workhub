/**
 * Puts each block's source line on the element it renders as, so a note taken
 * in the preview can say where in the file it belongs (T-0299).
 *
 * Two things make this cheap. remark already records every node's position, so
 * nothing has to be counted here; and the Docs tab's own preprocessing keeps
 * the line numbering intact — `expandWikiEmbeds` rewrites within a line and
 * `colonBlocksToCallouts` emits exactly one line per line, so the only
 * difference from the file on disk is the frontmatter lifted off the front.
 * That is what `offset` is for.
 *
 * ## Where this has to run
 *
 * **After `rehype-sanitize`**, which strips `data-*` — the same constraint
 * `rehypeCallouts` works under, and for the same reason (see the header of
 * `src/lib/callouts.ts`). A node with no position is left alone rather than
 * given a guess: raw HTML is re-parsed by `rehype-raw` and the callout
 * elements are synthesized, so "no line" is a normal answer and the note falls
 * back to its quote.
 */
import type { Element, Root } from "hast";

/** The elements worth marking: a block a reader would select text inside. */
const BLOCKS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "blockquote",
  "pre",
  "td",
  "th",
  "figcaption",
]);

/**
 * `offset` is added to every line — the number of lines taken off the front of
 * the source before it was parsed (the frontmatter, plus its two `---` lines).
 */
export function rehypeLineNumbers(options: { offset?: number } = {}) {
  const offset = options.offset ?? 0;
  return (tree: Root) => {
    const visit = (node: Root | Element) => {
      for (const child of node.children) {
        if (child.type !== "element") continue;
        const line = child.position?.start.line;
        if (line !== undefined && BLOCKS.has(child.tagName)) {
          child.properties = {
            ...child.properties,
            "data-line": String(line + offset),
          };
        }
        visit(child);
      }
    };
    visit(tree);
  };
}

/**
 * How many lines were taken off the front of `source` to leave `body`.
 *
 * Measured from the two strings rather than from the frontmatter's content,
 * which cannot tell "no frontmatter" from "an empty one": both leave
 * `splitFrontmatter` returning `""`, and they differ by three lines.
 */
export function frontmatterOffset(source: string, body: string): number {
  const removed = source.slice(0, source.length - body.length);
  let lines = 0;
  for (const ch of removed) if (ch === "\n") lines++;
  return lines;
}
