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
 *   - <id> <title> [#<color>] [task:<task-id>] [<key>:<value> ...] [^collapsed]
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
import { detectEol, toLf, withEol } from "../note-eol";

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
 * Paper colours for sticky notes: a pale tint of each palette colour, with
 * `COLOR_HEX` serving as the border.
 *
 * Deliberately light in both the app and the exports even though the app is
 * dark-only — a sticky reads as a piece of paper laid on the map, and a dark
 * one reads as just another node box.
 */
export const STICKY_FILL_HEX: Record<Color, string> = {
  blue: "#dbeafe",
  green: "#dcfce7",
  amber: "#fef3c7",
  red: "#fee2e2",
  purple: "#f3e8ff",
  gray: "#e5e7eb",
};

/** Text colour on sticky paper. Fixed, because the paper is fixed. */
export const STICKY_INK = "#1f2937";

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
  /**
   * Free-form `key:value` labels — importance, priority, a grouping tag, or
   * whatever else a map is being sorted by this week.
   *
   * Deliberately an open map rather than named fields: what a node has to be
   * labelled with changes with the map, and every fixed field would be an app
   * change. `task:` stays a field of its own because the app resolves it
   * against the board; everything else lives here.
   *
   * Keys are lowercase and value-free values are dropped, so a title that
   * happens to contain `15:00` or a URL is not silently eaten (see
   * `ATTR_KEY_RE`). Values carry no spaces — the file is whitespace-tokenized.
   */
  attrs?: Record<string, string>;
  children: MindmapNode[];
}

/**
 * The attribute key the UI treats as a list rather than a single value.
 *
 * Only this one key is special-cased, and only in the editor and the chips:
 * the parser stores it like any other attribute, so a map that never uses
 * tags costs nothing for the feature.
 */
export const TAGS_KEY = "tags";

/** Splits a `tags:` value into its members. */
export function parseTags(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Joins tags back into a `tags:` value. Empty means "drop the attribute". */
export function formatTags(tags: string[]): string {
  return tags.map((t) => t.trim()).filter(Boolean).join(",");
}

/**
 * A sticky note pinned to a node.
 *
 * Stickies live in their own `## Stickies` section rather than in the tree,
 * because a sticky is an annotation and not a member of the map: keeping it
 * out of `## Nodes` is what leaves the layout, the mermaid export, the node
 * count and the AI edit skill untouched by the feature.
 *
 * Its position *is* stored — but only ever relative to the node it is pinned
 * to, so the rule the whole feature hangs off still holds: there are no
 * absolute coordinates in the file, the tree is still laid out from scratch
 * every time it is drawn, and a sticky follows its node through any re-flow.
 */
export interface Sticky {
  /**
   * Stable, file-unique id (`S-001`). Never reassigned and never reused — the
   * same contract as a node id, and for the same reason.
   */
  id: string;
  /** Id of the node this sticky is pinned to. */
  nodeId: string;
  /**
   * Offset from the node's centre to the sticky's top-left corner, in diagram
   * pixels. Anchored on the centre rather than on a corner because a node's
   * box grows and shrinks with its title, and its centre moves half as far.
   */
  dx: number;
  dy: number;
  /** Paper colour. Absent means `amber`, the default. */
  color?: Color;
  /** Body text. May span several lines — continuation lines in the file. */
  text: string;
}

/** Where a sticky lands when the file does not say, so that a hand-written
 * `- S-001 node:N-004 text` still appears somewhere sensible. */
export const STICKY_DEFAULT_OFFSET = { dx: 32, dy: 24 };

/** The colour a sticky is drawn in when it carries none of its own. */
export const STICKY_DEFAULT_COLOR: Color = "amber";

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
  /** Sticky notes from `## Stickies`, in file order. */
  stickies: Sticky[];
  /** Lines under `## Stickies` the grammar did not recognize, kept verbatim. */
  rawStickies: string[];
  /**
   * `stickies: hidden` from the frontmatter — the note's own answer to "are
   * the stickies in the way right now".
   *
   * Kept in the note rather than in the app for the same reason `node_width`
   * is: an export has to look like what was on screen when it was made, and
   * the answer belongs to the map, not to the machine it is opened on.
   */
  stickiesHidden: boolean;
  /** How the map's attributes are being looked at right now. */
  attrView: AttrView;
}

/**
 * The note's answer to "how am I reading the attributes today".
 *
 * One object rather than three loose fields because the three always travel
 * together — from the frontmatter to the document model, into the layout, and
 * out to the toolbar — and because they are one idea: a *view* of the map,
 * which is why they live in the note like `node_width` does. An export has to
 * look like what was on screen when it was made.
 */
