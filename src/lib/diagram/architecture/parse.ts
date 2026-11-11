/**
 * Architecture note <-> document model (`type: architecture`, T-0709).
 *
 * The note is Markdown a human also edits in Obsidian, so reading is forgiving
 * and writing is conservative - the same contract as the other diagram notes
 * (the shared grammar is `../note-grammar.ts`):
 *
 * - Anything the grammar does not recognize is **kept, not dropped**. A line
 *   under a managed section that is not readable survives as a raw line and is
 *   written back verbatim; the editor lists it as a warning.
 * - Only `## Frames`, `## Nodes`, `## Edges` and `## Stickies` are rewritten.
 *   The rest of the frontmatter, `## Memo` and every unknown section are copied
 *   byte-for-byte.
 *
 * The grammar:
 *
 *   ## Frames
 *   - G-001 <title> [#<color>] [@<x>,<y>]
 *     <optional continuation lines, indented: the frame's hover memo>
 *   ## Nodes
 *   - C-001 <title> [frame:G-001] [^round|^db|^user|^cloud|^block] [icon:<name>]
 *     [task:<id>] [#<color>] [@<x>,<y>]
 *     <optional continuation lines, indented: the block's hover memo>
 *   ## Edges
 *   - C-001 -> C-002 ["label"]      one way, head at the second end
 *   - C-001 <-> C-003 ["label"]     both ways, a head at each end
 *   - C-004:E@0.5 -> C-006:W ["label"]   pinned ends: out the east side
 *     halfway down, in the west side (an end without one is automatic)
 *
 * A block with no `^` is a plain block. `frame:G-001` puts the block in that
 * frame; a block with none, or one naming a frame that is not there, sits
 * outside every frame. A frame's own `frame:G-NNN` and a block's `icon:<name>`
 * are reserved for later (nesting, icons): they are kept and written back but
 * change nothing drawn. A frame's `@x,y` is the centre of its own box, but
 * only an empty frame is drawn there: a frame with members is drawn around
 * them and its `@x,y` is kept but ignored.
 *
 * **An edge's identity**: `->` is the ordered pair `(from, to)`, so `A -> B`
 * and `B -> A` are two lines; `<->` is the unordered pair, so a second line
 * for the same pair (in any direction or style) is kept as a raw line and
 * warned about. The first line wins.
 */
import type { Color } from "../colors";
import { edgeKey, type EdgePort } from "../node-edge";
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
  prefixModifier,
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

export const NODE_PREFIX = "C";
export const FRAME_PREFIX = "G";

export interface ArchitectureFrame {
  /** Stable, file-unique id (`G-001`). Never reassigned and never reused. */
  id: string;
  title: string;
  color?: Color;
  /** Continuation lines: a memo shown on hover. */
  note?: string;
  /**
   * The parent frame (`frame:G-NNN` on the frame's line). Reserved for nested
   * frames: kept and written back, ignored when drawn.
   */
  parent?: string;
  /**
   * Centre of the frame's own box, absolute pixels. Only an empty frame is
   * drawn there (see `layoutArchitecture`); a frame with members keeps its
   * `@x,y` in the file but is drawn around its members. Absent until an
   * empty frame is dragged.
   */
  x?: number;
  y?: number;
}

export interface ArchitectureNode {
  /** Stable, file-unique id (`C-001`). Never reassigned and never reused. */
  id: string;
  title: string;
  kind: NodeKind;
  /** The frame this block sits in. Absent (or naming no frame) means outside. */
  frame?: string;
  /**
   * A reserved icon name (`icon:<name>`). Kept and written back, not drawn.
   */
  icon?: string;
  task?: string;
  color?: Color;
  /** Centre, absolute pixels. Absent until the block is moved. */
  x?: number;
  y?: number;
  /** Continuation lines: a memo shown on hover. */
  note?: string;
}

export interface ArchitectureEdge {
  from: string;
  to: string;
  /** `<->`: a head at each end. False for `->`. */
  bidi: boolean;
  label?: string;
  /** Where the arrow leaves `from`. Absent means automatic. */
  fromPort?: EdgePort;
  /** Where the arrow enters `to`. Absent means automatic. */
  toPort?: EdgePort;
}

