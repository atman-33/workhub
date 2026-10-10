import { allocateIds, edgesWithin, remapEdges } from "../clipboard";
import type { UsecaseDocModel, UsecaseEdge, UsecaseNode } from "./parse";

/**
 * Copy and paste of use case nodes (T-0706, on the shared layer of T-0688;
 * multi-select T-0716). A copy carries the given nodes with the lines between
 * them, `--` and `->` alike (arrowhead and label included); lines to nodes
 * outside the selection are left behind, and stickies are never copied. A copy
 * keeps its kind and its note - a person's actions travel with the person -
 * and takes the next free `U-` id.
 */

/** How far each paste moves a placed node, down and to the right, in pixels. */
export const USECASE_PASTE_OFFSET = 32;

export interface UsecaseClip {
  nodes: UsecaseNode[];
  edges: UsecaseEdge[];
}

export function copyUsecaseNodes(doc: UsecaseDocModel, ids: readonly string[]): UsecaseClip {
  const chosen = new Set(ids);
  return {
    nodes: doc.nodes.filter((n) => chosen.has(n.id)).map((n) => ({ ...n })),
    edges: edgesWithin(doc.edges, chosen),
  };
}

/**
 * Adds copies of the nodes under fresh ids, `round` steps down-right. A node
 * the ring places (no `@`) is copied without one and is placed by the ring again.
 */
export function pasteUsecaseNodes(
  doc: UsecaseDocModel,
  clip: UsecaseClip,
  round: number,
): { doc: UsecaseDocModel; ids: string[] } {
  const idMap = allocateIds(
    doc.nodes.map((n) => n.id),
    clip.nodes.map((n) => n.id),
  );
  const copies = clip.nodes.map((node): UsecaseNode => {
    const copy: UsecaseNode = { ...node, id: idMap.get(node.id)! };
    if (node.x !== undefined && node.y !== undefined) {
      copy.x = node.x + USECASE_PASTE_OFFSET * round;
      copy.y = node.y + USECASE_PASTE_OFFSET * round;
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