export interface AttrView {
  /**
   * Which attribute keys are drawn as chips under a node.
   *
   * `"all"` — the default, and the absence of the key in the frontmatter — is
   * what makes the feature free for a map that does not use it: a node with no
   * attributes draws nothing either way, and one that has them shows them
   * without the user having to switch anything on. An empty list is chips off.
   */
  chips: "all" | string[];
  /**
   * Attribute key the nodes are coloured by, or `""` for the note's own
   * colours. Off by default: colouring by an attribute overrides `#color`,
   * which is the user's hand-made structure, so it has to be asked for.
   */
  color: string;
  /**
   * Attribute the map is narrowed to. Non-matching nodes are dimmed, never
   * removed — a mindmap is read through its shape, and hiding a branch would
   * re-flow the map out from under the user.
   */
  filter: { key: string; value: string } | null;
}

/** Chips on, no colouring, no filter — what a note carries no frontmatter for. */
export const DEFAULT_ATTR_VIEW: AttrView = { chips: "all", color: "", filter: null };

// ---------------------------------------------------------------------------
// sections
// ---------------------------------------------------------------------------

interface Sections {
  frontmatter: string;
  /** Text between the frontmatter and the first managed section. */
  preamble: string;
  nodes: string;
  /** Text between the two managed sections, if a human put any there. */
  between: string;
  /** `## Stickies`, empty when the note has none. */
  stickies: string;
  /** `## Memo` and everything after it — never touched. */
  tail: string;
}

/**
 * Splits the file into the regions serialization needs. A note missing
 * `## Nodes` still parses (the section comes back empty and is written back in
 * place), so a hand-started file is usable rather than rejected.
 *
 * There are two managed sections. `## Stickies` is optional and normally sits
 * straight after `## Nodes`; a file that puts it somewhere else still parses,
 * and is written back with the two in the canonical order.
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

  // Each managed section runs from its heading to the next heading of any
  // kind: everything else (`## Memo`, a human's own sections) is opaque and
  // copied through byte-for-byte.
  const region = (name: string): { at: number; end: number } | null => {
    const at = findHeading(rest, name);
    if (at === -1) return null;
    const next = nextHeading(rest, at);
    return { at, end: next === -1 ? rest.length : next };
  };
  const nodes = region("Nodes");
  const stickies = region("Stickies");

  if (!nodes) {
    // No `## Nodes` at all: nothing is managed, so the whole body is preamble
    // and serialization writes the section in at the end of it.
    return { frontmatter, preamble: rest, nodes: "", between: "", stickies: "", tail: "" };
  }
  if (!stickies) {
    return {
      frontmatter,
      preamble: rest.slice(0, nodes.at),
      nodes: rest.slice(nodes.at, nodes.end),
      between: "",
      stickies: "",
      tail: rest.slice(nodes.end),
    };
  }

  const first = Math.min(nodes.at, stickies.at);
  const second = Math.max(nodes.end, stickies.end);
  return {
    frontmatter,
    preamble: rest.slice(0, first),
    nodes: rest.slice(nodes.at, nodes.end),
    between: rest.slice(Math.min(nodes.end, stickies.end), Math.max(nodes.at, stickies.at)),
    stickies: rest.slice(stickies.at, stickies.end),
    tail: rest.slice(second),
  };
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

/** `attr_chips: prio,tags` — absent means every key, `none` means no chips. */
function parseAttrChips(value: string): "all" | string[] {
  const raw = value.trim();
  if (!raw) return "all";
  if (raw === "none") return [];
  const keys = raw
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  return keys.length ? keys : "all";
}

