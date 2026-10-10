import { allocateIds } from "../diagram/clipboard";
import {
  cloneNodes,
  findNode,
  findParent,
  freezeRootChildSides,
  visit,
  type MindmapNode,
} from "./parse";

/**
 * Copy and paste of mindmap nodes (T-0688).
 *
 * A mindmap node has no position - the layout draws the tree - so "a little
 * way from the original" is expressed by *where in the tree* the copy goes:
 * under a chosen node (paste) or right after the source (duplicate). A node is
 * copied with its subtree, as in every mindmap tool; stickies stay behind.
 */

/** An independent copy of the node with its whole subtree, or null when it is not there. */
export function copyMindmapNode(roots: readonly MindmapNode[], id: string): MindmapNode | null {
  const node = findNode(roots as MindmapNode[], id);
  return node ? cloneNodes([node])[0] : null;
}

/**
 * Inserts a copy of `clip` (fresh ids through the whole subtree) into a copy of
 * the tree and returns it with the new top node's id, or null when `targetId`
 * names nothing.
 *
 * - `child`: the last child of the target, which is expanded if it was folded.
 * - `sibling`: right after the target, on the same side of the root. The
 *   sibling of a root is a new branch of that root, never a second root.
 * - A null `targetId` appends a new top-level node.
 */
export function pasteMindmapNode(
  roots: readonly MindmapNode[],
  clip: MindmapNode,
  targetId: string | null,
  as: "child" | "sibling",
): { roots: MindmapNode[]; id: string } | null {
  const next = cloneNodes(roots as MindmapNode[]);
  const copy = cloneNodes([clip])[0];

  const existing: string[] = [];
  visit(next, (n) => existing.push(n.id));
  const sources: string[] = [];
  visit([copy], (n) => sources.push(n.id));
  const idMap = allocateIds(existing, sources);
  visit([copy], (n) => {
    n.id = idMap.get(n.id)!;
  });

  if (targetId === null) {
    delete copy.side;
    next.push(copy);
    return { roots: next, id: copy.id };
  }
  const target = findNode(next, targetId);
  if (!target) return null;
  const parent = as === "sibling" ? findParent(next, targetId) : null;

  if (!parent) {
    // `child`, or the sibling of a root (a branch of it).
    delete target.collapsed;
    // A side only means something on a branch of the root, and the layout
    // picks it by position for a new one.
    delete copy.side;
    target.children.push(copy);
    return { roots: next, id: copy.id };
  }
  const at = parent.children.findIndex((n) => n.id === targetId) + 1;
  if (next.includes(parent)) {
    // A branch of the root: freeze the others' sides first so the insertion
    // cannot shift any of them across the root.
    freezeRootChildSides(parent);
    copy.side = parent.children[at - 1].side;
  } else {
    delete copy.side;
  }
  parent.children.splice(at, 0, copy);
  return { roots: next, id: copy.id };
}
