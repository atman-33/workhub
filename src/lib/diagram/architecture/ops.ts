/**
 * Edits to an architecture document, as pure functions from model to model.
 *
 * The view holds the undo stack and the debounced write; everything that
 * decides *what* an edit does lives here, so it can be tested without a DOM:
 * deleting a block takes its arrows and stickies with it, deleting a frame
 * leaves its members where they are, and so on. `->` claims its ordered pair
 * and `<->` the unordered one, so every edge operation looks through
 * `findEdge` first - the shared `connectEdges`/`reattachEdge` are directed
 * and are not used.
 */
import type { ArchitectureLayout } from "./layout";
import { frameRectOf } from "./layout";
import type { EdgePort } from "../node-edge";
import {
  findEdge,
  findFrame,
  nextFrameId,
  nextNodeId,
  sameEdge,
  type ArchitectureDocModel,
  type ArchitectureEdge,
  type ArchitectureFrame,
  type ArchitectureNode,
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

// ---- frames -------------------------------------------------------------------

export interface NewFrame {
  title?: string;
  color?: ArchitectureFrame["color"];
  note?: string;
}

export function addFrame(
  doc: ArchitectureDocModel,
  init: NewFrame = {},
): { doc: ArchitectureDocModel; id: string } {
  const frame: ArchitectureFrame = {
    id: nextFrameId(doc.frames),
    title: init.title ?? "",
    ...(init.color ? { color: init.color } : {}),
    ...(init.note ? { note: init.note } : {}),
  };
  return { doc: { ...doc, frames: [...doc.frames, frame] }, id: frame.id };
}

export function patchFrame(
  doc: ArchitectureDocModel,
  id: string,
  patch: Partial<ArchitectureFrame>,
): ArchitectureDocModel {
  return {
    ...doc,
    // The id is the frame's identity: a patch never changes it.
    frames: doc.frames.map((f) => (f.id === id ? { ...applyPatch(f, patch), id } : f)),
  };
}

/**
 * Removes a frame. Its members stay where they are, outside every frame; the
 * stickies pinned to the frame go with it. Removing an unknown frame changes
 * nothing.
 */
export function deleteFrame(doc: ArchitectureDocModel, id: string): ArchitectureDocModel {
  if (!findFrame(doc.frames, id)) return doc;
  return {
    ...doc,
    frames: doc.frames.filter((f) => f.id !== id),
    nodes: doc.nodes.map((n) => (n.frame === id ? withoutFrame(n) : n)),
    stickies: doc.stickies.filter((s) => s.targetId !== id),
  };
}

function withoutFrame(node: ArchitectureNode): ArchitectureNode {
  const { frame: _frame, ...rest } = node;
  return rest;
}

// ---- blocks -------------------------------------------------------------------

export interface NewNode {
  kind?: NodeKind;
  title?: string;
  /** The frame to sit in. Names no frame to sit outside every frame. */
  frame?: string;
  /** A hover memo. */
  note?: string;
  /** Placement: the centre, absolute. Omit both for the groups to choose. */
  x?: number;
  y?: number;
}

export function addNode(
  doc: ArchitectureDocModel,
  init: NewNode = {},
): { doc: ArchitectureDocModel; id: string } {
  const node: ArchitectureNode = {
    id: nextNodeId(doc.nodes),
    title: init.title ?? "",
    kind: init.kind ?? DEFAULT_KIND,
    ...(init.frame ? { frame: init.frame } : {}),
    ...(init.note ? { note: init.note } : {}),
    ...(init.x !== undefined && init.y !== undefined
      ? { x: Math.round(init.x), y: Math.round(init.y) }
      : {}),
  };
  return { doc: { ...doc, nodes: [...doc.nodes, node] }, id: node.id };
}

/**
 * Adds a block after `anchorId` - the editor's `+`: in the same frame, joined
 * to the anchor by a one-way arrow, and unplaced (the groups put it). With no
 * anchor to find the block is added alone.
 */
export function addNodeAfter(
  doc: ArchitectureDocModel,
  anchorId: string | undefined,
  init: Omit<NewNode, "x" | "y" | "frame"> = {},
): { doc: ArchitectureDocModel; id: string } {
  const anchor = doc.nodes.find((n) => n.id === anchorId);
  const added = addNode(doc, anchor?.frame ? { ...init, frame: anchor.frame } : init);
  if (!anchor) return added;
  return { doc: connect(added.doc, anchor.id, added.id), id: added.id };
}

export function patchNode(
  doc: ArchitectureDocModel,
  id: string,
  patch: Partial<ArchitectureNode>,
): ArchitectureDocModel {
  return {
    ...doc,
    // The id is the node's identity: a patch never changes it.
    nodes: doc.nodes.map((n) => (n.id === id ? { ...applyPatch(n, patch), id } : n)),
  };
}

/** Changes what a block is (its `^mark`). The id stays, and so does the note. */
export function setNodeKind(doc: ArchitectureDocModel, id: string, kind: NodeKind): ArchitectureDocModel {
  return patchNode(doc, id, { kind });
}

/** Moves a block into a frame, or outside every frame for `undefined`. */
export function setNodeFrame(
  doc: ArchitectureDocModel,
  id: string,
  frame: string | undefined,
): ArchitectureDocModel {
  return patchNode(doc, id, { frame });
}

/** Replaces a block's memo. Empty removes it. */
export function setNote(doc: ArchitectureDocModel, id: string, text: string): ArchitectureDocModel {
  const note = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
  return patchNode(doc, id, { note: note === "" ? undefined : note });
}

/** Removes a block with the arrows into and out of it and the stickies pinned to it. */
export function deleteNode(doc: ArchitectureDocModel, id: string): ArchitectureDocModel {
  return {
    ...doc,
    nodes: doc.nodes.filter((n) => n.id !== id),
    edges: doc.edges.filter((e) => e.from !== id && e.to !== id),
    stickies: doc.stickies.filter((s) => s.targetId !== id),
  };
}

/** Drops a block at a diagram point (its centre) after a drag. Only this block gets a `@`. */
export function moveNodeTo(
  doc: ArchitectureDocModel,
  id: string,
  cx: number,
  cy: number,
): ArchitectureDocModel {
  return patchNode(doc, id, { x: Math.round(cx), y: Math.round(cy) });
}

/** Moves a block by a step of the keyboard, from where it is drawn now (written as a `@`). */
export function nudgeNode(
  doc: ArchitectureDocModel,
  layout: ArchitectureLayout,
  id: string,
  dx: number,
  dy: number,
): ArchitectureDocModel {
  const laid = layout.byId.get(id);
  if (!laid) return doc;
  return moveNodeTo(doc, id, laid.cx + dx, laid.cy + dy);
}

/** "Auto-align": removes every `@`, handing all positions back to the groups. */
export function autoAlign(doc: ArchitectureDocModel): ArchitectureDocModel {
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      const { x: _x, y: _y, ...rest } = n;
      return rest;
    }),
  };
}

