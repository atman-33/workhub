/**
 * Edits to a PFD document, as pure functions from model to model.
 *
 * The view holds the undo stack and the debounced write; everything that
 * decides *what* an edit does lives here, so it can be tested without a DOM.
 * The connection rule is the symbol registry's (`mayConnect`), applied to every
 * arrow the editor draws or re-routes.
 */
import { connectEdges, reattachEdge } from "../node-edge";
import type { PfdDocModel, PfdEdge, PfdNode } from "./parse";
import { nextNodeId } from "./parse";
import { mayConnect } from "./symbols";

/** `patch` laid over `base`; a key set to `undefined` is removed. */
export function applyPatch<T extends object>(base: T, patch: Partial<T>): T {
  const next = { ...base, ...patch } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
  }
  return next as T;
}

// ---- nodes --------------------------------------------------------------------

export interface NewNode {
  /** Id prefix of the symbol to add. */
  prefix: string;
  title?: string;
  /** Placement: the centre. Omit both for the layout to choose. */
  x?: number;
  y?: number;
}

export function addNode(doc: PfdDocModel, init: NewNode): { doc: PfdDocModel; id: string } {
  const node: PfdNode = {
    id: nextNodeId(doc.nodes, init.prefix),
    title: init.title ?? "",
    ...(init.x !== undefined && init.y !== undefined
      ? { x: Math.round(init.x), y: Math.round(init.y) }
      : {}),
  };
  return { doc: { ...doc, nodes: [...doc.nodes, node] }, id: node.id };
}

export function patchNode(doc: PfdDocModel, id: string, patch: Partial<PfdNode>): PfdDocModel {
  return {
    ...doc,
    nodes: doc.nodes.map((n) => (n.id === id ? applyPatch(n, patch) : n)),
  };
}

/** Removes a node with the arrows into and out of it and the stickies pinned to it. */
export function deleteNode(doc: PfdDocModel, id: string): PfdDocModel {
  return {
    ...doc,
    nodes: doc.nodes.filter((n) => n.id !== id),
    edges: doc.edges.filter((e) => e.from !== id && e.to !== id),
    stickies: doc.stickies.filter((s) => s.targetId !== id),
  };
}

/** Drops a node at a diagram point (its centre) after a drag. Only this node gets a `@`. */
export function moveNodeTo(doc: PfdDocModel, id: string, cx: number, cy: number): PfdDocModel {
  return patchNode(doc, id, { x: Math.round(cx), y: Math.round(cy) });
}

/** "Auto-align": removes every `@`, handing all positions back to the layout. */
export function autoAlign(doc: PfdDocModel): PfdDocModel {
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      const { x: _x, y: _y, ...rest } = n;
      return rest;
    }),
  };
}

/** True when at least one node carries a position. */
export function hasManualPositions(doc: PfdDocModel): boolean {
  return doc.nodes.some((n) => n.x !== undefined);
}

// ---- arrows -------------------------------------------------------------------

const newEdge = (from: string, to: string): PfdEdge => ({ from, to });

/** Adds an arrow; the same model back when it would change nothing or the rule forbids it. */
export function connect(doc: PfdDocModel, from: string, to: string): PfdDocModel {
  const edges = connectEdges(doc.edges, from, to, newEdge, mayConnect);
  return edges ? { ...doc, edges } : doc;
}

/** Moves one end of an arrow to another node; the same model back when nothing changes. */
export function reattach(
  doc: PfdDocModel,
  edge: { from: string; to: string },
  end: "from" | "to",
  nodeId: string,
): PfdDocModel {
  const edges = reattachEdge(doc.edges, edge, end, nodeId, mayConnect);
  return edges ? { ...doc, edges } : doc;
}

export function deleteEdge(doc: PfdDocModel, edge: { from: string; to: string }): PfdDocModel {
  return { ...doc, edges: doc.edges.filter((e) => !(e.from === edge.from && e.to === edge.to)) };
}