/** `attr_filter: prio=high`. Anything else reads as no filter at all. */
function parseAttrFilter(value: string): { key: string; value: string } | null {
  const at = value.indexOf("=");
  if (at <= 0) return null;
  const key = value.slice(0, at).trim();
  const val = value.slice(at + 1).trim();
  return key && val ? { key, value: val } : null;
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

/**
 * What may stand on the left of the colon in an attribute.
 *
 * Deliberately narrow. A node title is free text a human types, and it is
 * allowed to contain `15:00`, `Q3:目標` or `https://example.com`; a permissive
 * key would quietly swallow all three and reorder the words of the title on
 * the next save. Lowercase-ASCII-only, digit-free first character and a length
 * cap rule those out while still reading naturally (`prio:`, `size:`,
 * `owner:`, `tags:`).
 */
const ATTR_KEY_RE = /^[a-z][a-z0-9_-]{0,23}$/;

/**
 * Whether a string may be used as an attribute key.
 *
 * Exported so the editor can refuse a key the parser would not read back — a
 * key typed as `Prio` or `優先度` would serialize fine and then vanish into the
 * title on the next load, which is the worst kind of bug this file can have.
 */
export function isAttrKey(key: string): boolean {
  return ATTR_KEY_RE.test(key);
}

/**
 * Reads one `key:value` token, or returns null when the token is not an
 * attribute and belongs to the title.
 *
 * A value starting with `//` is rejected so that a bare URL (`http://…`,
 * `https://…`) stays in the title rather than becoming an `http` attribute.
 */
function parseAttrToken(tok: string): [string, string] | null {
  const at = tok.indexOf(":");
  if (at <= 0 || at === tok.length - 1) return null;
  const key = tok.slice(0, at);
  const value = tok.slice(at + 1);
  if (!ATTR_KEY_RE.test(key)) return null;
  if (value.startsWith("//")) return null;
  return [key, value];
}

interface ParsedLine {
  depth: number;
  node: MindmapNode;
  /** False when the line carried no id and one has to be minted. */
  hadId: boolean;
}

/** `  - N-002 タスク管理 #green task:T-0042 prio:high tags:検討中 ^collapsed` */
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
  const attrs: Record<string, string> = {};
  const titleTokens: string[] = [];
  // Modifiers may appear in any order; anything left over is the title. A
  // title is free text, so an unrecognized `#word` stays part of it rather
  // than being silently eaten as a bad color.
  for (const tok of tokens) {
    if (tok.startsWith("#") && (COLORS as readonly string[]).includes(tok.slice(1))) {
      color = tok.slice(1) as Color;
      continue;
    }
    if (tok.startsWith("task:") && tok.length > 5) {
      task = tok.slice(5);
      continue;
    }
    if (tok === "^collapsed") {
      collapsed = true;
      continue;
    }
    if (tok === "^left" || tok === "^right") {
      side = tok.slice(1) as "left" | "right";
      continue;
    }
    // Anything else shaped like `key:value` is an attribute. Checked last so
    // the fields the app resolves itself keep their meaning, and rejected back
    // into the title when it does not look like one (see `parseAttrToken`).
    const attr = parseAttrToken(tok);
    if (attr) {
      // First occurrence wins, so a line that repeats a key round-trips to a
      // single attribute rather than flip-flopping between saves.
      if (!(attr[0] in attrs)) attrs[attr[0]] = attr[1];
      continue;
    }
    titleTokens.push(tok);
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
      ...(Object.keys(attrs).length ? { attrs } : {}),
    },
  };
}

/** An indented line that does not open a new list item continues the previous
 * one — ordinary Markdown list continuation, which is why a node written this
 * way still renders as a single item in Obsidian. */
function isContinuation(line: string): boolean {
  return /^\s+/.test(line) && !/^\s*-\s/.test(line);
}

const STICKY_ID_RE = /^S-\d+$/;
/** `@24,-36` — the offset from the pinned node's centre. */
const OFFSET_RE = /^@(-?\d+),(-?\d+)$/;

/** `- S-001 node:N-004 @24,-36 #amber 見積りは仮` */
function parseStickyLine(line: string): { sticky: Sticky; hadId: boolean } | null {
  const m = /^\s*-\s+(.*)$/.exec(line);
  if (!m) return null;
  const body = m[1].trim();
  if (!body) return null;

  const tokens = body.split(/\s+/).filter(Boolean);
  let id = "";
  let hadId = false;
  if (STICKY_ID_RE.test(tokens[0])) {
    id = tokens[0];
    hadId = true;
    tokens.shift();
  }

  let nodeId = "";
  let color: Color | undefined;
  let dx: number | undefined;
  let dy: number | undefined;
  const textTokens: string[] = [];
  // Modifiers may appear in any order, exactly as on a node line; whatever is
  // left over is the sticky's text, so an unrecognized `#word` or a stray `@`
  // in the prose stays part of it.
  for (const tok of tokens) {
    const offset = OFFSET_RE.exec(tok);
    if (tok.startsWith("node:") && tok.length > 5 && !nodeId) {
      nodeId = tok.slice(5);
    } else if (offset && dx === undefined) {
      dx = Number(offset[1]);
      dy = Number(offset[2]);
    } else if (tok.startsWith("#") && (COLORS as readonly string[]).includes(tok.slice(1))) {
      color = tok.slice(1) as Color;
    } else {
      textTokens.push(tok);
    }
  }
  // Without a node there is nothing to pin to, so the line is not a sticky —
  // the caller keeps it verbatim rather than inventing an anchor for it.
  if (!nodeId) return null;

  return {
    hadId,
    sticky: {
      id,
      nodeId,
      dx: dx ?? STICKY_DEFAULT_OFFSET.dx,
      dy: dy ?? STICKY_DEFAULT_OFFSET.dy,
      text: textTokens.join(" "),
      ...(color ? { color } : {}),
    },
  };
}

