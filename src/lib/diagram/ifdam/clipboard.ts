import { allocateIds, edgesWithin, remapEdges } from "../clipboard";
import type { IfdamDocModel, IfdamEdge, IfdamNode } from "./parse";

/**
 * Copy and paste of IFDAM nodes (T-0703, on the shared layer of T-0688;
 * multi-select T-0716). A copy carries the given nodes with the arrows between
 * them (labels included); arrows to nodes outside the selection are left
 * behind, and stickies are never copied. A copy keeps its kind and takes the
 * next free `V-` id, and **takes its lines with it**: a copied screen keeps its
 * show / input / action items and its memo, in the order they were written.
 */

/** How far each paste moves a placed node, down and to the right, in pixels. */
export const IFDAM_PASTE_OFFSET = 32;

export interface IfdamClip {
  nodes: IfdamNode[];
  edges: IfdamEdge[];
}

function cloneNode(node: IfdamNode): IfdamNode {
  return { ...node, lines: node.lines.map((l) => ({ ...l })) };
}

export function copyIfdamNodes(doc: IfdamDocModel, ids: readonly string[]): IfdamClip {
  const chosen = new Set(ids);
  return {
    nodes: doc.nodes.filter((n) => chosen.has(n.id)).map(cloneNode),
    edges: edgesWithin(doc.edges, chosen),
  };
}

/**
 * Adds copies of the nodes under fresh ids, `round` steps down-right. A node
 * the layout places (no `@`) is copied without one and is placed by the layout
 * again.
 */
export function pasteIfdamNodes(
  doc: IfdamDocModel,
  clip: IfdamClip,
  round: number,
): { doc: IfdamDocModel; ids: string[] } {
  const idMap = allocateIds(
    doc.nodes.map((n) => n.id),
    clip.nodes.map((n) => n.id),
  );
  const copies = clip.nodes.map((node): IfdamNode => {
    const copy: IfdamNode = { ...cloneNode(node), id: idMap.get(node.id)! };
    if (node.x !== undefined && node.y !== undefined) {
      copy.x = node.x + IFDAM_PASTE_OFFSET * round;
      copy.y = node.y + IFDAM_PASTE_OFFSET * round;
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
