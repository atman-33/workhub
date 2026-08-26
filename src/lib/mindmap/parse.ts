/**
 * Mindmap note <-> document model.
 *
 * The note is Markdown a human also edits in Obsidian, so parsing is
 * deliberately forgiving and serialization is deliberately conservative — the
 * same contract as `lib/schedule/parse.ts`:
 *
 * - Anything the grammar does not recognize is **kept, not dropped**. A line
 *   under `## Nodes` that is not a list item survives as a `raw` line and is
 *   written back verbatim.
 * - Only `## Nodes` is rewritten. The frontmatter block (apart from
 *   `updated`), `## Memo`, and every other section are copied byte-for-byte,
 *   which is what lets the app, Obsidian and the AI edit the same file without
 *   stepping on each other.
 *
 * The grammar:
 *
 *   - <id> <title> [#<color>] [task:<task-id>] [^collapsed]
 *     <optional continuation lines, indented — the node's note>
 *
 * Nesting is expressed by indentation, two spaces per level, exactly as
 * Obsidian renders a nested bullet list. A node's *position* is not stored at
 * all: the canvas lays the tree out every time it draws it, so the file stays
 * something a human can read and edit, and a hand-typed bullet list is already
 * a valid mindmap.
 *
 * `<id>` is optional on input. A tree typed by hand in Obsidian has no ids;
 * `parseMindmap` mints them (see `assignMissingIds`) so that every later edit —
 * from the app or from an agent — has something stable to refer to.
 */

/**
 * Colors are a fixed list rather than free-form values: the canvas, the HTML
 * export and the PNG export must render a note identically, and only a closed
 * set can guarantee that without shipping a color parser to each of them.
 *
 * Kept deliberately identical to the schedule palette so that one project's
 * notes read as one set of documents.
 */
export const COLORS = ["blue", "green", "amber", "red", "purple", "gray"] as const;
export type Color = (typeof COLORS)[number];

export const COLOR_HEX: Record<Color, string> = {
  blue: "#3b82f6",
  green: "#22c55e",
  amber: "#f59e0b",
  red: "#ef4444",
  purple: "#a855f7",
  gray: "#6b7280",
};

/**
 * How wide a node box is allowed to be.
 *
 * `auto` sizes every box to its own text, which packs the map tightest and is
 * the default. The other two trade that density for a tidier grid, and which
 * one reads better depends on the map — hence a per-note setting rather than
 * one global answer:
 *
 * - `siblings` gives the children of one parent a common width;
 * - `depth` gives every node at the same distance from the root a common
 *   width, which lines the whole map up in columns at the cost of one long
 *   title widening every box on its level.
 */
export const NODE_WIDTHS = ["auto", "siblings", "depth"] as const;
export type NodeWidth = (typeof NODE_WIDTHS)[number];

/** Spaces of indentation that make up one level of nesting. */
const INDENT = "  ";

export interface MindmapNode {
  /**
   * Stable, file-unique id (`N-001`). Never reassigned and never reused — it is
   * how the AI, the undo snapshot and the UI agree on which node is which
   * across an edit that moves it somewhere else in the tree.
   */
  id: string;
  /** First line of the node's text. */
  title: string;
  color?: Color;
  /** Task id this node links to (`T-0042`). */
  task?: string;
  /** Children are hidden on the canvas; the subtree itself is untouched. */
  collapsed?: boolean;
  /**
   * Which side of the root this branch grows on. Only meaningful on a child of
   * a root; ignored anywhere else, since a deeper node always follows its
   * branch.
   *
   * Absent means "wherever the layout puts it" — see `rootChildSide`. The app
   * writes it as soon as the user's action implies a side (adding a sibling of
   * a branch, dragging a branch across the root), because a side that is
   * recomputed on every edit moves branches around under the user's hands.
   */
  side?: "left" | "right";
  /**
   * Free text continued on indented lines under the node. Empty when the node
   * is a single line. The canvas shows it in the node's tooltip rather than on
   * the node, so a long explanation never distorts the layout.
   */
  note?: string;
  children: MindmapNode[];
}

