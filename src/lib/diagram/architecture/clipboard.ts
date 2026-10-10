import { allocateIds, edgesWithin, remapEdges } from "../clipboard";
import type { ArchitectureDocModel, ArchitectureEdge, ArchitectureNode } from "./parse";

/**
 * Copy and paste of architecture blocks (T-0709, on the shared layer of T-0688).
 * The editor selects one element at a time, so a copy carries no arrows today;
 * the arrows between the selected blocks are still taken, so a multi-select
 * would need no change here. A copy keeps its kind, its frame (it lands in the
 * same frame) and its note, and takes the next free `C-` id. Frames are not
 * copied: copying a frame would need its members with it, which is later work.
 */

/** How far each paste moves a placed block, down and to the right, in pixels. */
export const ARCHITECTURE_PASTE_OFFSET = 32;

export interface ArchitectureClip {
  nodes: ArchitectureNode[];
  edges: ArchitectureEdge[];
}

export function copyArchitectureNodes(
  doc: ArchitectureDocModel,
  ids: readonly string[],
): ArchitectureClip {
  const chosen = new Set(ids);
  return {
    nodes: doc.nodes.filter((n) => chosen.has(n.id)).map((n) => ({ ...n })),
    edges: edgesWithin(doc.edges, chosen),
  };
}

/**
 * Adds copies of the blocks under fresh ids, `round` steps down-right. A block
 * the groups place (no `@`) is copied without one and is placed by the groups
 * again.
 */
export function pasteArchitectureNodes(
  doc: ArchitectureDocModel,
  clip: ArchitectureClip,
  round: number,
): { doc: ArchitectureDocModel; ids: string[] } {
  const idMap = allocateIds(
    doc.nodes.map((n) => n.id),
    clip.nodes.map((n) => n.id),
  );
  const copies = clip.nodes.map((node): ArchitectureNode => {
    const copy: ArchitectureNode = { ...node, id: idMap.get(node.id)! };
    if (node.x !== undefined && node.y !== undefined) {
      copy.x = node.x + ARCHITECTURE_PASTE_OFFSET * round;
      copy.y = node.y + ARCHITECTURE_PASTE_OFFSET * round;
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
