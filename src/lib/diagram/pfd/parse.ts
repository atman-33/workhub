/**
 * PFD note <-> document model (T-0683).
 *
 * The note is Markdown a human also edits in Obsidian, so reading is forgiving
 * and writing is conservative - the same contract as the other diagram notes
 * (the shared grammar is `../note-grammar.ts`):
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
 *   - P-001:E@0.5 -> D-001:W   pinned ends: out the east side halfway down,
 *     in the west side (an end without one is automatic)
 *
 * Which kind a node is comes from the prefix of its id (`symbols.ts`), so the
 * line looks the same for every symbol. `@x,y` is the node's centre in absolute
 * diagram pixels (negative allowed); a node with none is placed by the layout
 * and only gets one when the user drags it. An arrow has no id: `(from, to)` is
 * its identity, and two lines naming the same pair are one arrow (pins do not
 * change that). An arrow has no label: a line carrying one is kept raw.
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
import { DEFAULT_PREFIX, isNodeId, mayConnect, prefixOf } from "./symbols";

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
  /** Where the arrow leaves `from`. Absent means automatic. */
  fromPort?: EdgePort;
  /** Where the arrow enters `to`. Absent means automatic. */
  toPort?: EdgePort;
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

interface NodeFields {
  pos: { x: number; y: number };
  task: string;
  color: Color;
}

/** `- P-002 設計する task:T-0100 #blue @640,160` */
function buildNode(id: string, rest: string[]): PfdNode {
  const { fields, title } = readModifiers<NodeFields>(rest, {
    pos: positionModifier,
    task: taskModifier,
    color: colorModifier,
  });
  return {
    id,
    title,
    ...(fields.task ? { task: fields.task } : {}),
    ...(fields.color ? { color: fields.color } : {}),
    ...(fields.pos ?? {}),
  };
}

/** Parses a PFD note. `fallbackTitle` (usually the file name) stands in when
 * the frontmatter has no `title`. */
export function parsePfd(content: string, fallbackTitle = ""): PfdDocModel {
  const { note, title, stickiesHidden } = readEnvelope(content, fallbackTitle);
  // An id-less node is a process (the default symbol); a duplicate keeps the
  // symbol of the id that was there. Numbers are per prefix.
  const nodes = readElements<PfdNode>(sectionText(note, "Nodes"), {
    ownId: isNodeId,
    build: buildNode,
    mintPrefix: (node) => prefixOf(node.id) || DEFAULT_PREFIX,
  });
  // An arrow is real only between two nodes that exist (of any kinds) and that
  // `mayConnect`; any other is kept as the line it was. Two lines for one pair
  // are one arrow.
  const edges = readEdges<PfdEdge>(
    sectionText(note, "Edges"),
    new Set(nodes.items.map((n) => n.id)),
    {
      parse: (line) => readArrowLine(line, { label: false }),
      isTwin: sameOrderedPair,
      onTwin: "merge-label",
      accepts: (edge) => mayConnect(edge.from, edge.to),
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

/** Next free id of a symbol for this document. Ids are never reused. */
export function nextNodeId(nodes: PfdNode[], prefix: string): string {
  return nextId(prefix, nodes.map((n) => n.id));
}

export function findNode(nodes: PfdNode[], id: string): PfdNode | null {
  return findById(nodes, id);
}

/** How many lines the note keeps but the editor cannot show: unreadable lines
 * in any section, and stickies whose node is gone. */
export function warningCount(doc: PfdDocModel): number {
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
export function formatNode(node: PfdNode): string[] {
  return [
    formatElementLine(node.id, node.title, [
      formatTask(node.task),
      formatColor(node.color),
      formatPosition(node.x, node.y),
    ]),
    ...formatNoteLines(node.note),
  ];
}

export function formatEdge(edge: PfdEdge): string {
  return formatArrowLine(edge, false);
}

/**
 * Renders the model back into `content`, replacing only the managed sections
 * and stamping `updated`. Unrecognized lines are appended after the recognized
 * ones so nothing is lost, and every other byte of the file is carried through.
 */
export function serializePfd(content: string, doc: PfdDocModel, today: string): string {
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
