/**
 * IFDAM note <-> document model (`type: ifdam`, T-0703).
 *
 * The note is Markdown a human also edits in Obsidian, so reading is forgiving
 * and writing is conservative - the same contract as the other diagram notes:
 *
 * - Anything the grammar does not recognize is **kept, not dropped**. A line
 *   under `## Nodes` or `## Edges` that is not readable (not a list item, the id
 *   of another kind, an arrow naming a node that is not there) survives as a raw
 *   line and is written back verbatim; the editor lists it as a warning.
 * - Only `## Nodes`, `## Edges` and `## Stickies` are rewritten. The rest of the
 *   frontmatter, `## Memo` and every unknown section are copied byte-for-byte,
 *   in place.
 *
 * The grammar:
 *
 *   ## Nodes
 *   - V-001 <title> [^screen|^trigger|^store|^message] [task:<id>] [#<color>] [@<x>,<y>]
 *     <indented continuation lines>
 *   ## Edges
 *   - V-001 -> V-002 ["label"]
 *
 * A node with no `^` is a process. A `^word` that is not a mark of this build
 * stays in the title. `@x,y` is the node's centre in absolute diagram pixels.
 *
 * **The continuation lines of a screen** are its contents: a line that starts
 * `show:`, `input:` or `action:` and has text after it is one item of that
 * section (what the screen shows, what the user enters, what the user can
 * press). The model keeps every continuation line, in the order written, as
 * `lines`; nothing is regrouped, so a person or an AI may put a line anywhere and
 * it stays there. Every other continuation line is the node's memo (shown on
 * hover). On a node that is not a screen the same keys are plain memo text, and a
 * node whose kind is changed away from `^screen` keeps its keyed lines, so no
 * line is ever lost to a kind change.
 */
import { detectEol, toLf, withEol } from "../../note-eol";
import { COLORS, type Color } from "../colors";
import {
  formatId,
  frontmatterValue,
  isContinuation,
  nextId,
  setFrontmatterValue,
  setOrRemoveFrontmatterValue,
} from "../note";
import { replaceSections, sectionText, splitNote } from "../sections";
import { formatStickySection, parseStickies, type Sticky } from "../sticky";
import { DEFAULT_KIND, markOfKind, symbolOfMark, type NodeKind } from "./symbols";

export const NODE_PREFIX = "V";
const NODE_ID_RE = /^V-\d+$/;
/** Any `X-123` shaped id: another kind's element, which this note keeps but
 * does not read. */
const ANY_ID_RE = /^[A-Z]{1,3}-\d+$/;
const INDENT = "  ";

