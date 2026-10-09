/**
 * Business-flow note <-> document model (T-0682).
 *
 * The note is Markdown a human also edits in Obsidian, so reading is forgiving
 * and writing is conservative - the same contract as the other diagram notes:
 *
 * - Anything the grammar does not recognize is **kept, not dropped**. A line
 *   under `## Lanes`, `## Steps` or `## Edges` that is not readable (not a list
 *   item, the id of another kind, an arrow naming a step that is not there)
 *   survives as a raw line and is written back verbatim; the editor lists it as
 *   a warning.
 * - Only `## Lanes`, `## Steps`, `## Edges` and `## Stickies` are rewritten.
 *   The rest of the frontmatter, `## Memo` and every unknown section are copied
 *   byte-for-byte, in place.
 *
 * The grammar:
 *
 *   ## Lanes
 *   - L-001 <title> [#<color>]
 *   ## Steps
 *   - F-001 <title> [^start|^end|^decision] [lane:L-001] [task:<id>] [#<color>] [@<x>,<y>]
 *     <optional continuation lines, indented - the step's note>
 *   ## Edges
 *   - F-001 -> F-002 ["label"]
 *
 * A step with no `^` is a process. `@x,y` is the step's centre: `x` is the
 * absolute horizontal position in pixels and `y` the vertical offset from the
 * middle of its lane; a step with none is placed by the layout and only gets
 * one when the user drags it. An arrow has no id: `(from, to)` is its identity,
 * and two lines naming the same pair are one arrow.
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

export const STEP_PREFIX = "F";
export const LANE_PREFIX = "L";
const STEP_ID_RE = /^F-\d+$/;
const LANE_ID_RE = /^L-\d+$/;
/** Any `X-123` shaped id: another kind's element, which this note keeps but
 * does not read. */
const ANY_ID_RE = /^[A-Z]{1,3}-\d+$/;
const INDENT = "  ";

export const STEP_KINDS = ["process", "start", "end", "decision"] as const;
export type StepKind = (typeof STEP_KINDS)[number];
const KIND_MARKS: Record<string, StepKind> = {
  "^start": "start",
  "^end": "end",
  "^decision": "decision",
  "^process": "process",
};

export interface FlowLane {
  /** Stable, file-unique id (`L-001`). Never reassigned and never reused. */
  id: string;
  title: string;
  color?: Color;
}

export interface FlowStep {
  /** Stable, file-unique id (`F-001`). Never reassigned and never reused. */
  id: string;
  title: string;
  kind: StepKind;
  /** The lane it sits in. Kept as written even when no such lane exists - the
   * step then shows in the unassigned band and the file is not rewritten. */
  lane?: string;
  task?: string;
  color?: Color;
  /** Centre, absolute x in pixels. Absent until the step is moved. */
  x?: number;
  /** Vertical offset of the centre from the middle of its lane, in pixels. */
  y?: number;
  /** Continuation lines - shown on hover. */
  note?: string;
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
}

