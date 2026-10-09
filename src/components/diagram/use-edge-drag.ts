import { useCallback, useEffect, useRef, useState } from "react";
import type { Point } from "@/lib/diagram/node-edge";

/**
 * The gesture that draws and re-routes arrows between nodes.
 *
 * - **create**: press a handle on a node and drag to another node;
 * - **reattach**: press an end handle of a selected arrow and drag that end to
 *   another node (the other end stays where it is).
 *
 * While it runs, `drag.pointer` is where the loose end is and `drag.overId` the
 * node under it (null over empty canvas); the caller draws the rubber band.
 * On release over a node `onDrop` is called once; released over nothing, or
 * pressed and let go without moving, nothing happens - a stray click on a
 * handle must never change the file.
 */
export interface EdgeDragState {
  mode: "create" | "reattach";
  /** The node the arrow keeps: the source when creating, the far end when re-attaching. */
  anchorId: string;
  /** The arrow being re-attached, and which of its ends is held. */
  edge?: { from: string; to: string };
  end?: "from" | "to";
  /** Where the loose end is, in diagram coordinates. */
  pointer: Point;
  /** The node under the pointer that may take the arrow, else null. */
  overId: string | null;
  /** True once the pointer has left the start. */
  moved: boolean;
}

interface Options {
  /** Client (pointer event) coordinates to diagram coordinates. */
  toDiagram: (clientX: number, clientY: number) => Point;
  /** The node under a diagram point, or null. */
  nodeAt: (p: Point) => string | null;
  /** Whether an arrow may join these two nodes; a refused target is not highlighted or accepted. */
  canJoin: (drag: EdgeDragState, overId: string) => boolean;
  /** Called once, on release over an acceptable node. */
  onDrop: (drag: EdgeDragState, overId: string) => void;
}

export function useEdgeDrag({ toDiagram, nodeAt, canJoin, onDrop }: Options) {
  const [drag, setDrag] = useState<EdgeDragState | null>(null);
  const live = useRef({ toDiagram, nodeAt, canJoin, onDrop });
  live.current = { toDiagram, nodeAt, canJoin, onDrop };
  const state = useRef<EdgeDragState | null>(null);
  const running = drag !== null;

  const begin = useCallback(
    (e: { clientX: number; clientY: number }, seed: Omit<EdgeDragState, "pointer" | "overId" | "moved">) => {
      const next: EdgeDragState = {
        ...seed,
        pointer: live.current.toDiagram(e.clientX, e.clientY),
        overId: null,
        moved: false,
      };
      state.current = next;
      setDrag(next);
    },
    [],
  );

  const startCreate = useCallback(
    (e: { clientX: number; clientY: number }, fromId: string) =>
      begin(e, { mode: "create", anchorId: fromId }),
    [begin],
  );

  const startReattach = useCallback(
    (
      e: { clientX: number; clientY: number },
      edge: { from: string; to: string },
      end: "from" | "to",
    ) => begin(e, { mode: "reattach", anchorId: end === "from" ? edge.to : edge.from, edge, end }),
    [begin],
  );

  useEffect(() => {
    if (!running) return;
    const onMove = (e: PointerEvent) => {
      const d = state.current;
      if (!d) return;
      const pointer = live.current.toDiagram(e.clientX, e.clientY);
      const hit = live.current.nodeAt(pointer);
      const overId = hit && live.current.canJoin(d, hit) ? hit : null;
      const next = { ...d, pointer, overId, moved: true };
      state.current = next;
      setDrag(next);
    };
    const onUp = () => {
      const d = state.current;
      state.current = null;
      setDrag(null);
      if (d?.moved && d.overId) live.current.onDrop(d, d.overId);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      state.current = null;
      setDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, [running]);

  return { drag, startCreate, startReattach };
}
