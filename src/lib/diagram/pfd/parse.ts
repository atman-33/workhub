/**
 * PFD note <-> document model (T-0683).
 *
 * The note is Markdown a human also edits in Obsidian, so reading is forgiving
 * and writing is conservative - the same contract as the other diagram notes:
 *
 * - Anything the grammar does not recognize is **kept, not dropped**. A line
 *   under `## Nodes` or `## Edges` that cannot be read as an element of this
 *   build (not a list item, an id whose prefix is not in the symbol registry,
 *   an arrow naming a node that is not there) survives as a raw line and is written back verbatim; the editor
 *   lists it as a warning.
 * - Only `## Nodes`, `## Edges` and `## Stickies` are rewritten. The rest of
 *   the frontmatter, `## Memo` and every unknown section are copied
 *   byte-for-byte, in place.
 *
 * The grammar:
 *
 *   ## Nodes
 *   - P-001 <title> [task:<id>] [#<color>] [@<x>,<y>]
 *   - D-001 <title> ...
 *     <optional continuation lines, indented - the node's note>
 *   ## Edges
 *   - P-001 -> D-001
 *
 * Which kind a node is comes from the prefix of its id (`symbols.ts`), so the
 * line looks the same for every symbol. `@x,y` is the node's centre in absolute
 * diagram pixels (negative allowed); a node with none is placed by the layout
 * and only gets one when the user drags it. An arrow has no id: `(from, to)` is
 * its identity, and two lines naming the same pair are one arrow.
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
import { DEFAULT_PREFIX, isNodeId, mayConnect, prefixOf } from "./symbols";

const INDENT = "  ";
/** Any `X-123` shaped id: kept as a raw line when its prefix is not a symbol. */
const ANY_ID_RE = /^[A-Z]{1,3}-\d+$/;

export interface PfdNode {
  /** Stable, file-unique id (`P-001`). Never reassigned and never reused. */
  id: string;
  title: string;
  task?: string;
  color?: Color;
  /** Centre, absolute pixels. Absent until the node is moved. */
  x?: number;
  y?: number;
  /** Continuation lines - shown on hover. */
  note?: string;
}

export interface PfdEdge {
  from: string;
  to: string;
}

