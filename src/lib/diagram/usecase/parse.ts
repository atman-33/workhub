/**
 * Use case note <-> document model (`type: usecase`, T-0706).
 *
 * The note is Markdown a human also edits in Obsidian, so reading is forgiving
 * and writing is conservative - the same contract as the other diagram notes:
 *
 * - Anything the grammar does not recognize is **kept, not dropped**. A line
 *   under `## Nodes` or `## Edges` that is not readable (not a list item, the id
 *   of another kind, a line naming a node that is not there, or a second line
 *   for a pair already joined) survives as a raw line and is written back
 *   verbatim; the editor lists it as a warning.
 * - Only `## Nodes`, `## Edges` and `## Stickies` are rewritten. The rest of the
 *   frontmatter, `## Memo` and every unknown section are copied byte-for-byte.
 *
 * The grammar:
 *
 *   ## Nodes
 *   - U-001 <title> [^system|^ext|^person] [task:<id>] [#<color>] [@<x>,<y>]
 *     <optional continuation lines, indented>
 *   ## Edges
 *   - U-002 -- U-001 ["label"]     a line, no arrow
 *   - U-001 -> U-005 ["label"]     an arrow, head at the second end
 *
 * A node with no `^` is a person. For a person the continuation lines are what
 * the person does, one line one item, drawn as an always-visible speech
 * bubble (the app adds the bullet; the file does not carry it). For a system or
 * an external service they are a memo shown on hover. `@x,y` is the node's
 * centre in absolute diagram pixels (negative allowed); a node with none is
 * placed by the ring layout.
 *
 * **An edge's identity is the unordered pair** `{from, to}`: `A -- B` and
 * `B -- A` are one relation, and so are `A -- B` and `A -> B`. The first line
 * wins; a later line for the same pair is kept as a raw line and warned about.
 * (The other kinds identify an arrow by its ordered pair.)
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

export const NODE_PREFIX = "U";
const NODE_ID_RE = /^U-\d+$/;
/** Any `X-123` shaped id: another kind's element, which this note keeps but does not read. */
const ANY_ID_RE = /^[A-Z]{1,3}-\d+$/;
const INDENT = "  ";

export interface UsecaseNode {
  /** Stable, file-unique id (`U-001`). Never reassigned and never reused. */
  id: string;
  title: string;
  kind: NodeKind;
  task?: string;
  color?: Color;
  /** Centre, absolute pixels. Absent until the node is moved. */
  x?: number;
  y?: number;
  /** Continuation lines: a person's actions (one per line) or a hover memo. */
  note?: string;
}

export interface UsecaseEdge {
  from: string;
  to: string;
  /** `->`: an arrowhead at `to`. False for `--`. */
  arrow: boolean;
  label?: string;
}

export interface UsecaseDocModel {
  /** `title` from the frontmatter; the file name stands in when absent. */
  title: string;
  nodes: UsecaseNode[];
  edges: UsecaseEdge[];
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
// edge identity
// ---------------------------------------------------------------------------

/** True when two edges (or an edge and a `{from, to}`) join the same two nodes, in either order. */
export function samePair(
  a: { from: string; to: string },
  b: { from: string; to: string },
): boolean {
  return (a.from === b.from && a.to === b.to) || (a.from === b.to && a.to === b.from);
}

/** The edge joining the two nodes of `ref` in either direction, if there is one. */
export function findEdge(
  edges: readonly UsecaseEdge[],
  ref: { from: string; to: string },
): UsecaseEdge | undefined {
  return edges.find((e) => samePair(e, ref));
}

// ---------------------------------------------------------------------------
// parsing
// ---------------------------------------------------------------------------

const NUMBER = String.raw`-?\d+(?:\.\d+)?`;
const POSITION_RE = new RegExp(`^@(${NUMBER}),(${NUMBER})$`);
const EDGE_RE =
  /^\s*-\s+([A-Za-z]{1,3}-\d+)\s*(--|->)\s*([A-Za-z]{1,3}-\d+)\s*(?:"(.*)")?\s*$/;

function isColor(tok: string): boolean {
  return tok.startsWith("#") && (COLORS as readonly string[]).includes(tok.slice(1));
}

/** `- U-002 窓口担当者 #blue @640,160` */
function parseNodeLine(line: string): { node: UsecaseNode; hadId: boolean } | null {
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

function parseEdgeLine(line: string): UsecaseEdge | null {
  const m = EDGE_RE.exec(line);
  if (!m) return null;
  const label = (m[4] ?? "").trim();
  return { from: m[1], to: m[3], arrow: m[2] === "->", ...(label ? { label } : {}) };
}

/** Parses a use case note. `fallbackTitle` (usually the file name) stands in
 * when the frontmatter has no `title`. */
export function parseUsecase(content: string, fallbackTitle = ""): UsecaseDocModel {
  // Line-oriented patterns end in `(.*)$`, which `\r` breaks - so the file's
  // line ending is dealt with once, here.
  const note = splitNote(toLf(content));
  const doc: UsecaseDocModel = {
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

  const notes = new Map<UsecaseNode, string[]>();
  let open: UsecaseNode | null = null;
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

  // A line is real only between two nodes that exist; any other is kept as the
  // line it was. A second line for a pair already joined (either direction) is
  // kept the same way, and warned about.
  const ids = new Set(doc.nodes.map((n) => n.id));
  for (const line of bodyLines(sectionText(note, "Edges"))) {
    const edge = parseEdgeLine(line);
    if (!edge || !ids.has(edge.from) || !ids.has(edge.to) || findEdge(doc.edges, edge)) {
      doc.rawEdges.push(line.trimEnd());
      continue;
    }
    doc.edges.push(edge);
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
function assignMissingIds(nodes: UsecaseNode[]): boolean {
  const seen = new Set<string>();
  let max = 0;
  for (const node of nodes) {
    const n = /^U-(\d+)$/.exec(node.id);
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

/** Next free `U-NNN` for this document. Ids are never reused. */
export function nextNodeId(nodes: UsecaseNode[]): string {
  return nextId(NODE_PREFIX, nodes.map((n) => n.id));
}

export function findNode(nodes: UsecaseNode[], id: string): UsecaseNode | null {
  return nodes.find((n) => n.id === id) ?? null;
}

/** A person's actions: the note's lines, one item each (blank lines dropped). */
export function actionsOf(node: Pick<UsecaseNode, "note">): string[] {
  return (node.note ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** How many lines the note keeps but the editor cannot show: unreadable lines
 * in any section (a duplicate pair included), and stickies whose node is gone. */
export function warningCount(doc: UsecaseDocModel): number {
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
export function formatNode(node: UsecaseNode): string[] {
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

export function formatEdge(edge: UsecaseEdge): string {
  // The label sits between quotes; a quote inside it could not be read back.
  const label = (edge.label ?? "").replace(/\s+/g, " ").replace(/"/g, "'").trim();
  return `- ${edge.from} ${edge.arrow ? "->" : "--"} ${edge.to}${label ? ` "${label}"` : ""}`;
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
export function serializeUsecase(content: string, doc: UsecaseDocModel, today: string): string {
  const eol = detectEol(content);
  const note = splitNote(toLf(content));
  let frontmatter = setFrontmatterValue(note.frontmatter, "updated", today);
  frontmatter = setOrRemoveFrontmatterValue(frontmatter, "stickies", doc.stickiesHidden ? "hidden" : "");

  // A relation is written once per unordered pair, whatever the model holds.
  const edges: UsecaseEdge[] = [];
  for (const e of doc.edges) if (!findEdge(edges, e)) edges.push(e);

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