export interface MindmapDocModel {
  /** `title` from the frontmatter; the file name stands in when absent. */
  title: string;
  /**
   * `node_width` from the frontmatter — whether boxes are widened to a common
   * width, and per what grouping.
   *
   * Lives in the note rather than in the app's settings for the same reason
   * the schedule's sprint cadence does: two maps of the same project can want
   * different answers, and an export has to look like what was on screen when
   * it was made, on any machine.
   */
  nodeWidth: NodeWidth;
  /**
   * Top-level nodes. Usually exactly one — a mindmap has a centre — but the
   * grammar allows several, because a file that grew two roots in Obsidian
   * should render, not fail.
   */
  roots: MindmapNode[];
  /** Lines under `## Nodes` the grammar did not recognize, kept verbatim. */
  rawNodes: string[];
  /** True when parsing had to mint at least one id (a hand-written tree). */
  mintedIds: boolean;
}

// ---------------------------------------------------------------------------
// sections
// ---------------------------------------------------------------------------

interface Sections {
  frontmatter: string;
  /** Text between the frontmatter and `## Nodes`. */
  preamble: string;
  nodes: string;
  /** `## Memo` and everything after it — never touched. */
  tail: string;
}

/**
 * Splits the file into the regions serialization needs. A note missing
 * `## Nodes` still parses (the section comes back empty and is written back in
 * place), so a hand-started file is usable rather than rejected.
 */
function splitSections(content: string): Sections {
  let frontmatter = "";
  let rest = content;
  if (content.startsWith("---\n") || content.startsWith("---\r\n")) {
    const end = content.indexOf("\n---", 3);
    if (end !== -1) {
      const after = content.indexOf("\n", end + 1);
      const cut = after === -1 ? content.length : after + 1;
      frontmatter = content.slice(0, cut);
      rest = content.slice(cut);
    }
  }

  const nodesAt = findHeading(rest, "Nodes");
  // The first heading after `## Nodes` ends the managed region. Everything
  // from there on (`## Memo` and any other human section) is opaque tail.
  const tailAt = nodesAt === -1 ? -1 : nextHeading(rest, nodesAt);

  const preamble = nodesAt === -1 ? rest : rest.slice(0, nodesAt);
  const nodes = nodesAt === -1 ? "" : rest.slice(nodesAt, tailAt === -1 ? rest.length : tailAt);
  const tail = nodesAt === -1 ? "" : tailAt === -1 ? "" : rest.slice(tailAt);

  return { frontmatter, preamble, nodes, tail };
}

function findHeading(text: string, name: string): number {
  const re = new RegExp(`^##\\s+${name}\\s*$`, "m");
  return text.search(re);
}

/** Offset of the next `## ` heading strictly after `from`, or -1. */
function nextHeading(text: string, from: number): number {
  const re = /^##\s+/m;
  const rest = text.slice(from + 1);
  const at = rest.search(re);
  return at === -1 ? -1 : from + 1 + at;
}

/** An unknown or missing `node_width` falls back to `auto` rather than being
 * rejected: the value is a display preference, and a typo in it should not
 * stop a note from opening. */
function parseNodeWidth(value: string): NodeWidth {
  return (NODE_WIDTHS as readonly string[]).includes(value) ? (value as NodeWidth) : "auto";
}

export function frontmatterValue(frontmatter: string, key: string): string {
  for (const line of frontmatter.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    if (line.slice(0, idx).trim() !== key) continue;
    return unquote(line.slice(idx + 1).trim());
  }
  return "";
}

function unquote(s: string): string {
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  return s;
}

// ---------------------------------------------------------------------------
// parsing
// ---------------------------------------------------------------------------

const ID_RE = /^N-\d+$/;

interface ParsedLine {
  depth: number;
  node: MindmapNode;
  /** False when the line carried no id and one has to be minted. */
  hadId: boolean;
}