/** True when at least one block carries a position. */
export function hasManualPositions(doc: ArchitectureDocModel): boolean {
  return doc.nodes.some((n) => n.x !== undefined);
}

// ---- frames, by hand ------------------------------------------------------------

/**
 * Moves a frame by (`dx`, `dy`): every member's centre moves the same distance
 * and every member gets a `@`. The frame's own line never changes - a frame
 * has no position, so it follows its members. One call is one undo entry.
 */
export function moveFrame(
  doc: ArchitectureDocModel,
  layout: ArchitectureLayout,
  frameId: string,
  dx: number,
  dy: number,
): ArchitectureDocModel {
  const moved = new Set(
    doc.nodes.filter((n) => n.frame === frameId).map((n) => n.id),
  );
  if (moved.size === 0) return doc;
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      if (!moved.has(n.id)) return n;
      const laid = layout.byId.get(n.id);
      if (!laid) return n;
      return {
        ...n,
        x: Math.round(laid.cx + dx),
        y: Math.round(laid.cy + dy),
      };
    }),
  };
}

function rectContains(rect: { x: number; y: number; width: number; height: number }, cx: number, cy: number): boolean {
  return cx >= rect.x && cx <= rect.x + rect.width && cy >= rect.y && cy <= rect.y + rect.height;
}

/**
 * Drops a block at (`cx`, `cy`) after a drag: the block always moves there,
 * and its membership may change with it.
 *
 * - its centre lands in another frame's rectangle (drawn without the dragged
 *   block): it joins that frame;
 * - it leaves its own frame's rectangle (drawn without it): it sits outside
 *   every frame. A frame with no other member cannot be left this way;
 * - otherwise it stays where it was a member of.
 *
 * Only this block gets a `@` (or a new one). One call is one undo entry.
 */
export function reparentByDrop(
  doc: ArchitectureDocModel,
  layout: ArchitectureLayout,
  id: string,
  cx: number,
  cy: number,
): ArchitectureDocModel {
  const node = doc.nodes.find((n) => n.id === id);
  if (!node) return doc;
  const at = { x: Math.round(cx), y: Math.round(cy) };
  const rects = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (const frame of doc.frames) {
    const others = layout.nodes.filter((n) => n.frame === frame.id && n.id !== id);
    const rect = frameRectOf(others);
    if (rect) rects.set(frame.id, rect);
  }
  for (const frame of doc.frames) {
    if (frame.id === node.frame) continue;
    const rect = rects.get(frame.id);
    if (rect && rectContains(rect, at.x, at.y)) {
      return patchNode(moveNodeTo(doc, id, at.x, at.y), id, { frame: frame.id });
    }
  }
  const own = node.frame !== undefined ? rects.get(node.frame) : undefined;
  if (node.frame !== undefined && own && !rectContains(own, at.x, at.y)) {
    return patchNode(moveNodeTo(doc, id, at.x, at.y), id, { frame: undefined });
  }
  return moveNodeTo(doc, id, at.x, at.y);
}

// ---- arrows -------------------------------------------------------------------

