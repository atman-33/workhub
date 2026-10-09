import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Dragging a freely placed element (a 2x2 item, a sticky).
 *
 * A press that never travels is a click, not a drag: the gesture only becomes
 * one once the pointer has moved `threshold` screen pixels, the same
 * arbitration `usePanDrag` makes for the right button. While it is active the
 * caller draws the element at `drag.x/y` (or offset by `drag.dx/dy`); the file
 * is written once, from `onEnd`, on release - each commit is a file write and
 * an undo entry, and a drag would otherwise fill the undo stack with a hundred
 * intermediate positions.
 */
export interface FreeDragState {
  id: string;
  /** Where the press landed, in diagram coordinates. */
  startX: number;
  startY: number;
  /** Where the pointer is now. */
  x: number;
  y: number;
  /** Travel since the press, in diagram coordinates. */
  dx: number;
  dy: number;
  /** False until the press has travelled far enough to be a drag. */
  active: boolean;
}

interface Options {
  /** Client (pointer event) coordinates to diagram coordinates. */
  toDiagram: (clientX: number, clientY: number) => { x: number; y: number };
  /** Current camera zoom: the threshold is in screen pixels. */
  zoom: number;
  /** Called once, on release, for a press that became a drag. */
  onEnd: (drag: FreeDragState) => void;
  /** Screen pixels of travel before a press becomes a drag. */
  threshold?: number;
}

export const FREE_DRAG_THRESHOLD_PX = 4;

export function useFreeDrag({
  toDiagram,
  zoom,
  onEnd,
  threshold = FREE_DRAG_THRESHOLD_PX,
}: Options) {
  const [drag, setDrag] = useState<FreeDragState | null>(null);
  // The latest of everything the window listeners read, so they are bound once
  // per gesture instead of once per render.
  const live = useRef({ toDiagram, zoom, onEnd, threshold });
  live.current = { toDiagram, zoom, onEnd, threshold };
  const state = useRef<FreeDragState | null>(null);
  const running = drag !== null;

  /** Begins tracking a press. The caller decides whether it may (locked, editing). */
  const start = useCallback((e: { clientX: number; clientY: number }, id: string) => {
    const at = live.current.toDiagram(e.clientX, e.clientY);
    const next: FreeDragState = {
      id,
      startX: at.x,
      startY: at.y,
      x: at.x,
      y: at.y,
      dx: 0,
      dy: 0,
      active: false,
    };
    state.current = next;
    setDrag(next);
  }, []);

  useEffect(() => {
    if (!running) return;
    const onMove = (e: PointerEvent) => {
      const d = state.current;
      if (!d) return;
      const at = live.current.toDiagram(e.clientX, e.clientY);
      const dx = at.x - d.startX;
      const dy = at.y - d.startY;
      const active =
        d.active || (Math.abs(dx) + Math.abs(dy)) * live.current.zoom >= live.current.threshold;
      const next = { ...d, x: at.x, y: at.y, dx, dy, active };
      state.current = next;
      setDrag(next);
    };
    const onUp = () => {
      const d = state.current;
      state.current = null;
      setDrag(null);
      if (d?.active) live.current.onEnd(d);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [running]);

  return { drag, start };
}
