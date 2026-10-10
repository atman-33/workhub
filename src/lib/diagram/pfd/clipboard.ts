import { allocateIds, edgesWithin, remapEdges } from "../clipboard";
import type { PfdDocModel, PfdEdge, PfdNode } from "./parse";

/**
 * Copy and paste of PFD nodes (T-0688). The editor selects one node at a time,
 * so a copy carries no arrows today; the arrows between the selected nodes are
 * still taken, so a multi-select would need no change here. A copy keeps its
 * symbol: the id prefix is what decides it, and each prefix has its own count.
 */

/** How far each paste moves a placed node, down and to the right, in pixels. */
export const PFD_PASTE_OFFSET = 32;

export interface PfdClip {
  nodes: PfdNode[];
  edges: PfdEdge[];
}

export function copyPfdNodes(doc: PfdDocModel, ids: readonly string[]): PfdClip {
  const chosen = new Set(ids);
  return {
    nodes: doc.nodes.filter((n) => chosen.has(n.id)).map((n) => ({ ...n })),
    edges: edgesWithin(doc.edges, chosen),
  };
}

/** Adds copies of the nodes under fresh ids of their own symbol, `round` steps down-right. */
export function pastePfdNodes(
  doc: PfdDocModel,
  clip: PfdClip,
  round: number,
): { doc: PfdDocModel; ids: string[] } {
  const idMap = allocateIds(
    doc.nodes.map((n) => n.id),
    clip.nodes.map((n) => n.id),
  );
  const copies = clip.nodes.map((node): PfdNode => {
    const copy: PfdNode = { ...node, id: idMap.get(node.id)! };
    if (node.x !== undefined && node.y !== undefined) {
      copy.x = node.x + PFD_PASTE_OFFSET * round;
      copy.y = node.y + PFD_PASTE_OFFSET * round;
    }
    return copy;
  });
  return {
    doc: {
      ...doc,
      nodes: [...doc.nodes, ...copies],
      edges: [...doc.edges, ...remapEdges(clip.edges, idMap)],
    },
    ids: copies.map((c) => c.id),
  };
}