export interface PfdDocModel {
  /** `title` from the frontmatter; the file name stands in when absent. */
  title: string;
  nodes: PfdNode[];
  edges: PfdEdge[];
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
// parsing
// ---------------------------------------------------------------------------

const NUMBER = String.raw`-?\d+(?:\.\d+)?`;
const POSITION_RE = new RegExp(`^@(${NUMBER}),(${NUMBER})$`);
const EDGE_RE = /^\s*-\s+([A-Za-z]{1,3}-\d+)\s*->\s*([A-Za-z]{1,3}-\d+)\s*$/;

function isColor(tok: string): boolean {
  return tok.startsWith("#") && (COLORS as readonly string[]).includes(tok.slice(1));
}

/** `- P-002 設計する task:T-0100 #blue @640,160` */
function parseNodeLine(line: string): { node: PfdNode; hadId: boolean } | null {
  const m = /^\s*-\s+(.*)$/.exec(line);
  if (!m) return null;
  const tokens = m[1].trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  let id = "";
  let rest = tokens;
  if (isNodeId(tokens[0])) {
    id = tokens[0];
    rest = tokens.slice(1);
  } else if (ANY_ID_RE.test(tokens[0])) {
    // The id of something this build has no symbol for: not ours to read.
    return null;
  }
  let task: string | undefined;
  let color: Color | undefined;
  let x: number | undefined;
  let y: number | undefined;
  const title: string[] = [];
  // Modifiers may appear in any order; anything left over is the title, so an
  // unrecognized `#word` or a malformed `@` stays part of it.
  for (const tok of rest) {
    const pos = POSITION_RE.exec(tok);
    if (pos && x === undefined) {
      x = Math.round(Number(pos[1]));
      y = Math.round(Number(pos[2]));
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
      ...(task ? { task } : {}),
      ...(color ? { color } : {}),
      ...(x !== undefined && y !== undefined ? { x, y } : {}),
    },
  };
}

function parseEdgeLine(line: string): PfdEdge | null {
  const m = EDGE_RE.exec(line);
  return m ? { from: m[1], to: m[2] } : null;
}

/** Parses a PFD note. `fallbackTitle` (usually the file name) stands in when
 * the frontmatter has no `title`. */
export function parsePfd(content: string, fallbackTitle = ""): PfdDocModel {
  // Line-oriented patterns end in `(.*)$`, which `\r` breaks - so the file's
  // line ending is dealt with once, here.
  const note = splitNote(toLf(content));
  const doc: PfdDocModel = {
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

  const notes = new Map<PfdNode, string[]>();
  let open: PfdNode | null = null;
  for (const line of bodyLines(sectionText(note, "Nodes"))) {
    const parsed = parseNodeLine(line);
    if (parsed) {
      doc.nodes.push(parsed.node);
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

  if (assignMissingIds(doc.nodes)) doc.mintedIds = true;

  // An arrow is real only between two nodes that exist (of any kinds); any
  // other is kept as the line it was. Two lines for one
  // pair are one arrow.
  const ids = new Set(doc.nodes.map((n) => n.id));
  for (const line of bodyLines(sectionText(note, "Edges"))) {
    const edge = parseEdgeLine(line);
    if (!edge || !ids.has(edge.from) || !ids.has(edge.to) || !mayConnect(edge.from, edge.to)) {
      doc.rawEdges.push(line.trimEnd());
      continue;
    }
    if (!doc.edges.some((e) => e.from === edge.from && e.to === edge.to)) doc.edges.push(edge);
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

/**
 * Gives every id-less node an id (a process, the default symbol) and repairs
 * duplicates, keeping the symbol of the id that was there. Numbers are per
 * prefix: the highest in the file plus one. Returns whether anything was minted.
 */
function assignMissingIds(nodes: PfdNode[]): boolean {
  const max = new Map<string, number>();
  for (const node of nodes) {
    const m = /^([A-Z]{1,3})-(\d+)$/.exec(node.id);
    if (m) max.set(m[1], Math.max(max.get(m[1]) ?? 0, Number(m[2])));
  }
  const seen = new Set<string>();
  let minted = false;
  for (const node of nodes) {
    if (!node.id || seen.has(node.id)) {
      const prefix = prefixOf(node.id) || DEFAULT_PREFIX;
      const n = (max.get(prefix) ?? 0) + 1;
      max.set(prefix, n);
      node.id = formatId(prefix, n);
      minted = true;
    }
    seen.add(node.id);
  }
  return minted;
}

/** Next free id of a symbol for this document. Ids are never reused. */
export function nextNodeId(nodes: PfdNode[], prefix: string): string {
  return nextId(prefix, nodes.map((n) => n.id));
}

export function findNode(nodes: PfdNode[], id: string): PfdNode | null {
  return nodes.find((n) => n.id === id) ?? null;
}

/** How many lines the note keeps but the editor cannot show: unreadable lines
 * in any section, and stickies whose node is gone. */
export function warningCount(doc: PfdDocModel): number {
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

/** Renders one node: its grammar line plus any note lines. */
export function formatNode(node: PfdNode): string[] {
  const parts = [node.id];
  // Only ever the first line: a stray newline in the title would otherwise
  // emit a second, unparsable line.
  const title = node.title.split("\n")[0].trim();
  if (title) parts.push(title);
  if (node.task) parts.push(`task:${node.task}`);
  if (node.color) parts.push(`#${node.color}`);
  if (node.x !== undefined && node.y !== undefined) {
    parts.push(`@${Math.round(node.x)},${Math.round(node.y)}`);
  }
  const out = [`- ${parts.join(" ")}`];
  const note = (node.note ?? "").replace(/\s+$/, "");
  if (note) {
    for (const line of note.split("\n")) out.push(`${INDENT}${line}`);
  }
  return out;
}

export function formatEdge(edge: PfdEdge): string {
  return `- ${edge.from} -> ${edge.to}`;
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
export function serializePfd(content: string, doc: PfdDocModel, today: string): string {
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
