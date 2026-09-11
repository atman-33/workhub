/**
 * Callouts for the Docs tab (T-0275): Obsidian's `> [!note]` blocks, plus the
 * `:::note info` (NotePM) and `:::message` / `:::details` (Zenn) blocks teams
 * write in the notes they drop on a share.
 *
 * Two halves, both plain functions so they can be tested without rendering:
 *
 * - `colonBlocksToCallouts` rewrites the `:::` blocks into callout syntax
 *   before the Markdown is parsed, so there is one rendering path. It is done
 *   on the source rather than with `remark-directive` on purpose: `:::note
 *   info` is not valid directive syntax (the type is a bare word, not a
 *   `{.class}`), and enabling directives would also turn every `a:b` in prose
 *   into a text directive.
 * - `rehypeCallouts` turns a `[!type]` blockquote into the element tree the
 *   `Markdown` component draws as a callout. It runs after `rehype-sanitize`,
 *   so the attributes it adds survive and what it rearranges is already safe.
 */
import type { Element, ElementContent, Root, RootContent } from "hast";

/** The colour/icon family a callout is drawn with. */
export type CalloutKind =
  | "note"
  | "abstract"
  | "info"
  | "todo"
  | "tip"
  | "success"
  | "question"
  | "warning"
  | "failure"
  | "danger"
  | "bug"
  | "example"
  | "quote";

/** Obsidian's built-in types and their aliases. */
const KIND_BY_TYPE: Record<string, CalloutKind> = {
  note: "note",
  abstract: "abstract",
  summary: "abstract",
  tldr: "abstract",
  info: "info",
  todo: "todo",
  tip: "tip",
  hint: "tip",
  important: "tip",
  success: "success",
  check: "success",
  done: "success",
  question: "question",
  help: "question",
  faq: "question",
  warning: "warning",
  caution: "warning",
  attention: "warning",
  failure: "failure",
  fail: "failure",
  missing: "failure",
  danger: "danger",
  error: "danger",
  bug: "bug",
  example: "example",
  quote: "quote",
  cite: "quote",
};

/** Obsidian draws an unknown type as a note; so do we. */
export function calloutKind(type: string): CalloutKind {
  return KIND_BY_TYPE[type.toLowerCase()] ?? "note";
}

/**
 * Callout metadata (`[!type|meta]`) marking a callout that came from a `:::`
 * block. `notitle`: NotePM and Zenn draw their emphasis blocks as a coloured
 * box with no title line. `details`: Zenn's disclosure, drawn as a plain
 * folded box rather than a coloured callout.
 */
const NO_TITLE = "notitle";
const DETAILS = "details";

/**
 * The callout line a `:::` opener becomes: `:::note <type>` (NotePM),
 * `:::message [alert]` and `:::details <title>` (Zenn). `null` for any other
 * block, which is left as written.
 */
function colonBlockMarker(name: string, rest: string): string | null {
  const value = rest.split(/\s+/)[0].toLowerCase();
  if (name === "note") {
    if (value === "warn") return `> [!warning|${NO_TITLE}]`;
    if (value === "alert") return `> [!danger|${NO_TITLE}]`;
    return `> [!info|${NO_TITLE}]`;
  }
  if (name === "message") {
    return `> [!${value === "alert" ? "danger" : "warning"}|${NO_TITLE}]`;
  }
  // Zenn's details start closed, which is Obsidian's `-` fold.
  if (name === "details") return `> [!note|${DETAILS}]- ${rest}`.trimEnd();
  return null;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const COLON_OPEN = /^ {0,3}(:{3,})\s*([A-Za-z][\w-]*)(?:\s+(.*?))?\s*$/;
const COLON_CLOSE = /^ {0,3}(:{3,})\s*$/;

/**
 * Rewrites NotePM / Zenn `:::` blocks into callouts (see `colonBlockMarker`).
 *
 * Fenced code is left alone. Blocks nest; as in Zenn, a closing `:::` line
 * belongs to the innermost open block with the same number of colons, so an
 * outer block can be written `::::`. Other `:::` blocks (Docusaurus' `:::tip`,
 * …) are tracked only so their closing line is not mistaken for ours, and are
 * emitted untouched. A block left open closes at the end of the document —
 * this is a reader, and a missing `:::` should not swallow the page.
 */
export function colonBlocksToCallouts(markdown: string): string {
  if (!markdown.includes(":::")) return markdown;
  const lines = markdown.split(/\r?\n/);
  const out: string[] = [];
  /** Open `:::` blocks, innermost last; `converted` ones add a `> ` level. */
  const open: { colons: number; converted: boolean }[] = [];
  let fence: { char: string; length: number } | null = null;

  const depth = () => open.filter((block) => block.converted).length;
  const prefix = () => "> ".repeat(depth());

  for (const line of lines) {
    if (fence) {
      const close = FENCE.exec(line);
      if (
        close &&
        close[1][0] === fence.char &&
        close[1].length >= fence.length &&
        close[2].trim() === ""
      ) {
        fence = null;
      }
      out.push(prefix() + line);
      continue;
    }

    const opening = FENCE.exec(line);
    if (opening) {
      fence = { char: opening[1][0], length: opening[1].length };
      out.push(prefix() + line);
      continue;
    }

    const closing = COLON_CLOSE.exec(line);
    if (closing) {
      const colons = closing[1].length;
      let index = open.length - 1;
      while (index >= 0 && open[index].colons !== colons) index--;
      if (index >= 0) {
        const block = open[index];
        open.length = index;
        if (block.converted) {
          // A blank line ends the blockquote; without it the next paragraph
          // would be pulled into the callout as a lazy continuation.
          out.push(prefix().trimEnd());
        } else {
          out.push(prefix() + line);
        }
        continue;
      }
    }

    const start = COLON_OPEN.exec(line);
    if (start) {
      const marker = colonBlockMarker(start[2].toLowerCase(), start[3] ?? "");
      const colons = start[1].length;
      if (marker) {
        out.push(prefix() + marker);
        open.push({ colons, converted: true });
      } else {
        out.push(prefix() + line);
        open.push({ colons, converted: false });
      }
      continue;
    }

    out.push(prefix() + line);
  }
  return out.join("\n");
}

const MARKER = /^\s*\[!([^\]|\s]+)(?:\|([^\]]*))?\]([+-]?)[ \t]*/;

