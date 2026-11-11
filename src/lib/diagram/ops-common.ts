/**
 * The edits every node/edge kind's `ops.ts` repeated line for line: patching an
 * object, and the pair-keyed edge operations of the kinds whose edges are
 * ordered (`from` -> `to`: flow, pfd, algorithm, ifdam).
 *
 * Kinds whose edge identity is not the ordered pair (usecase: either order,
 * architecture: decided by `bidi`) keep their own finders and do not use the
 * edge helpers here; each `ops.ts` re-exports `applyPatch` so its callers and
 * tests keep importing it from there.
 */

/** `patch` laid over `base`; a key set to `undefined` is removed. */
export function applyPatch<T extends object>(base: T, patch: Partial<T>): T {
  const next = { ...base, ...patch } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
  }
  return next as T;
}

interface Ends {
  from: string;
  to: string;
}

/** Lays `patch` over the arrow from `edge.from` to `edge.to` (ordered pair); the rest stay as they are. */
export function patchOrderedEdge<D extends { edges: Ends[] }>(
  doc: D,
  edge: Ends,
  patch: Partial<D["edges"][number]>,
): D {
  return {
    ...doc,
    edges: doc.edges.map((e) => (e.from === edge.from && e.to === edge.to ? applyPatch(e, patch) : e)),
  };
}

/** Removes the arrow from `edge.from` to `edge.to` (ordered pair). */
export function deleteOrderedEdge<D extends { edges: Ends[] }>(doc: D, edge: Ends): D {
  return { ...doc, edges: doc.edges.filter((e) => !(e.from === edge.from && e.to === edge.to)) };
}

/** Removes a node with the arrows into and out of it and the stickies pinned to it. */
export function deleteNodeWithEdges<
  D extends {
    nodes: { id: string }[];
    edges: Ends[];
    stickies: { targetId?: string }[];
  },
>(doc: D, id: string): D {
  return {
    ...doc,
    nodes: doc.nodes.filter((n) => n.id !== id),
    edges: doc.edges.filter((e) => e.from !== id && e.to !== id),
    stickies: doc.stickies.filter((s) => s.targetId !== id),
  };
}
