/**
 * Edits to an IFDAM document, as pure functions from model to model (T-0703).
 *
 * The view holds the undo stack and the debounced write; everything that
 * decides *what* an edit does lives here, so it can be tested without a DOM:
 * deleting a node takes its arrows and stickies with it, "add after" picks the
 * element that normally follows, a screen's items are added to, changed and
 * removed one line at a time and never regrouped. Any two different nodes may be
 * joined (`allowAnyConnection`).
 */
import { allowAnyConnection, connectEdges, reattachEdge } from "../node-edge";
import type { IfdamLayout } from "./layout";
import {
  nextNodeId,
  parseContinuation,
  type IfdamDocModel,
  type IfdamEdge,
  type IfdamNode,
  type NodeLine,
  type SectionKey,
} from "./parse";
import { DEFAULT_KIND, nextKindOf, type NodeKind } from "./symbols";

/** `patch` laid over `base`; a key set to `undefined` is removed. */
export function applyPatch<T extends object>(base: T, patch: Partial<T>): T {
  const next = { ...base, ...patch } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
  }
  return next as T;
}

function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").trim();
}

// ---- nodes --------------------------------------------------------------------

export interface NewNode {
  kind?: NodeKind;
  title?: string;
  /** Placement: the centre, absolute. Omit both for the layout to choose. */
  x?: number;
  y?: number;
  lines?: NodeLine[];
}

export function addNode(
  doc: IfdamDocModel,
  init: NewNode = {},
): { doc: IfdamDocModel; id: string } {
  const node: IfdamNode = {
    id: nextNodeId(doc.nodes),
    title: init.title ?? "",
    kind: init.kind ?? DEFAULT_KIND,
    ...(init.x !== undefined && init.y !== undefined
      ? { x: Math.round(init.x), y: Math.round(init.y) }
      : {}),
    lines: (init.lines ?? []).map((l) => ({ ...l })),
  };
  return { doc: { ...doc, nodes: [...doc.nodes, node] }, id: node.id };
}

/**
 * Adds a node after `fromId` and joins them with an arrow (the editor's `+`).
 * What it adds is what normally follows: a screen is followed by a trigger, a
 * trigger by a process, a process by a message, a message by a screen, a data
 * store by a process (`init.kind` overrides). Nothing is placed: the layout puts
 * it. An unknown `fromId` adds the node alone.
 */
export function addNodeAfter(
  doc: IfdamDocModel,
  fromId: string,
  init: Omit<NewNode, "x" | "y"> = {},
): { doc: IfdamDocModel; id: string } {
  const from = doc.nodes.find((n) => n.id === fromId);
  const added = addNode(doc, { ...init, kind: init.kind ?? (from ? nextKindOf(from.kind) : DEFAULT_KIND) });
  if (!from) return added;
  return { doc: connect(added.doc, fromId, added.id), id: added.id };
}

/**
 * What the lines of a node read as once its kind is `kind`. A screen's items
 * are the lines the parser would read as items; on any other node the same
 * lines are memo text (`show: x`), as they will be the next time the file is
 * read. Nothing is dropped either way.
 */
function linesFor(lines: NodeLine[], kind: NodeKind): NodeLine[] {
  return lines.map((line) => {
    if (kind === "screen") return line.key ? line : parseContinuation(line.text, "screen");
    return line.key ? { key: null, text: `${line.key}: ${line.text}` } : line;
  });
}

export function patchNode(
  doc: IfdamDocModel,
  id: string,
  patch: Partial<IfdamNode>,
): IfdamDocModel {
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      if (n.id !== id) return n;
      // The id is the node's identity: a patch never changes it.
      const next = { ...applyPatch(n, patch), id };
      return next.kind !== n.kind || patch.lines ? { ...next, lines: linesFor(next.lines, next.kind) } : next;
    }),
  };
}

/** Changes what a node is (its `^mark`). The id stays: the kind is not in it. */
export function setNodeKind(doc: IfdamDocModel, id: string, kind: NodeKind): IfdamDocModel {
  return patchNode(doc, id, { kind });
}

/** Removes a node with the arrows into and out of it and the stickies pinned to it. */
export function deleteNode(doc: IfdamDocModel, id: string): IfdamDocModel {
  return {
    ...doc,
    nodes: doc.nodes.filter((n) => n.id !== id),
    edges: doc.edges.filter((e) => e.from !== id && e.to !== id),
    stickies: doc.stickies.filter((s) => s.targetId !== id),
  };
}

/** Drops a node at a diagram point (its centre) after a drag. Only this node gets a `@`. */
export function moveNodeTo(
  doc: IfdamDocModel,
  id: string,
  cx: number,
  cy: number,
): IfdamDocModel {
  return patchNode(doc, id, { x: Math.round(cx), y: Math.round(cy) });
}

/** Moves a node by a step of the keyboard, from where it is drawn now (written as a `@`). */
export function nudgeNode(
  doc: IfdamDocModel,
  layout: IfdamLayout,
  id: string,
  dx: number,
  dy: number,
): IfdamDocModel {
  const laid = layout.byId.get(id);
  if (!laid) return doc;
  return moveNodeTo(doc, id, laid.cx + dx, laid.cy + dy);
}

