/**
 * Architecture note <-> document model (`type: architecture`, T-0709).
 *
 * The note is Markdown a human also edits in Obsidian, so reading is forgiving
 * and writing is conservative - the same contract as the other diagram notes:
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
 *   - G-001 <title> [#<color>]
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
 * change nothing drawn.
 *
 * **An edge's identity**: `->` is the ordered pair `(from, to)`, so `A -> B`
 * and `B -> A` are two lines; `<->` is the unordered pair, so a second line
 * for the same pair (in any direction or style) is kept as a raw line and
 * warned about. The first line wins.
 */
import { detectEol, toLf, withEol } from "../../note-eol";
import { COLORS, type Color } from "../colors";
import { formatEdgeEnd, parseEdgeEnd } from "../edge-ports";
import { edgeKey, type EdgePort } from "../node-edge";
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

export const NODE_PREFIX = "C";
export const FRAME_PREFIX = "G";
const NODE_ID_RE = /^C-\d+$/;
const FRAME_ID_RE = /^G-\d+$/;
/** Any `X-123` shaped id: another kind's element, which this note keeps but does not read. */
const ANY_ID_RE = /^[A-Z]{1,3}-\d+$/;
const INDENT = "  ";

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

const NUMBER = String.raw`-?\d+(?:\.\d+)?`;
const POSITION_RE = new RegExp(`^@(${NUMBER}),(${NUMBER})$`);
const FRAME_REF_RE = /^frame:(.+)$/;
const ICON_RE = /^icon:(.+)$/;
const EDGE_RE = /^\s*-\s+(\S+)\s*(--|->|<->)\s*(\S+)\s*(?:"(.*)")?\s*$/;

function isColor(tok: string): boolean {
  return tok.startsWith("#") && (COLORS as readonly string[]).includes(tok.slice(1));
}

/** `- G-001 Client side #blue`, with an optional reserved `frame:G-NNN` parent. */
function parseFrameLine(line: string): { frame: ArchitectureFrame; hadId: boolean } | null {
  const m = /^\s*-\s+(.*)$/.exec(line);
  if (!m) return null;
  const tokens = m[1].trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  let id = "";
  let rest = tokens;
  if (FRAME_ID_RE.test(tokens[0])) {
    id = tokens[0];
    rest = tokens.slice(1);
  } else if (ANY_ID_RE.test(tokens[0])) {
    // Another kind's element: not ours to read.
    return null;
  }
  let color: Color | undefined;
  let parent: string | undefined;
  const title: string[] = [];
  // Modifiers may appear in any order; anything left over is the title.
  for (const tok of rest) {
    const frameRef = FRAME_REF_RE.exec(tok);
    if (isColor(tok) && !color) {
      color = tok.slice(1) as Color;
    } else if (frameRef && frameRef[1] && !parent) {
      parent = frameRef[1];
    } else {
      title.push(tok);
    }
  }
  return {
    hadId: id !== "",
    frame: {
      id,
      title: title.join(" "),
      ...(color ? { color } : {}),
      ...(parent ? { parent } : {}),
    },
  };
}

/** `- C-002 Screen frame:G-001 ^round task:T-0100 #blue @640,260` */
function parseNodeLine(line: string): { node: ArchitectureNode; hadId: boolean } | null {
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
  let frame: string | undefined;
  let icon: string | undefined;
  let task: string | undefined;
  let color: Color | undefined;
  let x: number | undefined;
  let y: number | undefined;
  const title: string[] = [];
  // Modifiers may appear in any order; anything left over is the title, so an
  // unknown `^word`, an unrecognized `#word`, a malformed `@` or a stray
  // `frame:` stays part of it.
  for (const tok of rest) {
    const pos = POSITION_RE.exec(tok);
    const frameRef = FRAME_REF_RE.exec(tok);
    const iconRef = ICON_RE.exec(tok);
    const symbol = symbolOfMark(tok);
    if (pos && x === undefined) {
      x = Math.round(Number(pos[1]));
      y = Math.round(Number(pos[2]));
    } else if (symbol && !kind) {
      kind = symbol.kind as NodeKind;
    } else if (frameRef && frameRef[1] && !frame) {
      frame = frameRef[1];
    } else if (iconRef && iconRef[1] && !icon) {
      icon = iconRef[1];
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
      ...(frame ? { frame } : {}),
      ...(icon ? { icon } : {}),
      ...(task ? { task } : {}),
      ...(color ? { color } : {}),
      ...(x !== undefined && y !== undefined ? { x, y } : {}),
    },
  };
}

