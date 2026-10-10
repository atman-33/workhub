import { allocateIds, edgesWithin, remapEdges } from "../clipboard";
import type { AlgorithmDocModel, AlgorithmEdge, AlgorithmNode } from "./parse";

/**
 * Copy and paste of program-flow nodes (T-0698, on the shared layer of
 * T-0688; multi-select T-0716). A copy carries the given nodes with the
 * arrows between them (labels included); arrows to nodes outside the
 * selection are left behind, and stickies are never copied. A copy keeps its
 * kind and takes the next free `A-` id.
 */

/** How far each paste moves a placed node, down and to the right, in pixels. */
export const ALGORITHM_PASTE_OFFSET = 32;

export interface AlgorithmClip {
  nodes: AlgorithmNode[];
  edges: AlgorithmEdge[];
}

export function copyAlgorithmNodes(doc: AlgorithmDocModel, ids: readonly string[]): AlgorithmClip {
  const chosen = new Set(ids);
  return {
    nodes: doc.nodes.filter((n) => chosen.has(n.id)).map((n) => ({ ...n })),
    edges: edgesWithin(doc.edges, chosen),
  };
}

/**
 * Adds copies of the nodes under fresh ids, `round` steps down-right. A node
 * the layout places (no `@`) is copied without one and is placed by the layout
 * again.
 */
export function pasteAlgorithmNodes(
  doc: AlgorithmDocModel,
  clip: AlgorithmClip,
  round: number,
): { doc: AlgorithmDocModel; ids: string[] } {
  const idMap = allocateIds(
    doc.nodes.map((n) => n.id),
    clip.nodes.map((n) => n.id),
  );
  const copies = clip.nodes.map((node): AlgorithmNode => {
    const copy: AlgorithmNode = { ...node, id: idMap.get(node.id)! };
    if (node.x !== undefined && node.y !== undefined) {
      copy.x = node.x + ALGORITHM_PASTE_OFFSET * round;
      copy.y = node.y + ALGORITHM_PASTE_OFFSET * round;
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