/** `  - N-002 タスク管理 #green task:T-0042 ^collapsed` */
function parseNodeLine(line: string): ParsedLine | null {
  const m = /^(\s*)-\s+(.*)$/.exec(line);
  if (!m) return null;
  const [, indent, bodyRaw] = m;
  const body = bodyRaw.trim();
  if (!body) return null;

  // Tabs are worth one level each; Obsidian may emit either.
  const depth = Math.floor(indent.replace(/\t/g, INDENT).length / INDENT.length);

  const tokens = body.split(/\s+/).filter(Boolean);
  let id = "";
  let hadId = false;
  if (ID_RE.test(tokens[0])) {
    id = tokens[0];
    hadId = true;
    tokens.shift();
  }

  let color: Color | undefined;
  let task: string | undefined;
  let collapsed = false;
  let side: "left" | "right" | undefined;
  const titleTokens: string[] = [];
  // Modifiers may appear in any order; anything left over is the title. A
  // title is free text, so an unrecognized `#word` stays part of it rather
  // than being silently eaten as a bad color.
  for (const tok of tokens) {
    if (tok.startsWith("#") && (COLORS as readonly string[]).includes(tok.slice(1))) {
      color = tok.slice(1) as Color;
    } else if (tok.startsWith("task:") && tok.length > 5) {
      task = tok.slice(5);
    } else if (tok === "^collapsed") {
      collapsed = true;
    } else if (tok === "^left" || tok === "^right") {
      side = tok.slice(1) as "left" | "right";
    } else {
      titleTokens.push(tok);
    }
  }

  return {
    depth,
    hadId,
    node: {
      id,
      title: titleTokens.join(" "),
      children: [],
      ...(color ? { color } : {}),
      ...(task ? { task } : {}),
      ...(collapsed ? { collapsed: true } : {}),
      ...(side ? { side } : {}),
    },
  };
}

/** An indented line that does not open a new list item continues the previous
 * one — ordinary Markdown list continuation, which is why a node written this
 * way still renders as a single item in Obsidian. */
function isContinuation(line: string): boolean {
  return /^\s+/.test(line) && !/^\s*-\s/.test(line);
}

/**
 * Parses a mindmap note.
 *
 * `fallbackTitle` (usually the file name) stands in when the frontmatter has
 * no `title`.
 */