function parseEdgeLine(line: string): ArchitectureEdge | null {
  const m = EDGE_RE.exec(line);
  if (!m || m[2] === "--") return null;
  const from = parseEdgeEnd(m[1]);
  const to = parseEdgeEnd(m[3]);
  if (!from || !to) return null;
  const label = (m[4] ?? "").trim();
  return {
    from: from.id,
    to: to.id,
    bidi: m[2] === "<->",
    ...(label ? { label } : {}),
    ...(from.port ? { fromPort: from.port } : {}),
    ...(to.port ? { toPort: to.port } : {}),
  };
}

/** Gives every id-less frame or node an id, and repairs duplicates. Returns
 * whether anything was minted. */
function assignMissingIds(
  frames: ArchitectureFrame[],
  nodes: ArchitectureNode[],
): boolean {
  let minted = false;
  const mint = (prefix: string, items: { id: string }[]) => {
    const seen = new Set<string>();
    const re = new RegExp(`^${prefix}-(\\d+)$`);
    let max = 0;
    for (const item of items) {
      const n = re.exec(item.id);
      if (n) max = Math.max(max, Number(n[1]));
    }
    for (const item of items) {
      if (!item.id || seen.has(item.id)) {
        max += 1;
        item.id = formatId(prefix, max);
        minted = true;
      }
      seen.add(item.id);
    }
  };
  mint(FRAME_PREFIX, frames);
  mint(NODE_PREFIX, nodes);
  return minted;
}

/** Parses an architecture note. `fallbackTitle` (usually the file name) stands
 * in when the frontmatter has no `title`. */
