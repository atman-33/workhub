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

// The palette and the sticky model are shared by every diagram kind
// (`lib/diagram/`); the names stay importable from here.
import { COLORS, type Color } from "../diagram/colors";
import {
  frontmatterValue,
  isContinuation,
  removeFrontmatterKey,
  setFrontmatterValue,
  splitSections,
} from "../diagram/note";
import { formatStickySection, parseStickies, type Sticky } from "../diagram/sticky";

export { COLORS, COLOR_HEX, STICKY_FILL_HEX, STICKY_INK } from "../diagram/colors";
export type { Color } from "../diagram/colors";
export { frontmatterValue } from "../diagram/note";
export {
  formatSticky,
  nextStickyId,
  stickiesOf,
  STICKY_DEFAULT_COLOR,
  STICKY_DEFAULT_OFFSET,
} from "../diagram/sticky";
export type { Sticky } from "../diagram/sticky";

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
  /**
   * `node_ids: show` from the frontmatter — draw each node's id above its
   * title. A display setting kept in the note for the same reason as
   * `node_width`; the default (ids hidden) is the absence of the key.
   */
  nodeIdsShown: boolean;
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
const ATTR_KEY_ASCII_RE = /^[a-z][a-z0-9_-]{0,23}$/;

/**
 * The Japanese a key may be written in, as one character class.
 *
 * Hiragana, katakana, kanji, the iteration marks and the long vowel mark — the
 * letters, and nothing that reads as punctuation. Full-width forms of ASCII
 * are left out on purpose: `Ｑ３` should stay in a title exactly as `Q3` does.
 */
const JA_LETTER =
  "\\u3005\\u3006\\u3041-\\u3096\\u309D-\\u309F\\u30A1-\\u30FA\\u30FC-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF";
const ATTR_KEY_JA_RE = new RegExp(`^[a-z0-9_\\-${JA_LETTER}]{1,24}$`);
const HAS_JA_RE = new RegExp(`[${JA_LETTER}]`);

/**
 * Whether a string may be used as an attribute key.
 *
 * Two shapes are allowed. The ASCII one is what the feature shipped with. The
 * Japanese one exists because a vault written in Japanese ends up labelling
 * its nodes `prio:高` — the value in the reader's language and the key not —
 * and the point of open keys is that the map decides what it is labelled with.
 *
 * A Japanese key has to *contain* a Japanese letter, and may otherwise carry
 * only the same lowercase ASCII the other shape allows. Every existing guard
 * therefore still stands: `15:00` starts with a digit, `Q3:目標` has an
 * uppercase letter, `https://x` is refused by its value, and `目標：達成`
 * carries no ASCII colon to split on at all — so a title typed with a Japanese
 * IME, which is where the full-width colon comes from, cannot be eaten.
 *
 * What this does admit is a title written with an ASCII colon, `課題:コスト`,
 * which now becomes an attribute. That is the same hole `todo:あとで` has
 * always had: it shows up immediately as a chip and round-trips through the
 * file, so the map says what happened rather than losing anything.
 *
 * Exported so the editor can refuse a key the parser would not read back — a
 * key typed as `Prio` would serialize fine and then vanish into the title on
 * the next load, which is the worst kind of bug this file can have.
 */
export function isAttrKey(key: string): boolean {
  if (ATTR_KEY_ASCII_RE.test(key)) return true;
  return ATTR_KEY_JA_RE.test(key) && HAS_JA_RE.test(key);
}

const ATTR_KEY_STRIP_RE = new RegExp(`[^a-z0-9_\\-${JA_LETTER}]`, "g");

/**
 * What a key field keeps of what was typed into it.
 *
 * Drops the characters no key of either shape may contain, so the field cannot
 * hold a key the parser would refuse. Lives here rather than in the editor so
 * that the two ideas of the alphabet cannot drift apart.
 *
 * It does **not** enforce the rest of the rule — the first character, the
 * length, whether a Japanese letter is present. Those decide whether a key is
 * finished, and a field being typed into is not finished; `isAttrKey` is what
 * the Add button asks.
 */
export function toAttrKeyInput(raw: string): string {
  return raw.toLowerCase().replace(ATTR_KEY_STRIP_RE, "");
}

