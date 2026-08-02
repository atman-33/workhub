import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Right-button drag that pans the displayed window (T-0111).
 *
 * Both schedule modes already spend the right button on a context menu (add an
 * element, toggle a non-working day), so the gesture has to be arbitrated
 * rather than simply taken. The rule is the one map, whiteboard and 3D tools
 * settled on: a right button that **stays put** is a menu, a right button that
 * **travels** is a hand. The threshold below is what separates them, and once
 * a drag has started this hook eats that gesture's `contextmenu` so the menu
 * does not appear on release.
 *
 * Panning is view state — it moves which dates are drawn and never touches the
 * note — so there is nothing here to save, undo, or guard against a concurrent
 * edit. That is what makes it safe to fire on every pointer move.
 *
 * The caller supplies `onPan`, which receives the travel **since the last
 * call** in pixels. Each mode converts that to dates itself, because the
 * conversion is the part that differs: the timeline pans horizontally in days
 * (a continuous axis), the calendar vertically in whole weeks (its weekday
 * columns must not shift).
 */

/** Travel, in px, before a press becomes a drag. Small enough that a
 * deliberate drag starts immediately, large enough that the hand shake in a
 * right-click never eats the menu. */
const DRAG_THRESHOLD_PX = 4;

interface Options {
  /**
   * Called with the movement since the previous call, in px. Return value is
   * ignored; the callback applies whatever window change it represents.
   */
  onPan: (deltaX: number, deltaY: number) => void;
  /** When true the gesture is ignored entirely (an AI edit holds the file). */
  disabled?: boolean;
}

/**
 * Handlers to spread onto the **root** of a grid. Both belong on the root
 * rather than on the cells: a pan starts anywhere, and the suppression has to
 * happen in the capture phase — the context menu's own trigger sits further
 * down the tree, so by the time the event bubbled back up the menu would
 * already be opening.
 */
export interface PanDrag {
  onPointerDown: (e: React.PointerEvent) => void;
  /** Suppresses the menu for a gesture that turned into a pan — and only that
   * gesture. Capture phase, so it runs before the trigger below it. */
  onContextMenuCapture: (e: React.MouseEvent) => void;
  /** True while a pan is in progress, for the cursor. */
  panning: boolean;
}

export function usePanDrag({ onPan, disabled }: Options): PanDrag {
  const [panning, setPanning] = useState(false);
  /** Where the press landed and where the pointer was last seen. Null when no
   * right button is down. */
  const origin = useRef<{ x: number; y: number } | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  /** Set once the press has travelled far enough to be a drag; read by the
   * context-menu handler, then cleared. */
  const dragged = useRef(false);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled || e.button !== 2) return;
      origin.current = { x: e.clientX, y: e.clientY };
      last.current = { x: e.clientX, y: e.clientY };
      dragged.current = false;
    },
    [disabled],
  );

  // Tracked on the window rather than the element: a pan routinely leaves the
  // grid it started on, and the release often happens outside it.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const from = origin.current;
      const prev = last.current;
      if (!from || !prev) return;

      if (!dragged.current) {
        const travelled =
          Math.abs(e.clientX - from.x) + Math.abs(e.clientY - from.y) >= DRAG_THRESHOLD_PX;
        if (!travelled) return;
        dragged.current = true;
        setPanning(true);
      }

      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      last.current = { x: e.clientX, y: e.clientY };
      if (dx || dy) onPan(dx, dy);
    };

    const onUp = (e: PointerEvent) => {
      if (e.button !== 2) return;
      origin.current = null;
      last.current = null;
      setPanning(false);
      // `dragged` is deliberately *not* cleared here: on Windows the
      // `contextmenu` event arrives after the release, and it is the handler
      // below that clears the flag once it has decided what to do with it.
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [onPan]);

  const onContextMenuCapture = useCallback((e: React.MouseEvent) => {
    if (!dragged.current) return;
    // This gesture was a pan; the menu it would otherwise open belongs to a
    // press the user never made.
    dragged.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return { onPointerDown, onContextMenuCapture, panning };
}
