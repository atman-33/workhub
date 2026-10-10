import { allocateIds, edgesWithin, remapEdges } from "../clipboard";
import type { FlowDocModel, FlowEdge, FlowStep } from "./parse";

/**
 * Copy and paste of flow steps (T-0688). The editor selects one step at a
 * time, so a copy carries no arrows today; the arrows between the selected
 * steps are still taken, so a multi-select would need no change here.
 */

/** How far each paste moves a placed step along its lane, in pixels. */
export const FLOW_PASTE_DX = 56;

export interface FlowClip {
  steps: FlowStep[];
  edges: FlowEdge[];
}

export function copyFlowSteps(doc: FlowDocModel, ids: readonly string[]): FlowClip {
  const chosen = new Set(ids);
  return {
    steps: doc.steps.filter((s) => chosen.has(s.id)).map((s) => ({ ...s })),
    edges: edgesWithin(doc.edges, chosen),
  };
}

/**
 * Adds copies of the steps under fresh `F-` ids, in their own lane and at the
 * same vertical offset, `round` steps further along. A step the layout places
 * (no `@`) is copied without one and is placed by the layout again.
 */
export function pasteFlowSteps(
  doc: FlowDocModel,
  clip: FlowClip,
  round: number,
): { doc: FlowDocModel; ids: string[] } {
  const idMap = allocateIds(
    doc.steps.map((s) => s.id),
    clip.steps.map((s) => s.id),
  );
  const copies = clip.steps.map((step): FlowStep => {
    const copy: FlowStep = { ...step, id: idMap.get(step.id)! };
    if (step.x !== undefined) copy.x = step.x + FLOW_PASTE_DX * round;
    return copy;
  });
  return {
    doc: {
      ...doc,
      steps: [...doc.steps, ...copies],
      edges: [...doc.edges, ...remapEdges(clip.edges, idMap)],
    },
    ids: copies.map((c) => c.id),
  };
}