/** "Auto-align": removes every `@`, handing all positions back to the layout. */
export function autoAlign(doc: IfdamDocModel): IfdamDocModel {
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      const { x: _x, y: _y, ...rest } = n;
      return rest;
    }),
  };
}

/** True when at least one node carries a position. */
export function hasManualPositions(doc: IfdamDocModel): boolean {
  return doc.nodes.some((n) => n.x !== undefined);
}

// ---- a screen's contents ------------------------------------------------------

function mapNode(
  doc: IfdamDocModel,
  id: string,
  change: (node: IfdamNode) => IfdamNode,
): IfdamDocModel {
  let touched = false;
  const nodes = doc.nodes.map((n) => {
    if (n.id !== id) return n;
    const next = change(n);
    if (next !== n) touched = true;
    return next;
  });
  return touched ? { ...doc, nodes } : doc;
}

/**
 * Adds an item to a section of a screen. It goes after the last item of the
 * same section, or at the end of the lines when the section has none yet; no
 * other line moves. Empty text, or a node that is not a screen, changes nothing.
 */
export function addSectionItem(
  doc: IfdamDocModel,
  id: string,
  key: SectionKey,
  text: string,
): IfdamDocModel {
  const item = oneLine(text);
  if (!item) return doc;
  return mapNode(doc, id, (node) => {
    if (node.kind !== "screen") return node;
    let at = -1;
    node.lines.forEach((l, i) => {
      if (l.key === key) at = i;
    });
    const lines = [...node.lines];
    lines.splice(at === -1 ? lines.length : at + 1, 0, { key, text: item });
    return { ...node, lines };
  });
}

/** Changes the `index`th item of a section (counted within that section). Empty text removes it. */
export function setSectionItem(
  doc: IfdamDocModel,
  id: string,
  key: SectionKey,
  index: number,
  text: string,
): IfdamDocModel {
  const item = oneLine(text);
  if (!item) return removeSectionItem(doc, id, key, index);
  return mapNode(doc, id, (node) => {
    const at = lineIndexOf(node, key, index);
    if (at === -1 || node.lines[at].text === item) return node;
    return { ...node, lines: node.lines.map((l, i) => (i === at ? { key, text: item } : l)) };
  });
}

/** Removes the `index`th item of a section. */
export function removeSectionItem(
  doc: IfdamDocModel,
  id: string,
  key: SectionKey,
  index: number,
): IfdamDocModel {
  return mapNode(doc, id, (node) => {
    const at = lineIndexOf(node, key, index);
    if (at === -1) return node;
    return { ...node, lines: node.lines.filter((_, i) => i !== at) };
  });
}

function lineIndexOf(node: IfdamNode, key: SectionKey, index: number): number {
  if (node.kind !== "screen" || index < 0) return -1;
  let seen = -1;
  for (let i = 0; i < node.lines.length; i++) {
    if (node.lines[i].key === key && ++seen === index) return i;
  }
  return -1;
}

/**
 * Replaces the node's memo (the hover text) with `text`, one line per line. On a
 * screen only the memo lines change - the items stay where they are, and the new
 * memo goes where the first old memo line was (at the end when there was none).
 * On any other node the whole body is memo, so all of its lines are replaced.
 */
export function setMemo(doc: IfdamDocModel, id: string, text: string): IfdamDocModel {
  const memo: NodeLine[] = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => ({ key: null, text: l }));
  return mapNode(doc, id, (node) => {
    if (node.kind !== "screen") return { ...node, lines: linesFor(memo, node.kind) };
    const first = node.lines.findIndex((l) => l.key === null);
    const items = node.lines.filter((l) => l.key !== null);
    const before = first === -1 ? items.length : node.lines.slice(0, first).filter((l) => l.key !== null).length;
    return { ...node, lines: [...items.slice(0, before), ...memo, ...items.slice(before)] };
  });
}

// ---- arrows -------------------------------------------------------------------

const newEdge = (from: string, to: string): IfdamEdge => ({ from, to });

/** Adds an arrow; the same model back when it would change nothing. */
export function connect(doc: IfdamDocModel, from: string, to: string): IfdamDocModel {
  const edges = connectEdges(doc.edges, from, to, newEdge, allowAnyConnection);
  return edges ? { ...doc, edges } : doc;
}

/** Moves one end of an arrow to another node; the same model back when nothing changes. */
export function reattach(
  doc: IfdamDocModel,
  edge: { from: string; to: string },
  end: "from" | "to",
  nodeId: string,
): IfdamDocModel {
  const edges = reattachEdge(doc.edges, edge, end, nodeId, allowAnyConnection);
  return edges ? { ...doc, edges } : doc;
}

/** Changes an arrow's label; an empty one (or `undefined`) removes it. */
export function setEdgeLabel(
  doc: IfdamDocModel,
  edge: { from: string; to: string },
  label: string | undefined,
): IfdamDocModel {
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
  doc: IfdamDocModel,
  edge: { from: string; to: string },
): IfdamDocModel {
  return { ...doc, edges: doc.edges.filter((e) => !(e.from === edge.from && e.to === edge.to)) };
}
