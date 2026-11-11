/**
 * Program-flow note <-> document model (`type: algorithm`, T-0698).
 *
 * The note is Markdown a human also edits in Obsidian, so reading is forgiving
 * and writing is conservative - the same contract as the other diagram notes
 * (the shared grammar is `../note-grammar.ts`):
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
import type { Color } from "../colors";
import type { EdgePort } from "../node-edge";
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
  readArrowLine,
  readEdges,
  readElements,
  readEnvelope,
  readModifiers,
  readStickies,
  sameOrderedPair,
  stickySection,
  taskModifier,
  uniqueEdges,
  writeNote,
} from "../note-grammar";
import { sectionText } from "../sections";
import type { Sticky } from "../sticky";
import { DEFAULT_KIND, markOfKind, symbolOfMark, type NodeKind } from "./symbols";

export const NODE_PREFIX = "A";

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

interface NodeFields {
  pos: { x: number; y: number };
  kind: NodeKind;
  task: string;
  color: Color;
}

/** `- A-002 在庫を引き当てる ^sub task:T-0100 #blue @640,160` */
function buildNode(id: string, rest: string[]): AlgorithmNode {
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

/** Parses a program-flow note. `fallbackTitle` (usually the file name) stands
 * in when the frontmatter has no `title`. */
export function parseAlgorithm(content: string, fallbackTitle = ""): AlgorithmDocModel {
  const { note, title, stickiesHidden } = readEnvelope(content, fallbackTitle);
  const nodes = readElements<AlgorithmNode>(sectionText(note, "Nodes"), {
    ownId: (tok) => /^A-\d+$/.test(tok),
    build: buildNode,
    mintPrefix: NODE_PREFIX,
  });
  // An arrow is real only between two nodes that exist; any other is kept as
  // the line it was. Two lines for one pair are one arrow.
  const edges = readEdges<AlgorithmEdge>(
    sectionText(note, "Edges"),
    new Set(nodes.items.map((n) => n.id)),
    {
      parse: (line) => readArrowLine(line, { label: true }),
      isTwin: sameOrderedPair,
      onTwin: "merge-label",
    },
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

/** Next free `A-NNN` for this document. Ids are never reused. */
export function nextNodeId(nodes: AlgorithmNode[]): string {
  return nextId(NODE_PREFIX, nodes.map((n) => n.id));
}

export function findNode(nodes: AlgorithmNode[], id: string): AlgorithmNode | null {
  return findById(nodes, id);
}

/** How many lines the note keeps but the editor cannot show: unreadable lines
 * in any section, and stickies whose node is gone. */
export function warningCount(doc: AlgorithmDocModel): number {
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
export function formatNode(node: AlgorithmNode): string[] {
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

export function formatEdge(edge: AlgorithmEdge): string {
  return formatArrowLine(edge, true);
}

/**
 * Renders the model back into `content`, replacing only the managed sections
 * and stamping `updated`. Unrecognized lines are appended after the recognized
 * ones so nothing is lost, and every other byte of the file is carried through.
 */
export function serializeAlgorithm(content: string, doc: AlgorithmDocModel, today: string): string {
  // An arrow is written once per pair, whatever the model holds.
  const edges = uniqueEdges(doc.edges, sameOrderedPair);
  return writeNote(content, today, {
    stickiesHidden: doc.stickiesHidden,
    sections: [
      { name: "Nodes", text: formatSection("Nodes", [...doc.nodes.flatMap(formatNode), ...doc.rawNodes]) },
      { name: "Edges", text: formatSection("Edges", [...edges.map(formatEdge), ...doc.rawEdges]) },
      stickySection(doc.stickies, doc.rawStickies),
    ],
  });
}