/**
 * Parses the `## Stickies` section.
 *
 * Forgiving in the same way the node grammar is: a line it cannot read is
 * handed back to be written out untouched, so hand-editing the section in
 * Obsidian can never cost the user a sticky.
 */
function parseStickies(section: string, doc: MindmapDocModel): void {
  const notes = new Map<Sticky, string[]>();
  let open: Sticky | null = null;

  for (const line of section.split("\n")) {
    if (/^##\s+/.test(line)) continue; // the `## Stickies` heading itself
    if (!line.trim()) continue;

    const parsed = parseStickyLine(line);
    if (parsed) {
      doc.stickies.push(parsed.sticky);
      if (!parsed.hadId) doc.mintedIds = true;
      open = parsed.sticky;
      continue;
    }
    if (open && isContinuation(line)) {
      const collected = notes.get(open);
      if (collected) collected.push(line.trim());
      else notes.set(open, [line.trim()]);
      continue;
    }
    open = null;
    doc.rawStickies.push(line.trimEnd());
  }

  for (const [sticky, collected] of notes) {
    sticky.text = [sticky.text, ...collected].filter(Boolean).join("\n");
  }

  assignMissingStickyIds(doc);
}

/** Gives every id-less sticky an id, and repairs duplicates — the node rule,
 * applied to the other id space. */
function assignMissingStickyIds(doc: MindmapDocModel): void {
  const seen = new Set<string>();
  let max = 0;
  for (const sticky of doc.stickies) {
    const n = /^S-(\d+)$/.exec(sticky.id);
    if (n) max = Math.max(max, Number(n[1]));
  }
  for (const sticky of doc.stickies) {
    if (!sticky.id || seen.has(sticky.id)) {
      max += 1;
      sticky.id = `S-${String(max).padStart(3, "0")}`;
      doc.mintedIds = true;
    }
    seen.add(sticky.id);
  }
}

/** Next free `S-NNN` for this document. Ids are never reused. */
export function nextStickyId(stickies: Sticky[]): string {
  let max = 0;
  for (const sticky of stickies) {
    const n = /^S-(\d+)$/.exec(sticky.id);
    if (n) max = Math.max(max, Number(n[1]));
  }
  return `S-${String(max + 1).padStart(3, "0")}`;
}

/** The stickies pinned to one node, in file order. */
export function stickiesOf(stickies: Sticky[], nodeId: string): Sticky[] {
  return stickies.filter((s) => s.nodeId === nodeId);
}

/** Walks a forest depth-first, roots first. */
export function walkNodes(roots: MindmapNode[]): MindmapNode[] {
  const out: MindmapNode[] = [];
  const visit = (node: MindmapNode) => {
    out.push(node);
    for (const child of node.children) visit(child);
  };
  for (const root of roots) visit(root);
  return out;
}

/**
 * Every attribute key used anywhere in the map, sorted.
 *
 * The vocabulary is derived from the file rather than configured: the whole
 * point of open keys is that the map decides what it is labelled with, so the
 * editor's suggestions and the toolbar's key list both come from here.
 */
export function attrKeys(roots: MindmapNode[]): string[] {
  const keys = new Set<string>();
  for (const node of walkNodes(roots)) {
    for (const key of Object.keys(node.attrs ?? {})) keys.add(key);
  }
  return [...keys].sort();
}

/**
 * Every value used for one key, sorted.
 *
 * `tags` is split into its members, so colouring or filtering by it works on
 * individual tags rather than on the whole comma-joined string.
 */
export function attrValues(roots: MindmapNode[], key: string): string[] {
  const values = new Set<string>();
  for (const node of walkNodes(roots)) {
    const raw = node.attrs?.[key];
    if (!raw) continue;
    if (key === TAGS_KEY) for (const tag of parseTags(raw)) values.add(tag);
    else values.add(raw);
  }
  return [...values].sort();
}

/**
 * Whether a node carries `value` for `key`.
 *
 * Membership for `tags`, equality for everything else — the same asymmetry
 * `attrValues` applies, so what the toolbar offers is what the filter matches.
 */
export function nodeHasAttr(node: MindmapNode, key: string, value: string): boolean {
  const raw = node.attrs?.[key];
  if (!raw) return false;
  return key === TAGS_KEY ? parseTags(raw).includes(value) : raw === value;
}

/**
 * Parses a mindmap note.
 *
 * `fallbackTitle` (usually the file name) stands in when the frontmatter has
 * no `title`.
 */
export function parseMindmap(content: string, fallbackTitle = ""): MindmapDocModel {
  // Everything below is line-oriented and several patterns end in `(.*)$`,
  // which `\r` breaks — so the file's line ending is dealt with once, here.
  const s = splitSections(toLf(content));
  const doc: MindmapDocModel = {
    title: frontmatterValue(s.frontmatter, "title") || fallbackTitle,
    nodeWidth: parseNodeWidth(frontmatterValue(s.frontmatter, "node_width")),
    roots: [],
    rawNodes: [],
    mintedIds: false,
    stickies: [],
    rawStickies: [],
    stickiesHidden: frontmatterValue(s.frontmatter, "stickies") === "hidden",
    attrView: {
      chips: parseAttrChips(frontmatterValue(s.frontmatter, "attr_chips")),
      color: frontmatterValue(s.frontmatter, "attr_color").trim(),
      filter: parseAttrFilter(frontmatterValue(s.frontmatter, "attr_filter")),
    },
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
  parseStickies(s.stickies, doc);
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
  // Sorted rather than written in insertion order: the file is diffed and
  // hand-merged, and an attribute that moves along the line on every save
  // makes a one-word change look like a rewritten node.
  for (const key of Object.keys(node.attrs ?? {}).sort()) {
    const value = node.attrs?.[key] ?? "";
    // A value emptied in the editor drops the attribute instead of writing
    // `key:`, which the parser would read back as part of the title.
    if (value) parts.push(`${key}:${value}`);
  }
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
  // The file keeps the line ending it already had: this note is shared with
  // Obsidian, with git and with the user's own editor, and rewriting every
  // line of a CRLF file as LF would turn a one-word edit into a whole-file
  // diff for all of them.
  const eol = detectEol(content);
  const s = splitSections(toLf(content));
  let frontmatter = setFrontmatterValue(s.frontmatter, "updated", today);
  // `auto` is the default, so it is written as the absence of the key — a note
  // only carries the setting once it has been changed away from the default.
  frontmatter =
    doc.nodeWidth === "auto"
      ? removeFrontmatterKey(frontmatter, "node_width")
      : setFrontmatterValue(frontmatter, "node_width", doc.nodeWidth);
  frontmatter = doc.stickiesHidden
    ? setFrontmatterValue(frontmatter, "stickies", "hidden")
    : removeFrontmatterKey(frontmatter, "stickies");
  // The three attribute view settings follow the same rule as `node_width`:
  // the default is written as the absence of the key, so a note only carries
  // one once it has been changed away from it.
  const view = doc.attrView;
  frontmatter =
    view.chips === "all"
      ? removeFrontmatterKey(frontmatter, "attr_chips")
      : setFrontmatterValue(frontmatter, "attr_chips", view.chips.join(",") || "none");
  frontmatter = view.color
    ? setFrontmatterValue(frontmatter, "attr_color", view.color)
    : removeFrontmatterKey(frontmatter, "attr_color");
  frontmatter = view.filter
    ? setFrontmatterValue(frontmatter, "attr_filter", `${view.filter.key}=${view.filter.value}`)
    : removeFrontmatterKey(frontmatter, "attr_filter");

  const body = [...doc.roots.flatMap((root) => formatNode(root)), ...doc.rawNodes].join("\n");
  const nodes = `## Nodes\n\n${body}${body ? "\n" : ""}\n`;

  // A note with no stickies carries no `## Stickies` section at all, so the
  // feature costs nothing to a map that does not use it.
  const stickyBody = [...doc.stickies.flatMap(formatSticky), ...doc.rawStickies].join("\n");
  const stickies = stickyBody ? `## Stickies\n\n${stickyBody}\n\n` : "";

  return withEol(
    `${frontmatter}${s.preamble}${nodes}${s.between}${stickies}${s.tail}`,
    eol,
  );
}

/** Renders one sticky: its grammar line plus any further lines of its text. */
export function formatSticky(sticky: Sticky): string[] {
  const parts = [sticky.id, `node:${sticky.nodeId}`, `@${Math.round(sticky.dx)},${Math.round(sticky.dy)}`];
  if (sticky.color) parts.push(`#${sticky.color}`);

  const lines = sticky.text.replace(/\s+$/, "").split("\n");
  const first = lines[0]?.trim() ?? "";
  if (first) parts.push(first);

  const out = [`- ${parts.join(" ")}`];
  for (const line of lines.slice(1)) out.push(`${INDENT}${line}`);
  return out;
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
