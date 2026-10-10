/**
 * Edits to a use case document, as pure functions from model to model.
 *
 * The view holds the undo stack and the debounced write; everything that
 * decides *what* an edit does lives here, so it can be tested without a DOM:
 * deleting a node takes its lines and stickies with it, "add linked" joins the
 * new node to a system, and so on. Any two different nodes may be joined, with
 * one exception: **a pair has one line, whichever way round** (`A -- B` and
 * `B -- A` are the same relation), so every edge operation looks for the pair
 * in both orders first - the shared `connectEdges`/`reattachEdge` are directed
 * and are not used.
 */
import type { UsecaseLayout } from "./layout";
import {
  actionsOf,
  findEdge,
  nextNodeId,
  samePair,
  type UsecaseDocModel,
  type UsecaseEdge,
  type UsecaseNode,
} from "./parse";
import { DEFAULT_KIND, symbolOfKind, type NodeKind } from "./symbols";

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
  /** A person's actions (one per line) or a hover memo. */
  note?: string;
  /** Placement: the centre, absolute. Omit both for the ring to choose. */
  x?: number;
  y?: number;
}

export function addNode(
  doc: UsecaseDocModel,
  init: NewNode = {},
): { doc: UsecaseDocModel; id: string } {
  const node: UsecaseNode = {
    id: nextNodeId(doc.nodes),
    title: init.title ?? "",
    kind: init.kind ?? DEFAULT_KIND,
    ...(init.note ? { note: init.note } : {}),
    ...(init.x !== undefined && init.y !== undefined
      ? { x: Math.round(init.x), y: Math.round(init.y) }
      : {}),
  };
  return { doc: { ...doc, nodes: [...doc.nodes, node] }, id: node.id };
}

/**
 * Adds a node and joins it (a line, no arrow) to `anchorId` - the editor's `+`.
 * `anchorId` defaults to the first system. A person is written as the line's
 * first end (`person -- system`), anything else as its second (`system -- ext`).
 * Nothing is placed: the ring puts it. With no anchor to find the node is added alone.
 */
export function addNodeLinked(
  doc: UsecaseDocModel,
  anchorId: string | undefined,
  init: Omit<NewNode, "x" | "y"> = {},
): { doc: UsecaseDocModel; id: string } {
  const added = addNode(doc, init);
  const anchor =
    doc.nodes.find((n) => n.id === anchorId) ??
    doc.nodes.find((n) => symbolOfKind(n.kind).centre);
  if (!anchor) return added;
  const person = symbolOfKind(init.kind ?? DEFAULT_KIND).bubble;
  return {
    doc: person ? connect(added.doc, added.id, anchor.id) : connect(added.doc, anchor.id, added.id),
    id: added.id,
  };
}

export function patchNode(
  doc: UsecaseDocModel,
  id: string,
  patch: Partial<UsecaseNode>,
): UsecaseDocModel {
  return {
    ...doc,
    // The id is the node's identity: a patch never changes it.
    nodes: doc.nodes.map((n) => (n.id === id ? { ...applyPatch(n, patch), id } : n)),
  };
}

/** Changes what a node is (its `^mark`). The id stays: the kind is not in it, and
 * the note stays too (a person's actions become a hover memo, and back). */
export function setNodeKind(doc: UsecaseDocModel, id: string, kind: NodeKind): UsecaseDocModel {
  return patchNode(doc, id, { kind });
}

/** Replaces a node's note: a person's actions, one per line, or a memo. Empty removes it. */
export function setNote(doc: UsecaseDocModel, id: string, text: string): UsecaseDocModel {
  const note = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
  return patchNode(doc, id, { note: note === "" ? undefined : note });
}

/** Removes a node with the lines into and out of it and the stickies pinned to it. */
export function deleteNode(doc: UsecaseDocModel, id: string): UsecaseDocModel {
  return {
    ...doc,
    nodes: doc.nodes.filter((n) => n.id !== id),
    edges: doc.edges.filter((e) => e.from !== id && e.to !== id),
    stickies: doc.stickies.filter((s) => s.targetId !== id),
  };
}

/** Drops a node at a diagram point (its centre) after a drag. Only this node gets a `@`;
 * its bubble follows. */
export function moveNodeTo(
  doc: UsecaseDocModel,
  id: string,
  cx: number,
  cy: number,
): UsecaseDocModel {
  return patchNode(doc, id, { x: Math.round(cx), y: Math.round(cy) });
}

/** Moves a node by a step of the keyboard, from where it is drawn now (written as a `@`). */
export function nudgeNode(
  doc: UsecaseDocModel,
  layout: UsecaseLayout,
  id: string,
  dx: number,
  dy: number,
): UsecaseDocModel {
  const laid = layout.byId.get(id);
  if (!laid) return doc;
  return moveNodeTo(doc, id, laid.cx + dx, laid.cy + dy);
}