export function parseArchitecture(content: string, fallbackTitle = ""): ArchitectureDocModel {
  // Line-oriented patterns end in `(.*)$`, which `\r` breaks - so the file's
  // line ending is dealt with once, here.
  const note = splitNote(toLf(content));
  const doc: ArchitectureDocModel = {
    title: frontmatterValue(note.frontmatter, "title") || fallbackTitle,
    frames: [],
    nodes: [],
    edges: [],
    rawFrames: [],
    rawNodes: [],
    rawEdges: [],
    mintedIds: false,
    stickies: [],
    rawStickies: [],
    stickiesHidden: frontmatterValue(note.frontmatter, "stickies") === "hidden",
  };

  const memos = new Map<ArchitectureFrame | ArchitectureNode, string[]>();
  let openFrame: ArchitectureFrame | null = null;
  let openNode: ArchitectureNode | null = null;
  const openNote = (item: ArchitectureFrame | ArchitectureNode) => memos.get(item);
  for (const line of bodyLines(sectionText(note, "Frames"))) {
    const parsed = parseFrameLine(line);
    if (parsed) {
      doc.frames.push(parsed.frame);
      if (!parsed.hadId) doc.mintedIds = true;
      openFrame = parsed.frame;
      openNode = null;
      continue;
    }
    if (openFrame && isContinuation(line)) {
      const collected = openNote(openFrame);
      if (collected) collected.push(line.trim());
      else memos.set(openFrame, [line.trim()]);
      continue;
    }
    openFrame = null;
    openNode = null;
    doc.rawFrames.push(line.trimEnd());
  }
  for (const line of bodyLines(sectionText(note, "Nodes"))) {
    const parsed = parseNodeLine(line);
    if (parsed) {
      doc.nodes.push(parsed.node);
      if (!parsed.hadId) doc.mintedIds = true;
      openNode = parsed.node;
      openFrame = null;
      continue;
    }
    if (openNode && isContinuation(line)) {
      const collected = openNote(openNode);
      if (collected) collected.push(line.trim());
      else memos.set(openNode, [line.trim()]);
      continue;
    }
    openFrame = null;
    openNode = null;
    doc.rawNodes.push(line.trimEnd());
  }
  for (const [item, collected] of memos) item.note = collected.join("\n");

  if (assignMissingIds(doc.frames, doc.nodes)) doc.mintedIds = true;

  // A line is real only between two blocks that exist; any other is kept as the
  // line it was. A second line for an already-joined pair is kept the same way,
  // and warned about.
  const ids = new Set(doc.nodes.map((n) => n.id));
  for (const line of bodyLines(sectionText(note, "Edges"))) {
    const edge = parseEdgeLine(line);
    if (
      !edge ||
      !ids.has(edge.from) ||
      !ids.has(edge.to) ||
      findEdge(doc.edges, edge)
    ) {
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

/** Next free `C-NNN` for this document. Ids are never reused. */
export function nextNodeId(nodes: ArchitectureNode[]): string {
  return nextId(NODE_PREFIX, nodes.map((n) => n.id));
}

/** Next free `G-NNN` for this document. Ids are never reused. */
export function nextFrameId(frames: ArchitectureFrame[]): string {
  return nextId(FRAME_PREFIX, frames.map((f) => f.id));
}

export function findNode(nodes: ArchitectureNode[], id: string): ArchitectureNode | null {
  return nodes.find((n) => n.id === id) ?? null;
}

export function findFrame(frames: ArchitectureFrame[], id: string): ArchitectureFrame | null {
  return frames.find((f) => f.id === id) ?? null;
}

/** How many lines the note keeps but the editor cannot show: unreadable lines
 * in any section (a duplicate pair included), and stickies whose block or
 * frame is gone. */
export function warningCount(doc: ArchitectureDocModel): number {
  const ids = new Set([...doc.nodes.map((n) => n.id), ...doc.frames.map((f) => f.id)]);
  return (
    doc.rawFrames.length +
    doc.rawNodes.length +
    doc.rawEdges.length +
    doc.stickies.filter((s) => !ids.has(s.targetId)).length
  );
}

// ---------------------------------------------------------------------------
// serialization
// ---------------------------------------------------------------------------

/** Renders one frame: its grammar line plus any memo lines. */
export function formatFrame(frame: ArchitectureFrame): string[] {
  const parts = [frame.id];
  // Only ever the first line: a stray newline in the title would otherwise
  // emit a second, unparsable line.
  const title = frame.title.split("\n")[0].trim();
  if (title) parts.push(title);
  if (frame.parent) parts.push(`frame:${frame.parent}`);
  if (frame.color) parts.push(`#${frame.color}`);
  const out = [`- ${parts.join(" ")}`];
  const note = (frame.note ?? "").replace(/\s+$/, "");
  if (note) {
    for (const line of note.split("\n")) out.push(`${INDENT}${line}`);
  }
  return out;
}

/** Renders one node: its grammar line plus any memo lines. */
export function formatNode(node: ArchitectureNode): string[] {
  const parts = [node.id];
  // Only ever the first line: a stray newline in the title would otherwise
  // emit a second, unparsable line.
  const title = node.title.split("\n")[0].trim();
  if (title) parts.push(title);
  if (node.frame) parts.push(`frame:${node.frame}`);
  const mark = markOfKind(node.kind);
  if (mark) parts.push(mark);
  if (node.icon) parts.push(`icon:${node.icon}`);
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

export function formatEdge(edge: ArchitectureEdge): string {
  // The label sits between quotes; a quote inside it could not be read back.
  const label = (edge.label ?? "").replace(/\s+/g, " ").replace(/"/g, "'").trim();
  return `- ${formatEdgeEnd(edge.from, edge.fromPort)} ${edge.bidi ? "<->" : "->"} ${formatEdgeEnd(edge.to, edge.toPort)}${label ? ` "${label}"` : ""}`;
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
export function serializeArchitecture(
  content: string,
  doc: ArchitectureDocModel,
  today: string,
): string {
  const eol = detectEol(content);
  const note = splitNote(toLf(content));
  let frontmatter = setFrontmatterValue(note.frontmatter, "updated", today);
  frontmatter = setOrRemoveFrontmatterValue(frontmatter, "stickies", doc.stickiesHidden ? "hidden" : "");

  // An edge is written once per claimed pair, whatever the model holds.
  const edges: ArchitectureEdge[] = [];
  for (const e of doc.edges) if (!findEdge(edges, e)) edges.push(e);

  const body = replaceSections({ ...note, frontmatter }, [
    {
      name: "Frames",
      text: sectionBody("Frames", [...doc.frames.flatMap(formatFrame), ...doc.rawFrames]),
    },
    {
      name: "Nodes",
      text: sectionBody("Nodes", [...doc.nodes.flatMap(formatNode), ...doc.rawNodes]),
    },
    { name: "Edges", text: sectionBody("Edges", [...edges.map(formatEdge), ...doc.rawEdges]) },
    { name: "Stickies", text: formatStickySection(doc.stickies, doc.rawStickies) },
  ]);
  return withEol(body, eol);
}