export function parseMindmap(content: string, fallbackTitle = ""): MindmapDocModel {
  const s = splitSections(content);
  const doc: MindmapDocModel = {
    title: frontmatterValue(s.frontmatter, "title") || fallbackTitle,
    nodeWidth: parseNodeWidth(frontmatterValue(s.frontmatter, "node_width")),
    roots: [],
    rawNodes: [],
    mintedIds: false,
  };

  // `stack[d]` is the node most recently opened at depth d — the parent a node
  // at depth d+1 attaches to. A line that jumps more than one level deeper
  // attaches to the deepest open node instead of inventing empty parents.
  const stack: MindmapNode[] = [];
  const notes = new Map<MindmapNode, string[]>();
  let open: MindmapNode | null = null;

  const lines = s.nodes.split("\n");
  for (const line of lines) {
    if (/^##\s+/.test(line)) continue; // the `## Nodes` heading itself
    if (!line.trim()) continue;

    const parsed = parseNodeLine(line);
    if (parsed) {
      const depth = Math.min(parsed.depth, stack.length);
      if (depth === 0) doc.roots.push(parsed.node);
      else stack[depth - 1].children.push(parsed.node);
      stack.length = depth;
      stack.push(parsed.node);
      if (!parsed.hadId) doc.mintedIds = true;
      open = parsed.node;
      continue;
    }
    if (open && isContinuation(line)) {
      const collected = notes.get(open);
      if (collected) collected.push(line.trim());
      else notes.set(open, [line.trim()]);
      continue;
    }
    open = null;
    doc.rawNodes.push(line.trimEnd());
  }
  for (const [node, collected] of notes) node.note = collected.join("\n");

  assignMissingIds(doc);
  return doc;
}

/**
 * Gives every id-less node an id, and repairs duplicates.
 *
 * Both cases come from the same place: a human (or an agent) typing bullets in
 * Obsidian, or copy-pasting a subtree. Ids matter enough that the app mints
 * them on read rather than refusing the file — and because the first save
 * writes them back, a note only goes through this once.
 */
function assignMissingIds(doc: MindmapDocModel): void {
  const seen = new Set<string>();
  let max = 0;
  visit(doc.roots, (node) => {
    const n = /^N-(\d+)$/.exec(node.id);
    if (n) max = Math.max(max, Number(n[1]));
  });
  visit(doc.roots, (node) => {
    if (!node.id || seen.has(node.id)) {
      max += 1;
      node.id = formatId(max);
      doc.mintedIds = true;
    }
    seen.add(node.id);
  });
}

function formatId(n: number): string {
  return `N-${String(n).padStart(3, "0")}`;
}

/** Depth-first walk, parents before children. */
export function visit(nodes: MindmapNode[], fn: (node: MindmapNode, parent?: MindmapNode) => void): void {
  const walk = (list: MindmapNode[], parent?: MindmapNode) => {
    for (const node of list) {
      fn(node, parent);
      walk(node.children, node);
    }
  };
  walk(nodes);
}

/** Next free `N-NNN` for this document. Ids are never reused. */
export function nextNodeId(roots: MindmapNode[]): string {
  let max = 0;
  visit(roots, (node) => {
    const n = /^N-(\d+)$/.exec(node.id);
    if (n) max = Math.max(max, Number(n[1]));
  });
  return formatId(max + 1);
}

export function findNode(roots: MindmapNode[], id: string): MindmapNode | null {
  let found: MindmapNode | null = null;
  visit(roots, (node) => {
    if (node.id === id) found = node;
  });
  return found;
}

export function findParent(roots: MindmapNode[], id: string): MindmapNode | null {
  let found: MindmapNode | null = null;
  visit(roots, (node, parent) => {
    if (node.id === id && parent) found = parent;
  });
  return found;
}

// ---------------------------------------------------------------------------
// serialization
// ---------------------------------------------------------------------------

/** Renders one node and its subtree, one line per node plus any note lines. */
export function formatNode(node: MindmapNode, depth = 0): string[] {
  const pad = INDENT.repeat(depth);
  const parts = [node.id];
  // Only ever the first line: a stray newline in the title would otherwise
  // emit a second, unparsable node line.
  const title = node.title.split("\n")[0].trim();
  if (title) parts.push(title);
  if (node.color) parts.push(`#${node.color}`);
  if (node.task) parts.push(`task:${node.task}`);
  if (node.collapsed) parts.push("^collapsed");
  if (node.side) parts.push(`^${node.side}`);

  const out = [`${pad}- ${parts.join(" ")}`];
  const note = (node.note ?? "").replace(/\s+$/, "");
  if (note) {
    for (const line of note.split("\n")) out.push(`${pad}${INDENT}${line}`);
  }
  for (const child of node.children) out.push(...formatNode(child, depth + 1));
  return out;
}

/**
 * Renders the model back into `content`, replacing only `## Nodes` and
 * stamping `updated`. Unrecognized lines are appended after the recognized
 * ones so nothing is lost, and every other byte of the file — the rest of the
 * frontmatter, `## Memo`, stray sections — is carried through.
 */
export function serializeMindmap(content: string, doc: MindmapDocModel, today: string): string {
  const s = splitSections(content);
  let frontmatter = setFrontmatterValue(s.frontmatter, "updated", today);
  // `auto` is the default, so it is written as the absence of the key — a note
  // only carries the setting once it has been changed away from the default.
  frontmatter =
    doc.nodeWidth === "auto"
      ? removeFrontmatterKey(frontmatter, "node_width")
      : setFrontmatterValue(frontmatter, "node_width", doc.nodeWidth);

  const body = [...doc.roots.flatMap((root) => formatNode(root)), ...doc.rawNodes].join("\n");
  const nodes = `## Nodes\n\n${body}${body ? "\n" : ""}\n`;

  return `${frontmatter}${s.preamble}${nodes}${s.tail}`;
}

/** Drops one frontmatter key, leaving every other line as it was. */
function removeFrontmatterKey(frontmatter: string, key: string): string {
  if (!frontmatter) return frontmatter;
  const lines = frontmatter.split("\n").filter((line) => {
    const idx = line.indexOf(":");
    return idx === -1 || line.slice(0, idx).trim() !== key;
  });
  return lines.join("\n");
}

/** Rewrites one frontmatter key in place, appending it when absent. */
function setFrontmatterValue(frontmatter: string, key: string, value: string): string {
  if (!frontmatter) return frontmatter;
  const lines = frontmatter.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const idx = lines[i].indexOf(":");
    if (idx === -1) continue;
    if (lines[i].slice(0, idx).trim() !== key) continue;
    lines[i] = `${key}: ${value}`;
    return lines.join("\n");
  }
  // No such key: insert before the closing `---`.
  const closing = lines.lastIndexOf("---");
  if (closing > 0) lines.splice(closing, 0, `${key}: ${value}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// tree edits
// ---------------------------------------------------------------------------

/**
 * Which side of the root a branch grows on.
 *
 * An explicit `^left` / `^right` wins; otherwise branches alternate by their
 * position in the list. Alternating (rather than balancing by subtree size,
 * which is what this started as) is what makes the map hold still: appending a
 * branch cannot change where any existing branch sits, so the map the user is
 * looking at does not rearrange itself as they type.
 */
export function rootChildSide(node: MindmapNode, index: number): "left" | "right" {
  return node.side ?? (index % 2 === 0 ? "right" : "left");
}

/**
 * Writes out the side every branch is currently drawn on, so that an insertion
 * or a removal in the middle of the list cannot shift the others across the
 * root. Called before any edit that changes the shape of a root's child list.
 */
export function freezeRootChildSides(root: MindmapNode): void {
  root.children.forEach((child, index) => {
    child.side = rootChildSide(child, index);
  });
}

/** Deep copy, so an edit can be applied to a candidate tree and discarded. */
export function cloneNodes(nodes: MindmapNode[]): MindmapNode[] {
  return nodes.map((node) => ({ ...node, children: cloneNodes(node.children) }));
}

/** Removes a node and its subtree, returning the detached node. */
export function detachNode(roots: MindmapNode[], id: string): MindmapNode | null {
  const from = (list: MindmapNode[]): MindmapNode | null => {
    const idx = list.findIndex((n) => n.id === id);
    if (idx !== -1) return list.splice(idx, 1)[0];
    for (const node of list) {
      const hit = from(node.children);
      if (hit) return hit;
    }
    return null;
  };
  return from(roots);
}

/** Every id in a subtree, including its root's — what a move has to refuse to
 * drop onto, since a node cannot become its own descendant. */
export function subtreeIds(node: MindmapNode): Set<string> {
  const ids = new Set<string>([node.id]);
  visit(node.children, (n) => ids.add(n.id));
  return ids;
}

/**
 * Moves `id` under `parentId` at `index` (appended when omitted). Returns a
 * new tree, or `null` when the move is not allowed — the node does not exist,
 * or the target is inside the node's own subtree.
 */
export function moveNode(
  roots: MindmapNode[],
  id: string,
  parentId: string,
  index?: number,
): MindmapNode[] | null {
  if (id === parentId) return null;
  const next = cloneNodes(roots);
  const moving = findNode(next, id);
  if (!moving) return null;
  if (subtreeIds(moving).has(parentId)) return null;

  const parent = findNode(next, parentId);
  if (!parent) return null;
  detachNode(next, id);
  const at = index === undefined ? parent.children.length : Math.max(0, Math.min(index, parent.children.length));
  parent.children.splice(at, 0, moving);
  return next;
}