/**
 * Adds an arrow from `from` to `to` (`bidi` for `<->`); the same model back
 * when the pair is already joined, or it is a block to itself, or an end does
 * not exist. Pins the ends when `ports` names them.
 */
export function connect(
  doc: ArchitectureDocModel,
  from: string,
  to: string,
  bidi = false,
  ports: { fromPort?: EdgePort; toPort?: EdgePort } = {},
): ArchitectureDocModel {
  if (from === to || findEdge(doc.edges, { from, to, bidi })) return doc;
  const ids = new Set(doc.nodes.map((n) => n.id));
  if (!ids.has(from) || !ids.has(to)) return doc;
  return {
    ...doc,
    edges: [
      ...doc.edges,
      {
        from,
        to,
        bidi,
        ...(ports.fromPort ? { fromPort: ports.fromPort } : {}),
        ...(ports.toPort ? { toPort: ports.toPort } : {}),
      },
    ],
  };
}

/**
 * Moves one end of an arrow to another block; the same model back when nothing
 * changes. When the new pair is already joined the moved arrow merges into it:
 * the existing one stays, taking the moved one's label only if it has none
 * (and keeping its own pins). `port` pins the moved end anew (`null` clears it
 * back to automatic); without one the end keeps the pin it had.
 */
export function reattach(
  doc: ArchitectureDocModel,
  edge: { from: string; to: string; bidi: boolean },
  end: "from" | "to",
  nodeId: string,
  port?: EdgePort | null,
): ArchitectureDocModel {
  const current = findEdge(doc.edges, edge);
  if (!current) return doc;
  const from = end === "from" ? nodeId : current.from;
  const to = end === "to" ? nodeId : current.to;
  if (from === current.from && to === current.to) {
    if (port === undefined) return doc;
    const had = end === "from" ? current.fromPort : current.toPort;
    const same =
      port === null
        ? had === undefined
        : had?.side === port.side && (had.at ?? 0.5) === (port.at ?? 0.5);
    if (same) return doc;
  }
  if (from === to) return doc;
  const ids = new Set(doc.nodes.map((n) => n.id));
  if (!ids.has(from) || !ids.has(to)) return doc;
  const twin = doc.edges.find(
    (e) => e !== current && sameEdge(e, { from, to, bidi: current.bidi }),
  );
  if (twin) {
    return {
      ...doc,
      edges: doc.edges
        .filter((e) => e !== current)
        .map((e) => (e === twin && !e.label && current.label ? { ...e, label: current.label } : e)),
    };
  }
  return {
    ...doc,
    edges: doc.edges.map((e) => {
      if (e !== current) return e;
      const next = { ...e, from, to };
      if (port !== undefined) {
        if (end === "from") {
          if (port === null) delete next.fromPort;
          else next.fromPort = port;
        } else {
          if (port === null) delete next.toPort;
          else next.toPort = port;
        }
      }
      return next;
    }),
  };
}

function patchEdge(
  doc: ArchitectureDocModel,
  edge: { from: string; to: string; bidi: boolean },
  patch: Partial<ArchitectureEdge>,
): ArchitectureDocModel {
  const current = findEdge(doc.edges, edge);
  if (!current) return doc;
  return { ...doc, edges: doc.edges.map((e) => (e === current ? applyPatch(e, patch) : e)) };
}

/** Changes an arrow's label; an empty one (or `undefined`) removes it. */
export function setEdgeLabel(
  doc: ArchitectureDocModel,
  edge: { from: string; to: string; bidi: boolean },
  label: string | undefined,
): ArchitectureDocModel {
  const text = (label ?? "").trim();
  return patchEdge(doc, edge, { label: text === "" ? undefined : text });
}

/** Turns a one-way arrow into a two-way one and back. */
export function setEdgeBidi(
  doc: ArchitectureDocModel,
  edge: { from: string; to: string; bidi: boolean },
  bidi: boolean,
): ArchitectureDocModel {
  const current = findEdge(doc.edges, edge);
  if (!current) return doc;
  if (current.bidi === bidi) return doc;
  // A `<->` for an already-joined pair would be a second line for it.
  if (bidi && findEdge(doc.edges.filter((e) => e !== current), { ...edge, bidi })) return doc;
  return patchEdge(doc, edge, { bidi });
}

/** Swaps the two ends, so a one-way arrow points the other way. The pins travel
 * with their ends. A `<->` reads the same either way round, so reversing one
 * changes nothing. */
export function reverseEdge(
  doc: ArchitectureDocModel,
  edge: { from: string; to: string; bidi: boolean },
): ArchitectureDocModel {
  const current = findEdge(doc.edges, edge);
  if (!current || current.bidi) return doc;
  return patchEdge(doc, edge, {
    from: current.to,
    to: current.from,
    fromPort: current.toPort,
    toPort: current.fromPort,
  });
}

export function deleteEdge(
  doc: ArchitectureDocModel,
  edge: { from: string; to: string; bidi: boolean },
): ArchitectureDocModel {
  const current = findEdge(doc.edges, edge);
  if (!current) return doc;
  return { ...doc, edges: doc.edges.filter((e) => e !== current) };
}