/** "Auto-align": removes every `@`, handing all positions back to the ring. */
export function autoAlign(doc: UsecaseDocModel): UsecaseDocModel {
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      const { x: _x, y: _y, ...rest } = n;
      return rest;
    }),
  };
}

/** True when at least one node carries a position. */
export function hasManualPositions(doc: UsecaseDocModel): boolean {
  return doc.nodes.some((n) => n.x !== undefined);
}

// ---- lines --------------------------------------------------------------------

/** Adds a line (`arrow` false) or an arrow from `from` to `to`; the same model back
 * when the pair is already joined in either direction, or it is a node to itself,
 * or an end does not exist. */
export function connect(
  doc: UsecaseDocModel,
  from: string,
  to: string,
  arrow = false,
): UsecaseDocModel {
  if (from === to || findEdge(doc.edges, { from, to })) return doc;
  const ids = new Set(doc.nodes.map((n) => n.id));
  if (!ids.has(from) || !ids.has(to)) return doc;
  return { ...doc, edges: [...doc.edges, { from, to, arrow }] };
}

/**
 * Moves one end of a line to another node; the same model back when nothing
 * changes. When the new pair is already joined (either way round) the moved
 * line merges into it: the existing one stays, taking the moved one's label
 * only if it has none.
 */
export function reattach(
  doc: UsecaseDocModel,
  edge: { from: string; to: string },
  end: "from" | "to",
  nodeId: string,
): UsecaseDocModel {
  const current = findEdge(doc.edges, edge);
  if (!current) return doc;
  const from = end === "from" ? nodeId : current.from;
  const to = end === "to" ? nodeId : current.to;
  if (from === current.from && to === current.to) return doc;
  if (from === to) return doc;
  const twin = doc.edges.find((e) => e !== current && samePair(e, { from, to }));
  if (twin) {
    return {
      ...doc,
      edges: doc.edges
        .filter((e) => e !== current)
        .map((e) => (e === twin && !e.label && current.label ? { ...e, label: current.label } : e)),
    };
  }
  return { ...doc, edges: doc.edges.map((e) => (e === current ? { ...e, from, to } : e)) };
}

function patchEdge(
  doc: UsecaseDocModel,
  edge: { from: string; to: string },
  patch: Partial<UsecaseEdge>,
): UsecaseDocModel {
  const current = findEdge(doc.edges, edge);
  if (!current) return doc;
  return { ...doc, edges: doc.edges.map((e) => (e === current ? applyPatch(e, patch) : e)) };
}

/** Changes a line's label; an empty one (or `undefined`) removes it. */
export function setEdgeLabel(
  doc: UsecaseDocModel,
  edge: { from: string; to: string },
  label: string | undefined,
): UsecaseDocModel {
  const text = (label ?? "").trim();
  return patchEdge(doc, edge, { label: text === "" ? undefined : text });
}

/** Turns the arrowhead (`->`) on or off. */
export function setEdgeArrow(
  doc: UsecaseDocModel,
  edge: { from: string; to: string },
  arrow: boolean,
): UsecaseDocModel {
  return patchEdge(doc, edge, { arrow });
}

/** Swaps the two ends, so an arrow points the other way. */
export function reverseEdge(
  doc: UsecaseDocModel,
  edge: { from: string; to: string },
): UsecaseDocModel {
  const current = findEdge(doc.edges, edge);
  if (!current) return doc;
  return patchEdge(doc, edge, { from: current.to, to: current.from });
}

export function deleteEdge(
  doc: UsecaseDocModel,
  edge: { from: string; to: string },
): UsecaseDocModel {
  const current = findEdge(doc.edges, edge);
  if (!current) return doc;
  return { ...doc, edges: doc.edges.filter((e) => e !== current) };
}

// ---- a person's actions ---------------------------------------------------------

/** Appends one action (a line of the note). Blank text changes nothing. */
export function addAction(doc: UsecaseDocModel, id: string, text: string): UsecaseDocModel {
  const item = text.replace(/\s+/g, " ").trim();
  const node = doc.nodes.find((n) => n.id === id);
  if (!node || !item) return doc;
  return setNote(doc, id, [...actionsOf(node), item].join("\n"));
}

/**
 * Replaces the action at `index` (counted the way `actionsOf` lists them); blank
 * text deletes it. An index out of range or an unchanged text changes nothing.
 */
export function setAction(doc: UsecaseDocModel, id: string, index: number, text: string): UsecaseDocModel {
  const node = doc.nodes.find((n) => n.id === id);
  if (!node) return doc;
  const items = actionsOf(node);
  if (index < 0 || index >= items.length) return doc;
  const item = text.replace(/\s+/g, " ").trim();
  if (item === items[index]) return doc;
  if (item) items[index] = item;
  else items.splice(index, 1);
  return setNote(doc, id, items.join("\n"));
}