/** The element a paragraph's line break becomes (remark-breaks), or a newline. */
function isLineBreak(node: ElementContent): boolean {
  return node.type === "element" && node.tagName === "br";
}

function firstElement(children: ElementContent[]): Element | null {
  for (const child of children) {
    if (child.type === "element") return child;
    if (child.type === "text" && child.value.trim() === "") continue;
    return null;
  }
  return null;
}

/**
 * Splits a callout's first paragraph into its title and whatever follows the
 * first line break, which is the start of the body.
 */
function splitTitle(nodes: ElementContent[]): { title: ElementContent[]; rest: ElementContent[] } {
  const title: ElementContent[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (isLineBreak(node)) {
      const rest = nodes.slice(i + 1);
      const head = rest[0];
      if (head?.type === "text") {
        rest[0] = { ...head, value: head.value.replace(/^\n/, "") };
      }
      return { title, rest };
    }
    if (node.type === "text" && node.value.includes("\n")) {
      const at = node.value.indexOf("\n");
      if (at > 0) title.push({ ...node, value: node.value.slice(0, at) });
      const tail = node.value.slice(at + 1);
      const rest = nodes.slice(i + 1);
      if (tail) rest.unshift({ ...node, value: tail });
      return { title, rest };
    }
    title.push(node);
  }
  return { title, rest: [] };
}

function hasContent(nodes: ElementContent[]): boolean {
  return nodes.some((node) => node.type !== "text" || node.value.trim() !== "");
}

/** Builds the callout tree for a blockquote, or `null` when it is not one. */
function toCallout(quote: Element): Element | null {
  const first = firstElement(quote.children);
  if (!first || first.tagName !== "p") return null;
  const lead = first.children[0];
  if (lead?.type !== "text") return null;
  const match = MARKER.exec(lead.value);
  if (!match) return null;

  const [whole, type, meta = "", fold] = match;
  const remainder = lead.value.slice(whole.length);
  const paragraph: ElementContent[] = [
    ...(remainder ? [{ ...lead, value: remainder }] : []),
    ...first.children.slice(1),
  ];
  const { title, rest } = splitTitle(paragraph);
  const flags = meta.split(/\s+/);
  const noTitle = flags.includes(NO_TITLE);

  const body: ElementContent[] = [];
  // A NotePM/Zenn block has no title line, so anything written on the marker
  // line is body text rather than a title. The converted blocks leave that
  // line empty, and its line break must not open the body with a blank line.
  const leading = noTitle && hasContent(title) ? paragraph : rest;
  if (hasContent(leading)) {
    body.push({ ...first, children: leading });
  }
  body.push(...quote.children.slice(quote.children.indexOf(first) + 1));

  const properties: Element["properties"] = {
    dataCallout: calloutKind(type),
    dataCalloutType: type.toLowerCase(),
  };
  if (fold) properties.dataCalloutFold = fold;
  if (noTitle) properties.dataCalloutNotitle = "";
  if (flags.includes(DETAILS)) properties.dataCalloutDetails = "";

  const children: ElementContent[] = [];
  if (!noTitle) {
    children.push({
      type: "element",
      tagName: "div",
      properties: { dataCalloutTitle: "" },
      children: hasContent(title) ? title : [],
    });
  }
  children.push({
    type: "element",
    tagName: "div",
    properties: { dataCalloutBody: "" },
    children: body,
  });
  return { type: "element", tagName: "div", properties, children };
}

function transform(children: (RootContent | ElementContent)[]) {
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    if (node.type !== "element") continue;
    // Inner quotes first, so a callout nested in a callout is converted too.
    transform(node.children);
    if (node.tagName === "blockquote") {
      const callout = toCallout(node);
      if (callout) children[i] = callout;
    }
  }
}

/**
 * Rehype plugin: `[!type]` blockquotes become
 * `div[data-callout] > div[data-callout-title] + div[data-callout-body]`.
 * The `Markdown` component draws that tree; the attributes are how it finds it.
 */
export function rehypeCallouts() {
  return (tree: Root) => {
    transform(tree.children);
  };
}
