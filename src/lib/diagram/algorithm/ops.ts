/**
 * Edits to a program-flow document, as pure functions from model to model.
 *
 * The view holds the undo stack and the debounced write; everything that
 * decides *what* an edit does lives here, so it can be tested without a DOM:
 * deleting a node takes its arrows and stickies with it, "add after" on a
 * decision makes the new node its next exit, and so on. Any two different nodes
 * may be joined (`allowAnyConnection`), and a decision has no limit on its exits.
 */
import { allowAnyConnection, connectEdges, reattachEdge } from "../node-edge";
import type { AlgorithmLayout } from "./layout";
import {
  nextNodeId,
  type AlgorithmDocModel,
  type AlgorithmEdge,
  type AlgorithmNode,
} from "./parse";
import { DEFAULT_KIND, type NodeKind } from "./symbols";

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
  kind?: NodeKind;
  title?: string;
  /** Placement: the centre, absolute. Omit both for the layout to choose. */
  x?: number;
  y?: number;
}

export function addNode(
  doc: AlgorithmDocModel,
  init: NewNode = {},
): { doc: AlgorithmDocModel; id: string } {
  const node: AlgorithmNode = {
    id: nextNodeId(doc.nodes),
    title: init.title ?? "",
    kind: init.kind ?? DEFAULT_KIND,
    ...(init.x !== undefined && init.y !== undefined
      ? { x: Math.round(init.x), y: Math.round(init.y) }
      : {}),
  };
  return { doc: { ...doc, nodes: [...doc.nodes, node] }, id: node.id };
}

/**
 * Adds a node after `fromId` and joins them with an arrow (the editor's `+`).
 * Nothing is placed: the layout puts it. Arrows are laid in the order written,
 * so from a decision the new node becomes its next exit - the first one is the
 * trunk, later ones go to the side. An unknown `fromId` adds the node alone.
 */
export function addNodeAfter(
  doc: AlgorithmDocModel,
  fromId: string,
  init: Omit<NewNode, "x" | "y"> = {},
): { doc: AlgorithmDocModel; id: string } {
  const added = addNode(doc, init);
  if (!doc.nodes.some((n) => n.id === fromId)) return added;
  return { doc: connect(added.doc, fromId, added.id), id: added.id };
}

export function patchNode(
  doc: AlgorithmDocModel,
  id: string,
  patch: Partial<AlgorithmNode>,
): AlgorithmDocModel {
  return {
    ...doc,
    // The id is the node's identity: a patch never changes it.
    nodes: doc.nodes.map((n) => (n.id === id ? { ...applyPatch(n, patch), id } : n)),
  };
}

/** Changes what a node is (its `^mark`). The id stays: the kind is not in it. */
export function setNodeKind(doc: AlgorithmDocModel, id: string, kind: NodeKind): AlgorithmDocModel {
  return patchNode(doc, id, { kind });
}

/** Removes a node with the arrows into and out of it and the stickies pinned to it. */
export function deleteNode(doc: AlgorithmDocModel, id: string): AlgorithmDocModel {
  return {
    ...doc,
    nodes: doc.nodes.filter((n) => n.id !== id),
    edges: doc.edges.filter((e) => e.from !== id && e.to !== id),
    stickies: doc.stickies.filter((s) => s.targetId !== id),
  };
}

/** Drops a node at a diagram point (its centre) after a drag. Only this node gets a `@`. */
export function moveNodeTo(
  doc: AlgorithmDocModel,
  id: string,
  cx: number,
  cy: number,
): AlgorithmDocModel {
  return patchNode(doc, id, { x: Math.round(cx), y: Math.round(cy) });
}

/** Moves a node by a step of the keyboard, from where it is drawn now (written as a `@`). */
export function nudgeNode(
  doc: AlgorithmDocModel,
  layout: AlgorithmLayout,
  id: string,
  dx: number,
  dy: number,
): AlgorithmDocModel {
  const laid = layout.byId.get(id);
  if (!laid) return doc;
  return moveNodeTo(doc, id, laid.cx + dx, laid.cy + dy);
}

/** "Auto-align": removes every `@`, handing all positions back to the layout. */
export function autoAlign(doc: AlgorithmDocModel): AlgorithmDocModel {
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      const { x: _x, y: _y, ...rest } = n;
      return rest;
    }),
  };
}

/** True when at least one node carries a position. */
export function hasManualPositions(doc: AlgorithmDocModel): boolean {
  return doc.nodes.some((n) => n.x !== undefined);
}

// ---- arrows -------------------------------------------------------------------

const newEdge = (from: string, to: string): AlgorithmEdge => ({ from, to });

/** Adds an arrow; the same model back when it would change nothing. */
export function connect(doc: AlgorithmDocModel, from: string, to: string): AlgorithmDocModel {
  const edges = connectEdges(doc.edges, from, to, newEdge, allowAnyConnection);
  return edges ? { ...doc, edges } : doc;
}

/** Moves one end of an arrow to another node; the same model back when nothing changes. */
export function reattach(
  doc: AlgorithmDocModel,
  edge: { from: string; to: string },
  end: "from" | "to",
  nodeId: string,
): AlgorithmDocModel {
  const edges = reattachEdge(doc.edges, edge, end, nodeId, allowAnyConnection);
  return edges ? { ...doc, edges } : doc;
}

/** Changes an arrow's label; an empty one (or `undefined`) removes it. */
export function setEdgeLabel(
  doc: AlgorithmDocModel,
  edge: { from: string; to: string },
  label: string | undefined,
): AlgorithmDocModel {
  const text = (label ?? "").trim();
  return {
    ...doc,
    edges: doc.edges.map((e) =>
      e.from === edge.from && e.to === edge.to
        ? applyPatch(e, { label: text === "" ? undefined : text })
        : e,
    ),
  };
}

export function deleteEdge(
  doc: AlgorithmDocModel,
  edge: { from: string; to: string },
): AlgorithmDocModel {
  return { ...doc, edges: doc.edges.filter((e) => !(e.from === edge.from && e.to === edge.to)) };
}
