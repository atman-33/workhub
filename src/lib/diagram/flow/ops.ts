/**
 * Edits to a flow document, as pure functions from model to model.
 *
 * The view holds the undo stack and the debounced write; everything that
 * decides *what* an edit does lives here, so it can be tested without a DOM:
 * moving a step into another lane rewrites its `lane:`, deleting a step takes
 * its arrows and stickies with it, and so on.
 */
import {
  connectEdges,
  reattachEdge,
  type ConnectionRule,
  allowAnyConnection,
} from "../node-edge";
import { bandKeyOf, maxOffset, UNASSIGNED, type FlowLayout } from "./layout";
import {
  nextLaneId,
  nextStepId,
  type FlowDocModel,
  type FlowEdge,
  type FlowLane,
  type FlowStep,
  type StepKind,
} from "./parse";

/** `patch` laid over `base`; a key set to `undefined` is removed. */
export function applyPatch<T extends object>(base: T, patch: Partial<T>): T {
  const next = { ...base, ...patch } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
  }
  return next as T;
}

// ---- steps --------------------------------------------------------------------

export interface NewStep {
  kind?: StepKind;
  title?: string;
  /** Lane id; omit for the unassigned band. */
  lane?: string;
  /** Placement: absolute x and offset from the lane's middle. Omit both for auto. */
  x?: number;
  y?: number;
}

export function addStep(doc: FlowDocModel, init: NewStep = {}): { doc: FlowDocModel; id: string } {
  const step: FlowStep = {
    id: nextStepId(doc.steps),
    title: init.title ?? "",
    kind: init.kind ?? "process",
    ...(init.lane ? { lane: init.lane } : {}),
    ...(init.x !== undefined && init.y !== undefined
      ? { x: Math.round(init.x), y: Math.round(init.y) }
      : {}),
  };
  return { doc: { ...doc, steps: [...doc.steps, step] }, id: step.id };
}

export function patchStep(doc: FlowDocModel, id: string, patch: Partial<FlowStep>): FlowDocModel {
  return {
    ...doc,
    steps: doc.steps.map((s) => (s.id === id ? applyPatch(s, patch) : s)),
  };
}

/** Removes a step with the arrows into and out of it and the stickies pinned to it. */
export function deleteStep(doc: FlowDocModel, id: string): FlowDocModel {
  return {
    ...doc,
    steps: doc.steps.filter((s) => s.id !== id),
    edges: doc.edges.filter((e) => e.from !== id && e.to !== id),
    stickies: doc.stickies.filter((s) => s.targetId !== id),
  };
}

/**
 * Drops a step at a diagram point (`cx`, `cy`, its centre) after a drag.
 *
 * Inside its own band only the `@` changes. Over another band the step joins
 * that lane: `lane:` is rewritten (or removed for the unassigned band) and the
 * vertical offset goes back to 0, because an offset from one lane's middle
 * means nothing in another.
 */
export function moveStepTo(
  doc: FlowDocModel,
  layout: FlowLayout,
  id: string,
  cx: number,
  cy: number,
): FlowDocModel {
  const laid = layout.byId.get(id);
  if (!laid) return doc;
  const band = layout.bandAt(cy);
  const x = Math.round(cx);
  if (band.key === laid.band) {
    const middle = band.y + band.height / 2;
    const limit = maxOffset(band.height, laid.height);
    const y = Math.round(Math.max(-limit, Math.min(limit, cy - middle)));
    return patchStep(doc, id, { x, y });
  }
  return patchStep(doc, id, { x, y: 0, lane: band.key === UNASSIGNED ? undefined : band.key });
}

/** Moves a step by a step of the keyboard, staying in its band. */
export function nudgeStep(
  doc: FlowDocModel,
  layout: FlowLayout,
  id: string,
  dx: number,
  dy: number,
): FlowDocModel {
  const laid = layout.byId.get(id);
  if (!laid) return doc;
  const band = layout.bandAt(laid.cy);
  const middle = band.y + band.height / 2;
  const limit = maxOffset(band.height, laid.height);
  return patchStep(doc, id, {
    x: Math.round(laid.cx + dx),
    y: Math.round(Math.max(-limit, Math.min(limit, laid.cy + dy - middle))),
  });
}