export interface FlowDocModel {
  /** `title` from the frontmatter; the file name stands in when absent. */
  title: string;
  lanes: FlowLane[];
  steps: FlowStep[];
  edges: FlowEdge[];
  /** Lines the grammar did not recognize, kept verbatim, per section. */
  rawLanes: string[];
  rawSteps: string[];
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
const EDGE_RE = /^\s*-\s+([A-Za-z]{1,3}-\d+)\s*->\s*([A-Za-z]{1,3}-\d+)\s*(?:"(.*)")?\s*$/;

interface Tokens {
  id: string;
  hadId: boolean;
  rest: string[];
}

/** Splits a list line into its id (when it starts with one of `idRe`) and the
 * remaining tokens. `null` for a line that is not a list item, or that starts
 * with another kind's id. */
function tokenize(line: string, idRe: RegExp): Tokens | null {
  const m = /^\s*-\s+(.*)$/.exec(line);
  if (!m) return null;
  const tokens = m[1].trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  if (idRe.test(tokens[0])) return { id: tokens[0], hadId: true, rest: tokens.slice(1) };
  if (ANY_ID_RE.test(tokens[0])) return null;
  return { id: "", hadId: false, rest: tokens };
}

function isColor(tok: string): boolean {
  return tok.startsWith("#") && (COLORS as readonly string[]).includes(tok.slice(1));
}

function parseLaneLine(line: string): { lane: FlowLane; hadId: boolean } | null {
  const t = tokenize(line, LANE_ID_RE);
  if (!t) return null;
  let color: Color | undefined;
  const title: string[] = [];
  for (const tok of t.rest) {
    if (isColor(tok) && !color) color = tok.slice(1) as Color;
    else title.push(tok);
  }
  return {
    hadId: t.hadId,
    lane: { id: t.id, title: title.join(" "), ...(color ? { color } : {}) },
  };
}

/** `- F-002 見積を作る ^decision lane:L-001 task:T-0100 #blue @640,12` */
function parseStepLine(line: string): { step: FlowStep; hadId: boolean } | null {
  const t = tokenize(line, STEP_ID_RE);
  if (!t) return null;
  let kind: StepKind | undefined;
  let lane: string | undefined;
  let task: string | undefined;
  let color: Color | undefined;
  let x: number | undefined;
  let y: number | undefined;
  const title: string[] = [];
  // Modifiers may appear in any order; anything left over is the title, so an
  // unrecognized `#word`, `^word` or a malformed `@` stays part of it.
  for (const tok of t.rest) {
    const pos = POSITION_RE.exec(tok);
    if (pos && x === undefined) {
      x = Math.round(Number(pos[1]));
      y = Math.round(Number(pos[2]));
    } else if (tok in KIND_MARKS && !kind) {
      kind = KIND_MARKS[tok];
    } else if (tok.startsWith("lane:") && tok.length > 5 && !lane) {
      lane = tok.slice(5);
    } else if (tok.startsWith("task:") && tok.length > 5 && !task) {
      task = tok.slice(5);
    } else if (isColor(tok) && !color) {
      color = tok.slice(1) as Color;
    } else {
      title.push(tok);
    }
  }
  return {
    hadId: t.hadId,
    step: {
      id: t.id,
      title: title.join(" "),
      kind: kind ?? "process",
      ...(lane ? { lane } : {}),
      ...(task ? { task } : {}),
      ...(color ? { color } : {}),
      ...(x !== undefined && y !== undefined ? { x, y } : {}),
    },
  };
}

function parseEdgeLine(line: string): FlowEdge | null {
  const m = EDGE_RE.exec(line);
  if (!m) return null;
  const label = (m[3] ?? "").trim();
  return { from: m[1], to: m[2], ...(label ? { label } : {}) };
}

/** Parses a flow note. `fallbackTitle` (usually the file name) stands in when
 * the frontmatter has no `title`. */
export function parseFlow(content: string, fallbackTitle = ""): FlowDocModel {
  // Line-oriented patterns end in `(.*)$`, which `\r` breaks - so the file's
  // line ending is dealt with once, here.
  const note = splitNote(toLf(content));
  const doc: FlowDocModel = {
    title: frontmatterValue(note.frontmatter, "title") || fallbackTitle,
    lanes: [],
    steps: [],
    edges: [],
    rawLanes: [],
    rawSteps: [],
    rawEdges: [],
    mintedIds: false,
    stickies: [],
    rawStickies: [],
    stickiesHidden: frontmatterValue(note.frontmatter, "stickies") === "hidden",
  };

  for (const line of bodyLines(sectionText(note, "Lanes"))) {
    const parsed = parseLaneLine(line);
    if (parsed) {
      doc.lanes.push(parsed.lane);
      if (!parsed.hadId) doc.mintedIds = true;
    } else {
      doc.rawLanes.push(line.trimEnd());
    }
  }

  const notes = new Map<FlowStep, string[]>();
  let open: FlowStep | null = null;
  for (const line of bodyLines(sectionText(note, "Steps"))) {
    const parsed = parseStepLine(line);
    if (parsed) {
      doc.steps.push(parsed.step);
      if (!parsed.hadId) doc.mintedIds = true;
      open = parsed.step;
      continue;
    }
    if (open && isContinuation(line)) {
      const collected = notes.get(open);
      if (collected) collected.push(line.trim());
      else notes.set(open, [line.trim()]);
      continue;
    }
    open = null;
    doc.rawSteps.push(line.trimEnd());
  }
  for (const [step, collected] of notes) step.note = collected.join("\n");

  if (assignMissingIds(doc.lanes, LANE_PREFIX)) doc.mintedIds = true;
  if (assignMissingIds(doc.steps, STEP_PREFIX)) doc.mintedIds = true;

  // An arrow is real only between two steps that exist; any other is kept as
  // the line it was. Two lines for one pair are one arrow.
  const stepIds = new Set(doc.steps.map((s) => s.id));
  for (const line of bodyLines(sectionText(note, "Edges"))) {
    const edge = parseEdgeLine(line);
    if (!edge || !stepIds.has(edge.from) || !stepIds.has(edge.to)) {
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

/** Gives every id-less element an id, and repairs duplicates. Returns whether
 * anything was minted. */
function assignMissingIds(items: { id: string }[], prefix: string): boolean {
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  const seen = new Set<string>();
  let max = 0;
  for (const item of items) {
    const n = re.exec(item.id);
    if (n) max = Math.max(max, Number(n[1]));
  }
  let minted = false;
  for (const item of items) {
    if (!item.id || seen.has(item.id)) {
      max += 1;
      item.id = formatId(prefix, max);
      minted = true;
    }
    seen.add(item.id);
  }
  return minted;
}

/** Next free `F-NNN` for this document. Ids are never reused. */
export function nextStepId(steps: FlowStep[]): string {
  return nextId(STEP_PREFIX, steps.map((s) => s.id));
}

/** Next free `L-NNN` for this document. */
export function nextLaneId(lanes: FlowLane[]): string {
  return nextId(LANE_PREFIX, lanes.map((l) => l.id));
}

export function findStep(steps: FlowStep[], id: string): FlowStep | null {
  return steps.find((s) => s.id === id) ?? null;
}

/** How many lines the note keeps but the editor cannot show: unreadable lines
 * in any section, and stickies whose step is gone. */
export function warningCount(doc: FlowDocModel): number {
  const ids = new Set(doc.steps.map((s) => s.id));
  return (
    doc.rawLanes.length +
    doc.rawSteps.length +
    doc.rawEdges.length +
    doc.stickies.filter((s) => !ids.has(s.targetId)).length
  );
}

// ---------------------------------------------------------------------------
// serialization
// ---------------------------------------------------------------------------

export function formatLane(lane: FlowLane): string {
  const parts = [lane.id];
  const title = lane.title.split("\n")[0].trim();
  if (title) parts.push(title);
  if (lane.color) parts.push(`#${lane.color}`);
  return `- ${parts.join(" ")}`;
}

/** Renders one step: its grammar line plus any note lines. */
export function formatStep(step: FlowStep): string[] {
  const parts = [step.id];
  // Only ever the first line: a stray newline in the title would otherwise
  // emit a second, unparsable line.
  const title = step.title.split("\n")[0].trim();
  if (title) parts.push(title);
  if (step.kind !== "process") parts.push(`^${step.kind}`);
  if (step.lane) parts.push(`lane:${step.lane}`);
  if (step.task) parts.push(`task:${step.task}`);
  if (step.color) parts.push(`#${step.color}`);
  if (step.x !== undefined && step.y !== undefined) {
    parts.push(`@${Math.round(step.x)},${Math.round(step.y)}`);
  }
  const out = [`- ${parts.join(" ")}`];
  const note = (step.note ?? "").replace(/\s+$/, "");
  if (note) {
    for (const line of note.split("\n")) out.push(`${INDENT}${line}`);
  }
  return out;
}

export function formatEdge(edge: FlowEdge): string {
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
export function serializeFlow(content: string, doc: FlowDocModel, today: string): string {
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

  const body = replaceSections(
    { ...note, frontmatter },
    [
      { name: "Lanes", text: sectionBody("Lanes", [...doc.lanes.map(formatLane), ...doc.rawLanes]) },
      {
        name: "Steps",
        text: sectionBody("Steps", [...doc.steps.flatMap(formatStep), ...doc.rawSteps]),
      },
      { name: "Edges", text: sectionBody("Edges", [...edges.map(formatEdge), ...doc.rawEdges]) },
      { name: "Stickies", text: formatStickySection(doc.stickies, doc.rawStickies) },
    ],
  );
  return withEol(body, eol);
}