/** The three sections of a screen, in the order they are drawn. */
export const SECTION_KEYS = ["show", "input", "action"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export function isSectionKey(value: string): value is SectionKey {
  return (SECTION_KEYS as readonly string[]).includes(value);
}

/** One continuation line: an item of a screen's section, or (`key: null`) memo text. */
export interface NodeLine {
  key: SectionKey | null;
  text: string;
}

export interface IfdamNode {
  /** Stable, file-unique id (`V-001`). Never reassigned and never reused. */
  id: string;
  title: string;
  kind: NodeKind;
  task?: string;
  color?: Color;
  /** Centre, absolute pixels. Absent until the node is moved. */
  x?: number;
  y?: number;
  /** Every continuation line, in the order written. */
  lines: NodeLine[];
}

export interface IfdamEdge {
  from: string;
  to: string;
  label?: string;
}

export interface IfdamDocModel {
  /** `title` from the frontmatter; the file name stands in when absent. */
  title: string;
  nodes: IfdamNode[];
  edges: IfdamEdge[];
  /** Lines the grammar did not recognize, kept verbatim, per section. */
  rawNodes: string[];
  rawEdges: string[];
  /** True when parsing had to mint at least one id. */
  mintedIds: boolean;
  /** Sticky notes from `## Stickies`, in file order. */
  stickies: Sticky[];
  /** Lines under `## Stickies` the grammar did not recognize, kept verbatim. */
  rawStickies: string[];
  /** `stickies: hidden` from the frontmatter. */
  stickiesHidden: boolean;
}

// ---------------------------------------------------------------------------
// lines of a node
// ---------------------------------------------------------------------------

const ITEM_RE = /^(show|input|action):[ \t]*(.*)$/;

/** Reads one continuation line. Only a screen has items; an empty item is memo text. */
export function parseContinuation(text: string, kind: NodeKind): NodeLine {
  if (kind === "screen") {
    const m = ITEM_RE.exec(text);
    if (m && m[2].trim() !== "") return { key: m[1] as SectionKey, text: m[2].trim() };
  }
  return { key: null, text };
}

/** The items of one section of a screen, in the order written. */
export function sectionItems(node: IfdamNode, key: SectionKey): string[] {
  if (node.kind !== "screen") return [];
  return node.lines.filter((l) => l.key === key).map((l) => l.text);
}

/**
 * What the hover shows for a node: its memo lines. On a screen these are the
 * lines that are not items; on any other node a line written `show: ...` is
 * memo text like the rest, so it is shown as written.
 */
export function memoOf(node: IfdamNode): string {
  const parts: string[] = [];
  for (const line of node.lines) {
    if (line.key === null) parts.push(line.text);
    else if (node.kind !== "screen") parts.push(`${line.key}: ${line.text}`);
  }
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// parsing
// ---------------------------------------------------------------------------

const NUMBER = String.raw`-?\d+(?:\.\d+)?`;
const POSITION_RE = new RegExp(`^@(${NUMBER}),(${NUMBER})$`);
const EDGE_RE = /^\s*-\s+([A-Za-z]{1,3}-\d+)\s*->\s*([A-Za-z]{1,3}-\d+)\s*(?:"(.*)")?\s*$/;

function isColor(tok: string): boolean {
  return tok.startsWith("#") && (COLORS as readonly string[]).includes(tok.slice(1));
}

/** `- V-002 Todo を登録する ^screen task:T-0100 #blue @640,160` */
function parseNodeLine(line: string): { node: IfdamNode; hadId: boolean } | null {
  const m = /^\s*-\s+(.*)$/.exec(line);
  if (!m) return null;
  const tokens = m[1].trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  let id = "";
  let rest = tokens;
  if (NODE_ID_RE.test(tokens[0])) {
    id = tokens[0];
    rest = tokens.slice(1);
  } else if (ANY_ID_RE.test(tokens[0])) {
    // Another kind's element: not ours to read.
    return null;
  }
  let kind: NodeKind | undefined;
  let task: string | undefined;
  let color: Color | undefined;
  let x: number | undefined;
  let y: number | undefined;
  const title: string[] = [];
  // Modifiers may appear in any order; anything left over is the title, so an
  // unknown `^word`, an unrecognized `#word` or a malformed `@` stays part of it.
  for (const tok of rest) {
    const pos = POSITION_RE.exec(tok);
    const symbol = symbolOfMark(tok);
    if (pos && x === undefined) {
      x = Math.round(Number(pos[1]));
      y = Math.round(Number(pos[2]));
    } else if (symbol && !kind) {
      kind = symbol.kind as NodeKind;
    } else if (tok.startsWith("task:") && tok.length > 5 && !task) {
      task = tok.slice(5);
    } else if (isColor(tok) && !color) {
      color = tok.slice(1) as Color;
    } else {
      title.push(tok);
    }
  }
  return {
    hadId: id !== "",
    node: {
      id,
      title: title.join(" "),
      kind: kind ?? DEFAULT_KIND,
      ...(task ? { task } : {}),
      ...(color ? { color } : {}),
      ...(x !== undefined && y !== undefined ? { x, y } : {}),
      lines: [],
    },
  };
}

function parseEdgeLine(line: string): IfdamEdge | null {
  const m = EDGE_RE.exec(line);
  if (!m) return null;
  const label = (m[3] ?? "").trim();
  return { from: m[1], to: m[2], ...(label ? { label } : {}) };
}

/** Parses an IFDAM note. `fallbackTitle` (usually the file name) stands in
 * when the frontmatter has no `title`. */
export function parseIfdam(content: string, fallbackTitle = ""): IfdamDocModel {
  // Line-oriented patterns end in `(.*)$`, which `\r` breaks - so the file's
  // line ending is dealt with once, here.
  const note = splitNote(toLf(content));
  const doc: IfdamDocModel = {
    title: frontmatterValue(note.frontmatter, "title") || fallbackTitle,
    nodes: [],
    edges: [],
    rawNodes: [],
    rawEdges: [],
    mintedIds: false,
    stickies: [],
    rawStickies: [],
    stickiesHidden: frontmatterValue(note.frontmatter, "stickies") === "hidden",
  };

  let open: IfdamNode | null = null;
  for (const line of bodyLines(sectionText(note, "Nodes"))) {
    const parsed = parseNodeLine(line);
    if (parsed) {
      doc.nodes.push(parsed.node);
      if (!parsed.hadId) doc.mintedIds = true;
      open = parsed.node;
      continue;
    }
    if (open && isContinuation(line)) {
      open.lines.push(parseContinuation(line.trim(), open.kind));
      continue;
    }
    open = null;
    doc.rawNodes.push(line.trimEnd());
  }

  if (assignMissingIds(doc.nodes)) doc.mintedIds = true;

  // An arrow is real only between two nodes that exist; any other is kept as
  // the line it was. Two lines for one pair are one arrow.
  const ids = new Set(doc.nodes.map((n) => n.id));
  for (const line of bodyLines(sectionText(note, "Edges"))) {
    const edge = parseEdgeLine(line);
    if (!edge || !ids.has(edge.from) || !ids.has(edge.to)) {
      doc.rawEdges.push(line.trimEnd());
      continue;
    }
    const twin = doc.edges.find((e) => e.from === edge.from && e.to === edge.to);
    if (!twin) doc.edges.push(edge);
    else if (!twin.label && edge.label) twin.label = edge.label;
  }

  const stickies = parseStickies(sectionText(note, "Stickies"));
  doc.stickies = stickies.stickies;
  doc.rawStickies = stickies.raw;
  if (stickies.minted) doc.mintedIds = true;
  return doc;
}

/** The non-blank lines of a section, without its heading line. */
function bodyLines(section: string): string[] {
  return section
    .split("\n")
    .filter((line, i) => !(i === 0 && /^##\s+/.test(line)) && line.trim() !== "");
}

/** Gives every id-less node an id, and repairs duplicates. Returns whether
 * anything was minted. */
function assignMissingIds(nodes: IfdamNode[]): boolean {
  const seen = new Set<string>();
  let max = 0;
  for (const node of nodes) {
    const n = /^V-(\d+)$/.exec(node.id);
    if (n) max = Math.max(max, Number(n[1]));
  }
  let minted = false;
  for (const node of nodes) {
    if (!node.id || seen.has(node.id)) {
      max += 1;
      node.id = formatId(NODE_PREFIX, max);
      minted = true;
    }
    seen.add(node.id);
  }
  return minted;
}

/** Next free `V-NNN` for this document. Ids are never reused. */
export function nextNodeId(nodes: IfdamNode[]): string {
  return nextId(NODE_PREFIX, nodes.map((n) => n.id));
}

export function findNode(nodes: IfdamNode[], id: string): IfdamNode | null {
  return nodes.find((n) => n.id === id) ?? null;
}

/** How many lines the note keeps but the editor cannot show: unreadable lines
 * in any section, and stickies whose node is gone. */
export function warningCount(doc: IfdamDocModel): number {
  const ids = new Set(doc.nodes.map((n) => n.id));
  return (
    doc.rawNodes.length +
    doc.rawEdges.length +
    doc.stickies.filter((s) => !ids.has(s.targetId)).length
  );
}

// ---------------------------------------------------------------------------
// serialization
// ---------------------------------------------------------------------------

/** One line of text: a newline would end it early, so it is flattened. */
function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").trim();
}

/** Renders one node: its grammar line plus its continuation lines, in order. */
export function formatNode(node: IfdamNode): string[] {
  const parts = [node.id];
  // Only ever the first line: a stray newline in the title would otherwise
  // emit a second, unparsable line.
  const title = node.title.split("\n")[0].trim();
  if (title) parts.push(title);
  const mark = markOfKind(node.kind);
  if (mark) parts.push(mark);
  if (node.task) parts.push(`task:${node.task}`);
  if (node.color) parts.push(`#${node.color}`);
  if (node.x !== undefined && node.y !== undefined) {
    parts.push(`@${Math.round(node.x)},${Math.round(node.y)}`);
  }
  const out = [`- ${parts.join(" ")}`];
  for (const line of node.lines) {
    const text = oneLine(line.text);
    if (!text) continue;
    out.push(`${INDENT}${line.key ? `${line.key}: ` : ""}${text}`);
  }
  return out;
}

export function formatEdge(edge: IfdamEdge): string {
  // The label sits between quotes; a quote inside it could not be read back.
  const label = (edge.label ?? "").replace(/\s+/g, " ").replace(/"/g, "'").trim();
  return `- ${edge.from} -> ${edge.to}${label ? ` "${label}"` : ""}`;
}

function sectionBody(name: string, lines: string[]): string {
  const body = lines.join("\n");
  return body ? `## ${name}\n\n${body}\n\n` : `## ${name}\n\n`;
}

/**
 * Renders the model back into `content`, replacing only the managed sections
 * and stamping `updated`. Unrecognized lines are appended after the recognized
 * ones so nothing is lost, and every other byte of the file is carried through.
 */
export function serializeIfdam(content: string, doc: IfdamDocModel, today: string): string {
  // The file keeps the line ending it already had: this note is shared with
  // Obsidian, with git and with the user's own editor.
  const eol = detectEol(content);
  const note = splitNote(toLf(content));
  let frontmatter = setFrontmatterValue(note.frontmatter, "updated", today);
  frontmatter = setOrRemoveFrontmatterValue(frontmatter, "stickies", doc.stickiesHidden ? "hidden" : "");

  // An arrow is written once per pair, whatever the model holds.
  const seen = new Set<string>();
  const edges = doc.edges.filter((e) => {
    const key = `${e.from}\u0000${e.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const body = replaceSections({ ...note, frontmatter }, [
    {
      name: "Nodes",
      text: sectionBody("Nodes", [...doc.nodes.flatMap(formatNode), ...doc.rawNodes]),
    },
    { name: "Edges", text: sectionBody("Edges", [...edges.map(formatEdge), ...doc.rawEdges]) },
    { name: "Stickies", text: formatStickySection(doc.stickies, doc.rawStickies) },
  ]);
  return withEol(body, eol);
}