export interface ArchitectureDocModel {
  /** `title` from the frontmatter; the file name stands in when absent. */
  title: string;
  frames: ArchitectureFrame[];
  nodes: ArchitectureNode[];
  edges: ArchitectureEdge[];
  /** Lines the grammar did not recognize, kept verbatim, per section. */
  rawFrames: string[];
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

/**
 * True when `edge` (of either style) already joins the pair a new line names:
 * `->` claims its ordered pair, `<->` claims the unordered one. `A -> B` and
 * `B -> A` are two lines; anything else for the same pair is one line too many.
 */
export function sameEdge(
  edge: ArchitectureEdge,
  ref: { from: string; to: string; bidi: boolean },
): boolean {
  if (ref.bidi) {
    return (
      (edge.from === ref.from && edge.to === ref.to) ||
      (edge.from === ref.to && edge.to === ref.from)
    );
  }
  return edge.from === ref.from && edge.to === ref.to;
}

/** The edge a new line would collide with, if there is one. */
export function findEdge(
  edges: readonly ArchitectureEdge[],
  ref: { from: string; to: string; bidi: boolean },
): ArchitectureEdge | undefined {
  return edges.find((e) => sameEdge(e, ref));
}

/**
 * The key the canvas and the view select an edge by: the ordered pair for
 * `->`, the sorted pair for `<->` (which reads the same either way round).
 */
export function edgeKeyOf(edge: { from: string; to: string; bidi: boolean }): string {
  return edge.bidi ? [...[edge.from, edge.to]].sort().join("<>") + "<>" : edgeKey(edge);
}

// ---------------------------------------------------------------------------
// parsing
// ---------------------------------------------------------------------------

interface FrameFields {
  pos: { x: number; y: number };
  color: Color;
  parent: string;
}

/** `- G-001 Client side #blue`, with an optional reserved `frame:G-NNN` parent
 * and an optional `@x,y` of its own (drawn only while the frame is empty). */
function buildFrame(id: string, rest: string[]): ArchitectureFrame {
  const { fields, title } = readModifiers<FrameFields>(rest, {
    pos: positionModifier,
    color: colorModifier,
    parent: prefixModifier("frame:"),
  });
  return {
    id,
    title,
    ...(fields.color ? { color: fields.color } : {}),
    ...(fields.parent ? { parent: fields.parent } : {}),
    ...(fields.pos ?? {}),
  };
}

interface NodeFields {
  pos: { x: number; y: number };
  kind: NodeKind;
  frame: string;
  icon: string;
  task: string;
  color: Color;
}

/** `- C-002 Screen frame:G-001 ^round task:T-0100 #blue @640,260` */
function buildNode(id: string, rest: string[]): ArchitectureNode {
  const { fields, title } = readModifiers<NodeFields>(rest, {
    pos: positionModifier,
    kind: (tok) => symbolOfMark(tok)?.kind as NodeKind | undefined,
    frame: prefixModifier("frame:"),
    icon: prefixModifier("icon:"),
    task: taskModifier,
    color: colorModifier,
  });
  return {
    id,
    title,
    kind: fields.kind ?? DEFAULT_KIND,
    ...(fields.frame ? { frame: fields.frame } : {}),
    ...(fields.icon ? { icon: fields.icon } : {}),
    ...(fields.task ? { task: fields.task } : {}),
    ...(fields.color ? { color: fields.color } : {}),
    ...(fields.pos ?? {}),
  };
}

/** `--` is not an edge here: the connector is read, then refused. */
function parseEdgeLine(line: string): ArchitectureEdge | null {
  const read = readEdgeLine(line, { label: true, operators: ["--", "->", "<->"] });
  if (!read || read.operator === "--") return null;
  return { ...read.shape, bidi: read.operator === "<->" };
}

/** Parses an architecture note. `fallbackTitle` (usually the file name) stands
 * in when the frontmatter has no `title`. */
export function parseArchitecture(content: string, fallbackTitle = ""): ArchitectureDocModel {
  const { note, title, stickiesHidden } = readEnvelope(content, fallbackTitle);
  const frames = readElements<ArchitectureFrame>(sectionText(note, "Frames"), {
    ownId: (tok) => /^G-\d+$/.test(tok),
    build: buildFrame,
    mintPrefix: FRAME_PREFIX,
  });
  const nodes = readElements<ArchitectureNode>(sectionText(note, "Nodes"), {
    ownId: (tok) => /^C-\d+$/.test(tok),
    build: buildNode,
    mintPrefix: NODE_PREFIX,
  });
  // A line is real only between two blocks that exist; any other is kept as the
  // line it was. A second line for an already-joined pair is kept the same way,
  // and warned about.
  const edges = readEdges<ArchitectureEdge>(
    sectionText(note, "Edges"),
    new Set(nodes.items.map((n) => n.id)),
    { parse: parseEdgeLine, isTwin: sameEdge, onTwin: "keep-raw" },
  );
  const stickies = readStickies(note);
  return {
    title,
    frames: frames.items,
    nodes: nodes.items,
    edges: edges.edges,
    rawFrames: frames.raw,
    rawNodes: nodes.raw,
    rawEdges: edges.raw,
    mintedIds: frames.minted || nodes.minted || stickies.minted,
    stickies: stickies.stickies,
    rawStickies: stickies.rawStickies,
    stickiesHidden,
  };
}

/** Next free `C-NNN` for this document. Ids are never reused. */
export function nextNodeId(nodes: ArchitectureNode[]): string {
  return nextId(NODE_PREFIX, nodes.map((n) => n.id));
}

/** Next free `G-NNN` for this document. Ids are never reused. */
export function nextFrameId(frames: ArchitectureFrame[]): string {
  return nextId(FRAME_PREFIX, frames.map((f) => f.id));
}

export function findNode(nodes: ArchitectureNode[], id: string): ArchitectureNode | null {
  return findById(nodes, id);
}

export function findFrame(frames: ArchitectureFrame[], id: string): ArchitectureFrame | null {
  return findById(frames, id);
}

/** How many lines the note keeps but the editor cannot show: unreadable lines
 * in any section (a duplicate pair included), and stickies whose block or
 * frame is gone. */
export function warningCount(doc: ArchitectureDocModel): number {
  return countWarnings(
    [doc.rawFrames, doc.rawNodes, doc.rawEdges],
    doc.stickies,
    new Set([...doc.nodes.map((n) => n.id), ...doc.frames.map((f) => f.id)]),
  );
}

// ---------------------------------------------------------------------------
// serialization
// ---------------------------------------------------------------------------

/** Renders one frame: its grammar line plus any memo lines. */
export function formatFrame(frame: ArchitectureFrame): string[] {
  return [
    formatElementLine(frame.id, frame.title, [
      frame.parent ? `frame:${frame.parent}` : undefined,
      formatColor(frame.color),
      formatPosition(frame.x, frame.y),
    ]),
    ...formatNoteLines(frame.note),
  ];
}

/** Renders one node: its grammar line plus any memo lines. */
export function formatNode(node: ArchitectureNode): string[] {
  return [
    formatElementLine(node.id, node.title, [
      node.frame ? `frame:${node.frame}` : undefined,
      markOfKind(node.kind),
      node.icon ? `icon:${node.icon}` : undefined,
      formatTask(node.task),
      formatColor(node.color),
      formatPosition(node.x, node.y),
    ]),
    ...formatNoteLines(node.note),
  ];
}

export function formatEdge(edge: ArchitectureEdge): string {
  return formatArrowLine(edge, true, edge.bidi ? "<->" : "->");
}

/**
 * Renders the model back into `content`, replacing only the managed sections
 * and stamping `updated`. Unrecognized lines are appended after the recognized
 * ones so nothing is lost, and every other byte of the file is carried through.
 */
export function serializeArchitecture(
  content: string,
  doc: ArchitectureDocModel,
  today: string,
): string {
  // An edge is written once per claimed pair, whatever the model holds.
  const edges = uniqueEdges(doc.edges, sameEdge);
  return writeNote(content, today, {
    stickiesHidden: doc.stickiesHidden,
    sections: [
      {
        name: "Frames",
        text: formatSection("Frames", [...doc.frames.flatMap(formatFrame), ...doc.rawFrames]),
      },
      { name: "Nodes", text: formatSection("Nodes", [...doc.nodes.flatMap(formatNode), ...doc.rawNodes]) },
      { name: "Edges", text: formatSection("Edges", [...edges.map(formatEdge), ...doc.rawEdges]) },
      stickySection(doc.stickies, doc.rawStickies),
    ],
  });
}
