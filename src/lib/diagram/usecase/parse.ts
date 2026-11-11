/**
 * Use case note <-> document model (`type: usecase`, T-0706).
 *
 * The note is Markdown a human also edits in Obsidian, so reading is forgiving
 * and writing is conservative - the same contract as the other diagram notes
 * (the shared grammar is `../note-grammar.ts`):
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
import type { Color } from "../colors";
import { nextId } from "../note";
import {
  colorModifier,
  countWarnings,
  findById,
  formatArrowLine,
  formatColor,
  formatElementLine,
  formatNoteLines,
  formatPosition,
  formatSection,
  formatTask,
  positionModifier,
  readEdgeLine,
  readEdges,
  readElements,
  readEnvelope,
  readModifiers,
  readStickies,
  stickySection,
  taskModifier,
  uniqueEdges,
  writeNote,
} from "../note-grammar";
import { sectionText } from "../sections";
import type { Sticky } from "../sticky";
import { DEFAULT_KIND, markOfKind, symbolOfMark, type NodeKind } from "./symbols";

export const NODE_PREFIX = "U";

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

interface NodeFields {
  pos: { x: number; y: number };
  kind: NodeKind;
  task: string;
  color: Color;
}

/** `- U-002 窓口担当者 #blue @640,160` */
function buildNode(id: string, rest: string[]): UsecaseNode {
  const { fields, title } = readModifiers<NodeFields>(rest, {
    pos: positionModifier,
    kind: (tok) => symbolOfMark(tok)?.kind as NodeKind | undefined,
    task: taskModifier,
    color: colorModifier,
  });
  return {
    id,
    title,
    kind: fields.kind ?? DEFAULT_KIND,
    ...(fields.task ? { task: fields.task } : {}),
    ...(fields.color ? { color: fields.color } : {}),
    ...(fields.pos ?? {}),
  };
}

/** `- U-002 -- U-001 "label"` or `->`: bare ids at both ends, never a pinned side. */
function parseEdgeLine(line: string): UsecaseEdge | null {
  const read = readEdgeLine(line, { label: true, operators: ["--", "->"], ports: false });
  if (!read) return null;
  const { from, to, label } = read.shape;
  return { from, to, arrow: read.operator === "->", ...(label ? { label } : {}) };
}

/** Parses a use case note. `fallbackTitle` (usually the file name) stands in
 * when the frontmatter has no `title`. */
export function parseUsecase(content: string, fallbackTitle = ""): UsecaseDocModel {
  const { note, title, stickiesHidden } = readEnvelope(content, fallbackTitle);
  const nodes = readElements<UsecaseNode>(sectionText(note, "Nodes"), {
    ownId: (tok) => /^U-\d+$/.test(tok),
    build: buildNode,
    mintPrefix: NODE_PREFIX,
  });
  // A line is real only between two nodes that exist; any other is kept as the
  // line it was. A second line for a pair already joined (either direction) is
  // kept the same way, and warned about.
  const edges = readEdges<UsecaseEdge>(
    sectionText(note, "Edges"),
    new Set(nodes.items.map((n) => n.id)),
    { parse: parseEdgeLine, isTwin: samePair, onTwin: "keep-raw" },
  );
  const stickies = readStickies(note);
  return {
    title,
    nodes: nodes.items,
    edges: edges.edges,
    rawNodes: nodes.raw,
    rawEdges: edges.raw,
    mintedIds: nodes.minted || stickies.minted,
    stickies: stickies.stickies,
    rawStickies: stickies.rawStickies,
    stickiesHidden,
  };
}

/** Next free `U-NNN` for this document. Ids are never reused. */
export function nextNodeId(nodes: UsecaseNode[]): string {
  return nextId(NODE_PREFIX, nodes.map((n) => n.id));
}

export function findNode(nodes: UsecaseNode[], id: string): UsecaseNode | null {
  return findById(nodes, id);
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
  return countWarnings(
    [doc.rawNodes, doc.rawEdges],
    doc.stickies,
    new Set(doc.nodes.map((n) => n.id)),
  );
}

// ---------------------------------------------------------------------------
// serialization
// ---------------------------------------------------------------------------

/** Renders one node: its grammar line plus any note lines. */
export function formatNode(node: UsecaseNode): string[] {
  return [
    formatElementLine(node.id, node.title, [
      markOfKind(node.kind),
      formatTask(node.task),
      formatColor(node.color),
      formatPosition(node.x, node.y),
    ]),
    ...formatNoteLines(node.note),
  ];
}

export function formatEdge(edge: UsecaseEdge): string {
  return formatArrowLine(edge, true, edge.arrow ? "->" : "--");
}

/**
 * Renders the model back into `content`, replacing only the managed sections
 * and stamping `updated`. Unrecognized lines are appended after the recognized
 * ones so nothing is lost, and every other byte of the file is carried through.
 */
export function serializeUsecase(content: string, doc: UsecaseDocModel, today: string): string {
  // A relation is written once per unordered pair, whatever the model holds.
  const edges = uniqueEdges(doc.edges, samePair);
  return writeNote(content, today, {
    stickiesHidden: doc.stickiesHidden,
    sections: [
      { name: "Nodes", text: formatSection("Nodes", [...doc.nodes.flatMap(formatNode), ...doc.rawNodes]) },
      { name: "Edges", text: formatSection("Edges", [...edges.map(formatEdge), ...doc.rawEdges]) },
      stickySection(doc.stickies, doc.rawStickies),
    ],
  });
}