/** "Auto-align": removes every `@`, handing all positions back to the layout. */
export function autoAlign(doc: FlowDocModel): FlowDocModel {
  return {
    ...doc,
    steps: doc.steps.map((s) => {
      const { x: _x, y: _y, ...rest } = s;
      return rest;
    }),
  };
}

/** True when at least one step carries a position. */
export function hasManualPositions(doc: FlowDocModel): boolean {
  return doc.steps.some((s) => s.x !== undefined);
}

// ---- lanes --------------------------------------------------------------------

export function addLane(doc: FlowDocModel, title = ""): { doc: FlowDocModel; id: string } {
  const lane: FlowLane = { id: nextLaneId(doc.lanes), title };
  return { doc: { ...doc, lanes: [...doc.lanes, lane] }, id: lane.id };
}

export function patchLane(doc: FlowDocModel, id: string, patch: Partial<FlowLane>): FlowDocModel {
  return { ...doc, lanes: doc.lanes.map((l) => (l.id === id ? applyPatch(l, patch) : l)) };
}

/** Moves a lane one place up (-1) or down (+1). */
export function moveLane(doc: FlowDocModel, id: string, direction: -1 | 1): FlowDocModel {
  const from = doc.lanes.findIndex((l) => l.id === id);
  const to = from + direction;
  if (from === -1 || to < 0 || to >= doc.lanes.length) return doc;
  const lanes = [...doc.lanes];
  [lanes[from], lanes[to]] = [lanes[to], lanes[from]];
  return { ...doc, lanes };
}

/**
 * Removes a lane. Its steps are not deleted: they lose their `lane:` (and the
 * vertical offset that was measured from it) and fall to the unassigned band.
 */
export function deleteLane(doc: FlowDocModel, id: string): FlowDocModel {
  return {
    ...doc,
    lanes: doc.lanes.filter((l) => l.id !== id),
    steps: doc.steps.map((s) => {
      if (s.lane !== id) return s;
      const { lane: _lane, ...rest } = s;
      return rest.x !== undefined ? { ...rest, y: 0 } : rest;
    }),
  };
}

/** How many steps are in a lane. */
export function stepsInLane(doc: FlowDocModel, id: string): number {
  return doc.steps.filter((s) => bandKeyOf(s, doc.lanes) === id).length;
}

// ---- arrows -------------------------------------------------------------------

const newEdge = (from: string, to: string): FlowEdge => ({ from, to });

/** Adds an arrow; the same model back when it would change nothing. */
export function connect(
  doc: FlowDocModel,
  from: string,
  to: string,
  rule: ConnectionRule = allowAnyConnection,
): FlowDocModel {
  const edges = connectEdges(doc.edges, from, to, newEdge, rule);
  return edges ? { ...doc, edges } : doc;
}

/** Moves one end of an arrow to another step; the same model back when nothing changes. */
export function reattach(
  doc: FlowDocModel,
  edge: { from: string; to: string },
  end: "from" | "to",
  nodeId: string,
  rule: ConnectionRule = allowAnyConnection,
): FlowDocModel {
  const edges = reattachEdge(doc.edges, edge, end, nodeId, rule);
  return edges ? { ...doc, edges } : doc;
}

export function patchEdge(
  doc: FlowDocModel,
  edge: { from: string; to: string },
  patch: Partial<FlowEdge>,
): FlowDocModel {
  return {
    ...doc,
    edges: doc.edges.map((e) =>
      e.from === edge.from && e.to === edge.to ? applyPatch(e, patch) : e,
    ),
  };
}

export function deleteEdge(doc: FlowDocModel, edge: { from: string; to: string }): FlowDocModel {
  return { ...doc, edges: doc.edges.filter((e) => !(e.from === edge.from && e.to === edge.to)) };
}
