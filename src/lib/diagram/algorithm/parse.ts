/**
 * Program-flow note <-> document model (`type: algorithm`, T-0698).
 *
 * The note is Markdown a human also edits in Obsidian, so reading is forgiving
 * and writing is conservative - the same contract as the other diagram notes:
 *
 * - Anything the grammar does not recognize is **kept, not dropped**. A line
 *   under `## Nodes` or `## Edges` that is not readable (not a list item, the id
 *   of another kind, an arrow naming a node that is not there) survives as a raw
 *   line and is written back verbatim; the editor lists it as a warning.
 * - Only `## Nodes`, `## Edges` and `## Stickies` are rewritten. The rest of the
 *   frontmatter (including the reserved `direction:` key), `## Memo` and every
 *   unknown section are copied byte-for-byte, in place.
 *
 * The grammar:
 *
 *   ## Nodes
 *   - A-001 <title> [^start|^end|^decision|^io|^sub|^doc] [task:<id>] [#<color>] [@<x>,<y>]
 *     <optional continuation lines, indented - the node's note>
 *   ## Edges
 *   - A-001 -> A-002 ["label"]
 *
 * A node with no `^` is a process. A `^word` that is not a mark of this build
 * stays in the title. `@x,y` is the node's centre in absolute diagram pixels
 * (negative allowed); a node with none is placed by the layout and only gets
 * one when the user drags it. An arrow has no id: `(from, to)` is its identity,
 * and two lines naming the same pair are one arrow. There are no lanes.
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
import { formatEdgeEnd, parseEdgeEnd } from "../edge-ports";
import type { EdgePort } from "../node-edge";
import { DEFAULT_KIND, markOfKind, symbolOfMark, type NodeKind } from "./symbols";

export const NODE_PREFIX = "A";
const NODE_ID_RE = /^A-\d+$/;
/** Any `X-123` shaped id: another kind's element, which this note keeps but
 * does not read. */
const ANY_ID_RE = /^[A-Z]{1,3}-\d+$/;
const INDENT = "  ";

export interface AlgorithmNode {
  /** Stable, file-unique id (`A-001`). Never reassigned and never reused. */
  id: string;
  title: string;
  kind: NodeKind;
  task?: string;
  color?: Color;
  /** Centre, absolute pixels. Absent until the node is moved. */
  x?: number;
  y?: number;
  /** Continuation lines - shown on hover. */
  note?: string;
}

export interface AlgorithmEdge {
  from: string;
  to: string;
  label?: string;
  /** Where the arrow leaves `from`. Absent means automatic. */
  fromPort?: EdgePort;
  /** Where the arrow enters `to`. Absent means automatic. */
  toPort?: EdgePort;
}

export interface AlgorithmDocModel {
  /** `title` from the frontmatter; the file name stands in when absent. */
  title: string;
  nodes: AlgorithmNode[];
  edges: AlgorithmEdge[];
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
const EDGE_RE = /^\s*-\s+(\S+)\s*->\s*(\S+)\s*(?:"(.*)")?\s*$/;

function isColor(tok: string): boolean {
  return tok.startsWith("#") && (COLORS as readonly string[]).includes(tok.slice(1));
}

/** `- A-002 在庫を引き当てる ^sub task:T-0100 #blue @640,160` */
function parseNodeLine(line: string): { node: AlgorithmNode; hadId: boolean } | null {
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
    },
  };
}

function parseEdgeLine(line: string): AlgorithmEdge | null {
  const m = EDGE_RE.exec(line);
  if (!m) return null;
  const from = parseEdgeEnd(m[1]);
  const to = parseEdgeEnd(m[2]);
  if (!from || !to) return null;
  const label = (m[3] ?? "").trim();
  return {
    from: from.id,
    to: to.id,
    ...(label ? { label } : {}),
    ...(from.port ? { fromPort: from.port } : {}),
    ...(to.port ? { toPort: to.port } : {}),
  };
}

/** Parses a program-flow note. `fallbackTitle` (usually the file name) stands
 * in when the frontmatter has no `title`. */
export function parseAlgorithm(content: string, fallbackTitle = ""): AlgorithmDocModel {
  // Line-oriented patterns end in `(.*)$`, which `\r` breaks - so the file's
  // line ending is dealt with once, here.
  const note = splitNote(toLf(content));
  const doc: AlgorithmDocModel = {
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

  const notes = new Map<AlgorithmNode, string[]>();
  let open: AlgorithmNode | null = null;
  for (const line of bodyLines(sectionText(note, "Nodes"))) {
    const parsed = parseNodeLine(line);
    if (parsed) {
      doc.nodes.push(parsed.node);
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
function assignMissingIds(nodes: AlgorithmNode[]): boolean {
  const seen = new Set<string>();
  let max = 0;
  for (const node of nodes) {
    const n = /^A-(\d+)$/.exec(node.id);
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

/** Next free `A-NNN` for this document. Ids are never reused. */
export function nextNodeId(nodes: AlgorithmNode[]): string {
  return nextId(NODE_PREFIX, nodes.map((n) => n.id));
}

export function findNode(nodes: AlgorithmNode[], id: string): AlgorithmNode | null {
  return nodes.find((n) => n.id === id) ?? null;
}

/** How many lines the note keeps but the editor cannot show: unreadable lines
 * in any section, and stickies whose node is gone. */
export function warningCount(doc: AlgorithmDocModel): number {
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
export function formatNode(node: AlgorithmNode): string[] {
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
  const note = (node.note ?? "").replace(/\s+$/, "");
  if (note) {
    for (const line of note.split("\n")) out.push(`${INDENT}${line}`);
  }
  return out;
}

export function formatEdge(edge: AlgorithmEdge): string {
  // The label sits between quotes; a quote inside it could not be read back.
  const label = (edge.label ?? "").replace(/\s+/g, " ").replace(/"/g, "'").trim();
  return `- ${formatEdgeEnd(edge.from, edge.fromPort)} -> ${formatEdgeEnd(edge.to, edge.toPort)}${label ? ` "${label}"` : ""}`;
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
export function serializeAlgorithm(content: string, doc: AlgorithmDocModel, today: string): string {
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
