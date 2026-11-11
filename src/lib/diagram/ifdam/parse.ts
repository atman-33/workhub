/**
 * IFDAM note <-> document model (`type: ifdam`, T-0703).
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
import type { Color } from "../colors";
import type { EdgePort } from "../node-edge";
import { nextId } from "../note";
import {
  INDENT,
  colorModifier,
  countWarnings,
  findById,
  formatArrowLine,
  formatColor,
  formatElementLine,
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

export const NODE_PREFIX = "V";

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
  /** Where the arrow leaves `from`. Absent means automatic. */
  fromPort?: EdgePort;
  /** Where the arrow enters `to`. Absent means automatic. */
  toPort?: EdgePort;
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

interface NodeFields {
  pos: { x: number; y: number };
  kind: NodeKind;
  task: string;
  color: Color;
}

/** `- V-002 Todo を登録する ^screen task:T-0100 #blue @640,160` */
function buildNode(id: string, rest: string[]): IfdamNode {
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
    lines: [],
  };
}

/** Parses an IFDAM note. `fallbackTitle` (usually the file name) stands in
 * when the frontmatter has no `title`. */
export function parseIfdam(content: string, fallbackTitle = ""): IfdamDocModel {
  const { note, title, stickiesHidden } = readEnvelope(content, fallbackTitle);
  // A continuation line is filed in order, as the node's kind reads it.
  const nodes = readElements<IfdamNode>(sectionText(note, "Nodes"), {
    ownId: (tok) => /^V-\d+$/.test(tok),
    build: buildNode,
    continuation: (node, text) => node.lines.push(parseContinuation(text, node.kind)),
    mintPrefix: NODE_PREFIX,
  });
  // An arrow is real only between two nodes that exist; any other is kept as
  // the line it was. Two lines for one pair are one arrow.
  const edges = readEdges<IfdamEdge>(
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

/** Next free `V-NNN` for this document. Ids are never reused. */
export function nextNodeId(nodes: IfdamNode[]): string {
  return nextId(NODE_PREFIX, nodes.map((n) => n.id));
}

export function findNode(nodes: IfdamNode[], id: string): IfdamNode | null {
  return findById(nodes, id);
}

/** How many lines the note keeps but the editor cannot show: unreadable lines
 * in any section, and stickies whose node is gone. */
export function warningCount(doc: IfdamDocModel): number {
  return countWarnings(
    [doc.rawNodes, doc.rawEdges],
    doc.stickies,
    new Set(doc.nodes.map((n) => n.id)),
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
  const out = [
    formatElementLine(node.id, node.title, [
      markOfKind(node.kind),
      formatTask(node.task),
      formatColor(node.color),
      formatPosition(node.x, node.y),
    ]),
  ];
  for (const line of node.lines) {
    const text = oneLine(line.text);
    if (!text) continue;
    out.push(`${INDENT}${line.key ? `${line.key}: ` : ""}${text}`);
  }
  return out;
}

export function formatEdge(edge: IfdamEdge): string {
  return formatArrowLine(edge, true);
}

/**
 * Renders the model back into `content`, replacing only the managed sections
 * and stamping `updated`. Unrecognized lines are appended after the recognized
 * ones so nothing is lost, and every other byte of the file is carried through.
 */
export function serializeIfdam(content: string, doc: IfdamDocModel, today: string): string {
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