/**
 * Reads one `key:value` token, or returns null when the token is not an
 * attribute and belongs to the title.
 *
 * Only the ASCII colon separates a key from its value. The full-width `：` a
 * Japanese IME produces is left alone, which is what keeps `目標：達成` a
 * title now that a key may be written in Japanese.
 *
 * A value starting with `//` is rejected so that a bare URL (`http://…`,
 * `https://…`) stays in the title rather than becoming an `http` attribute.
 */
function parseAttrToken(tok: string): [string, string] | null {
  const at = tok.indexOf(":");
  if (at <= 0 || at === tok.length - 1) return null;
  const key = tok.slice(0, at);
  const value = tok.slice(at + 1);
  if (!isAttrKey(key)) return null;
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
export function nodeHasAttr(
  node: Pick<MindmapNode, "attrs">,
  key: string,
  value: string,
): boolean {
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
  const s = splitSections(toLf(content), "Nodes");
  const doc: MindmapDocModel = {
    title: frontmatterValue(s.frontmatter, "title") || fallbackTitle,
    nodeWidth: parseNodeWidth(frontmatterValue(s.frontmatter, "node_width")),
    roots: [],
    rawNodes: [],
    mintedIds: false,
    stickies: [],
    rawStickies: [],
    stickiesHidden: frontmatterValue(s.frontmatter, "stickies") === "hidden",
    nodeIdsShown: frontmatterValue(s.frontmatter, "node_ids") === "show",
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

  const lines = s.managed.split("\n");
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
  const stickies = parseStickies(s.stickies);
  doc.stickies = stickies.stickies;
  doc.rawStickies = stickies.raw;
  if (stickies.minted) doc.mintedIds = true;
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
  const s = splitSections(toLf(content), "Nodes");
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
  frontmatter = doc.nodeIdsShown
    ? setFrontmatterValue(frontmatter, "node_ids", "show")
    : removeFrontmatterKey(frontmatter, "node_ids");
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
  const stickies = formatStickySection(doc.stickies, doc.rawStickies);

  return withEol(
    `${frontmatter}${s.preamble}${nodes}${s.between}${stickies}${s.tail}`,
    eol,
  );
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

/**
 * Where a sibling move happens: the list a node sits in, and which of its
 * neighbours count as "above" and "below".
 *
 * A root's children are the one list whose array order is not the order they
 * are drawn in — branches alternate across the root, so the neighbour above a
 * right-hand branch is the previous *right-hand* branch, not the previous
 * entry in the array. Reordering by raw index would move a branch past one on
 * the other side and change nothing on screen, which is the whole reason this
 * question is answered once, here, rather than at each call site.
 *
 * Reads the tree without changing it, so it is safe to call for a menu that is
 * only deciding whether to grey an item out.
 */
interface SiblingSlot {
  /** The array the node lives in — a parent's `children`, or `roots` itself. */
  list: MindmapNode[];
  /** The node's parent, or `null` when it is a top-level root. */
  parent: MindmapNode | null;
  node: MindmapNode;
  /** The node's index in `list`. */
  at: number;
  /** True when `list` is a root's children, i.e. split across two columns. */
  isBranchList: boolean;
  /**
   * Indices in `list` the node can move between, in drawing order. Every index
   * for an ordinary list; only the same-side ones for a root's children.
   */
  lane: number[];
}

function siblingSlot(roots: MindmapNode[], id: string): SiblingSlot | null {
  const parent = findParent(roots, id);
  const list = parent ? parent.children : roots;
  const at = list.findIndex((n) => n.id === id);
  if (at === -1) return null;

  const isBranchList = Boolean(parent && roots.includes(parent));
  let lane: number[];
  if (isBranchList) {
    const side = rootChildSide(list[at], at);
    lane = list.reduce<number[]>((acc, n, i) => {
      if (rootChildSide(n, i) === side) acc.push(i);
      return acc;
    }, []);
  } else {
    lane = list.map((_, i) => i);
  }
  return { list, parent, node: list[at], at, isBranchList, lane };
}

/**
 * Moves a node one place up (`-1`) or down (`+1`) among the siblings it is
 * drawn with, returning a new tree — or `null` when it is already at that end.
 *
 * `null` rather than the tree unchanged, so a caller can tell "nothing to do"
 * from "done" without comparing trees, and a menu can grey the item out with
 * the same question (`canMoveSibling`).
 */
export function moveSibling(
  roots: MindmapNode[],
  id: string,
  delta: -1 | 1,
): MindmapNode[] | null {
  const next = cloneNodes(roots);
  const slot = siblingSlot(next, id);
  if (!slot) return null;
  const to = slot.lane.indexOf(slot.at) + delta;
  if (to < 0 || to >= slot.lane.length) return null;
  const target = slot.lane[to];

  // Freeze before the list changes shape: without this, removing one branch
  // re-indexes the rest and flips every unpinned branch to the other side.
  if (slot.isBranchList && slot.parent) freezeRootChildSides(slot.parent);
  slot.list.splice(slot.at, 1);
  slot.list.splice(target, 0, slot.node);
  return next;
}

/** Whether `moveSibling` would do anything. */
export function canMoveSibling(roots: MindmapNode[], id: string, delta: -1 | 1): boolean {
  const slot = siblingSlot(roots, id);
  if (!slot) return false;
  const to = slot.lane.indexOf(slot.at) + delta;
  return to >= 0 && to < slot.lane.length;
}

/**
 * Makes a node the last child of the sibling drawn above it.
 *
 * The neighbour is taken in drawing order, so indenting a right-hand branch
 * files it under the branch visibly above it rather than under whatever
 * happens to precede it in the array.
 */
export function indentNode(roots: MindmapNode[], id: string): MindmapNode[] | null {
  const next = cloneNodes(roots);
  const slot = siblingSlot(next, id);
  if (!slot) return null;
  const pos = slot.lane.indexOf(slot.at);
  if (pos <= 0) return null;
  const target = slot.list[slot.lane[pos - 1]];

  if (slot.isBranchList && slot.parent) freezeRootChildSides(slot.parent);
  // A top-level root becoming a branch of the root above it: the branches
  // already there keep their column, and the arrival alternates into a side.
  if (next.includes(target)) freezeRootChildSides(target);

  slot.list.splice(slot.at, 1);
  // Only a branch of a root asserts a side; anything deeper follows its parent.
  delete slot.node.side;
  target.children.push(slot.node);
  // Filing something into a collapsed node would otherwise hide the move.
  delete target.collapsed;
  return next;
}

/** Whether `indentNode` would do anything. */
export function canIndent(roots: MindmapNode[], id: string): boolean {
  const slot = siblingSlot(roots, id);
  return Boolean(slot && slot.lane.indexOf(slot.at) > 0);
}

/**
 * Makes a node the next sibling of its own parent.
 *
 * Refused for a branch of a root: promoting one would turn it into a second
 * root, and a map's roots are its top-level subjects rather than a level the
 * outdent key should be able to wander into by accident.
 */
export function outdentNode(roots: MindmapNode[], id: string): MindmapNode[] | null {
  const next = cloneNodes(roots);
  const parent = findParent(next, id);
  if (!parent || next.includes(parent)) return null;
  const grand = findParent(next, parent.id);
  if (!grand) return null;
  const node = findNode(next, id);
  if (!node) return null;

  const grandIsRoot = next.includes(grand);
  // Freeze first so `parent.side` is the column it is actually drawn in.
  if (grandIsRoot) freezeRootChildSides(grand);

  const at = parent.children.findIndex((n) => n.id === id);
  const parentAt = grand.children.findIndex((n) => n.id === parent.id);
  parent.children.splice(at, 1);
  // Promoted to a branch, it stays in the column it came out of; promoted
  // anywhere else it has no side of its own.
  if (grandIsRoot) node.side = parent.side;
  else delete node.side;
  grand.children.splice(parentAt + 1, 0, node);
  return next;
}

/** Whether `outdentNode` would do anything. */
export function canOutdent(roots: MindmapNode[], id: string): boolean {
  const parent = findParent(roots, id);
  if (!parent || roots.includes(parent)) return false;
  return Boolean(findParent(roots, parent.id));
}
