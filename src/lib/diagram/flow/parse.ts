/**
 * Business-flow note <-> document model (T-0682).
 *
 * The note is Markdown a human also edits in Obsidian, so reading is forgiving
 * and writing is conservative - the same contract as the other diagram notes
 * (the shared grammar is `../note-grammar.ts`):
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
 * and two lines naming the same pair are one arrow. A lane has no note lines.
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
  prefixModifier,
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

export const STEP_PREFIX = "F";
export const LANE_PREFIX = "L";

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
  /** Where the arrow leaves `from`. Absent means automatic. */
  fromPort?: EdgePort;
  /** Where the arrow enters `to`. Absent means automatic. */
  toPort?: EdgePort;
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

/** `- L-001 営業 #blue` */
function buildLane(id: string, rest: string[]): FlowLane {
  const { fields, title } = readModifiers<{ color: Color }>(rest, { color: colorModifier });
  return { id, title, ...(fields.color ? { color: fields.color } : {}) };
}

interface StepFields {
  pos: { x: number; y: number };
  kind: StepKind;
  lane: string;
  task: string;
  color: Color;
}

/** `- F-002 見積を作る ^decision lane:L-001 task:T-0100 #blue @640,12` */
function buildStep(id: string, rest: string[]): FlowStep {
  const { fields, title } = readModifiers<StepFields>(rest, {
    pos: positionModifier,
    kind: (tok) => (tok in KIND_MARKS ? KIND_MARKS[tok] : undefined),
    lane: prefixModifier("lane:"),
    task: taskModifier,
    color: colorModifier,
  });
  return {
    id,
    title,
    kind: fields.kind ?? "process",
    ...(fields.lane ? { lane: fields.lane } : {}),
    ...(fields.task ? { task: fields.task } : {}),
    ...(fields.color ? { color: fields.color } : {}),
    ...(fields.pos ?? {}),
  };
}

/** Parses a flow note. `fallbackTitle` (usually the file name) stands in when
 * the frontmatter has no `title`. */
export function parseFlow(content: string, fallbackTitle = ""): FlowDocModel {
  const { note, title, stickiesHidden } = readEnvelope(content, fallbackTitle);
  const lanes = readElements<FlowLane>(sectionText(note, "Lanes"), {
    ownId: (tok) => /^L-\d+$/.test(tok),
    build: buildLane,
    continuation: "none",
    mintPrefix: LANE_PREFIX,
  });
  const steps = readElements<FlowStep>(sectionText(note, "Steps"), {
    ownId: (tok) => /^F-\d+$/.test(tok),
    build: buildStep,
    mintPrefix: STEP_PREFIX,
  });
  // An arrow is real only between two steps that exist; any other is kept as
  // the line it was. Two lines for one pair are one arrow.
  const edges = readEdges<FlowEdge>(
    sectionText(note, "Edges"),
    new Set(steps.items.map((s) => s.id)),
    {
      parse: (line) => readArrowLine(line, { label: true }),
      isTwin: sameOrderedPair,
      onTwin: "merge-label",
    },
  );
  const stickies = readStickies(note);
  return {
    title,
    lanes: lanes.items,
    steps: steps.items,
    edges: edges.edges,
    rawLanes: lanes.raw,
    rawSteps: steps.raw,
    rawEdges: edges.raw,
    mintedIds: lanes.minted || steps.minted || stickies.minted,
    stickies: stickies.stickies,
    rawStickies: stickies.rawStickies,
    stickiesHidden,
  };
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
  return findById(steps, id);
}

/** How many lines the note keeps but the editor cannot show: unreadable lines
 * in any section, and stickies whose step is gone. */
export function warningCount(doc: FlowDocModel): number {
  return countWarnings(
    [doc.rawLanes, doc.rawSteps, doc.rawEdges],
    doc.stickies,
    new Set(doc.steps.map((s) => s.id)),
  );
}

// ---------------------------------------------------------------------------
// serialization
// ---------------------------------------------------------------------------

export function formatLane(lane: FlowLane): string {
  return formatElementLine(lane.id, lane.title, [formatColor(lane.color)]);
}

/** Renders one step: its grammar line plus any note lines. */
export function formatStep(step: FlowStep): string[] {
  return [
    formatElementLine(step.id, step.title, [
      step.kind !== "process" ? `^${step.kind}` : undefined,
      step.lane ? `lane:${step.lane}` : undefined,
      formatTask(step.task),
      formatColor(step.color),
      formatPosition(step.x, step.y),
    ]),
    ...formatNoteLines(step.note),
  ];
}

export function formatEdge(edge: FlowEdge): string {
  return formatArrowLine(edge, true);
}

/**
 * Renders the model back into `content`, replacing only the managed sections
 * and stamping `updated`. Unrecognized lines are appended after the recognized
 * ones so nothing is lost, and every other byte of the file is carried through.
 */
export function serializeFlow(content: string, doc: FlowDocModel, today: string): string {
  // An arrow is written once per pair, whatever the model holds.
  const edges = uniqueEdges(doc.edges, sameOrderedPair);
  return writeNote(content, today, {
    stickiesHidden: doc.stickiesHidden,
    sections: [
      { name: "Lanes", text: formatSection("Lanes", [...doc.lanes.map(formatLane), ...doc.rawLanes]) },
      { name: "Steps", text: formatSection("Steps", [...doc.steps.flatMap(formatStep), ...doc.rawSteps]) },
      { name: "Edges", text: formatSection("Edges", [...edges.map(formatEdge), ...doc.rawEdges]) },
      stickySection(doc.stickies, doc.rawStickies),
    ],
  });
}
