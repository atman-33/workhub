import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeRect, type MarqueeRect } from "@/lib/diagram/multi-select";
import { FREE_DRAG_THRESHOLD_PX } from "@/components/diagram/use-free-drag";

/**
 * Marquee (rectangle) selection on empty canvas (T-0716), shared by every kind.
 *
 * - starts only on a **left** press on the background (right-drag stays pan:
 *   `usePanDrag` owns button 2 and never sees this);
 * - a press that never travels is not a marquee: the release falls through to
 *   the canvas's background click (clear), which `consumeClick` lets the caller
 *   suppress only after a real marquee;
 * - with Shift held the caught ids join the selection, otherwise they replace
 *   it — the caller maps the rectangle to ids, so this hook never sees nodes.
 */
interface Options {
  /** Client (pointer event) coordinates to diagram coordinates. */
  toDiagram: (clientX: number, clientY: number) => { x: number; y: number };
  /** Current camera zoom: the threshold is in screen pixels. */
  zoom: number;
  /** A finished marquee: the normalized rectangle and whether Shift was held. */
  onMarquee: (rect: MarqueeRect, additive: boolean) => void;
  /** When true the gesture is ignored entirely (an AI edit holds the file). */
  disabled?: boolean;
}

export function useMarquee({ toDiagram, zoom, onMarquee, disabled }: Options) {
  const [rect, setRect] = useState<MarqueeRect | null>(null);
  const live = useRef({ toDiagram, zoom, onMarquee, disabled });
  live.current = { toDiagram, zoom, onMarquee, disabled };
  // The press being tracked; `active` turns true past the travel threshold.
  const press = useRef<{
    startClient: { x: number; y: number };
    start: { x: number; y: number };
    additive: boolean;
    active: boolean;
    current: MarqueeRect | null;
  } | null>(null);
  /** Set by a marquee release; the background click after it must not clear. */
  const suppressClick = useRef(false);

  /** True once after a marquee release: the canvas skips its clear-once. */
  const consumeClick = useCallback((): boolean => {
    if (!suppressClick.current) return false;
    suppressClick.current = false;
    return true;
  }, []);

  /** Begins tracking a press. The caller passes only background presses. */
  const onPointerDown = useCallback((e: { button: number; clientX: number; clientY: number; shiftKey: boolean }) => {
    if (live.current.disabled || e.button !== 0) return;
    const at = live.current.toDiagram(e.clientX, e.clientY);
    press.current = {
      startClient: { x: e.clientX, y: e.clientY },
      start: at,
      additive: e.shiftKey,
      active: false,
      current: null,
    };
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const p = press.current;
      if (!p) return;
      const travelled = Math.abs(e.clientX - p.startClient.x) + Math.abs(e.clientY - p.startClient.y);
      if (!p.active && travelled * live.current.zoom < FREE_DRAG_THRESHOLD_PX) return;
      p.active = true;
      const at = live.current.toDiagram(e.clientX, e.clientY);
      p.current = normalizeRect(p.start, at);
      setRect(p.current);
    };
    const onUp = () => {
      const p = press.current;
      press.current = null;
      if (!p?.active || !p.current) return;
      const finished = p.current;
      setRect(null);
      suppressClick.current = true;
      setTimeout(() => {
        suppressClick.current = false;
      }, 0);
      live.current.onMarquee(finished, p.additive);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  return { marquee: rect, onPointerDown, consumeClick };
}
