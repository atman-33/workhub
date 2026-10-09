import { useCallback, useEffect, useRef, useState } from "react";
import { usePanDrag, type PanDrag } from "@/components/schedule/use-pan-drag";
import {
  fitCamera,
  toDiagramPoint,
  zoomAt,
  type Camera,
} from "@/lib/diagram/camera";
import type { Box } from "@/lib/diagram/sticky-layout";

/**
 * The camera of a diagram canvas: pan, zoom and fit, shared by every kind.
 *
 * - **wheel zooms** toward the pointer (0.2 to 2.5), so zooming in on a part
 *   does not also require panning it back into view;
 * - **right-drag pans** (`usePanDrag`), and a right button that stays put is
 *   still a context menu;
 * - **fit** frames `bounds` without ever zooming in, and is asked for by
 *   bumping `fitToken`.
 *
 * The camera is view state: it is never written to the note.
 */
export interface CameraView {
  /** Attach to the canvas wrapper: it is measured, and the wheel is bound to it. */
  wrapRef: React.RefObject<HTMLDivElement | null>;
  camera: Camera;
  setCamera: React.Dispatch<React.SetStateAction<Camera>>;
  /** The wrapper's size, tracked rather than read on demand. */
  size: { width: number; height: number };
  panDrag: PanDrag;
  /** Client (pointer event) coordinates to diagram coordinates. */
  toDiagram: (clientX: number, clientY: number) => { x: number; y: number };
}

interface Options {
  /** What a fit frames; `null` when there is nothing to frame yet. */
  bounds: Box | null;
  /** Bumped by the view to re-fit (a new note, or the Fit button). */
  fitToken: number;
}

export function useCamera({ bounds, fitToken }: Options): CameraView {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  /**
   * The wrapper's own size, tracked rather than read on demand.
   *
   * The app shell keeps every tab mounted and hides the inactive ones, so on
   * first mount this element measures 0x0 and any fit computed then is
   * meaningless. Watching the box means the first fit happens when the tab is
   * actually shown, and again whenever the window or the side panel resizes it.
   */
  const [size, setSize] = useState({ width: 0, height: 0 });
  /** A fit was asked for and has not been satisfiable yet (no size, no content). */
  const pendingFit = useRef(true);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fit = useCallback((): boolean => {
    if (!bounds) return false;
    const next = fitCamera(bounds, size.width, size.height);
    if (!next) return false;
    setCamera(next);
    return true;
  }, [bounds, size]);

  // The view asks for a fit by bumping the token; it is recorded rather than
  // acted on, because the request usually arrives one render before the layout
  // and the size are both known.
  useEffect(() => {
    pendingFit.current = true;
  }, [fitToken]);

  // Satisfy a pending request as soon as it can be satisfied. Deliberately not
  // a fit on every layout change: adding an element while zoomed in must not
  // yank the camera away from what the user is looking at.
  useEffect(() => {
    if (!pendingFit.current) return;
    if (fit()) pendingFit.current = false;
    // `fitToken` is a dependency as well as the trigger above: pressing Fit
    // when neither the layout nor the size has changed leaves `fit` with the
    // same identity, and the request would never be acted on.
  }, [fit, fitToken]);

  const pan = useCallback((dx: number, dy: number) => {
    setCamera((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
  }, []);
  const panDrag = usePanDrag({ onPan: pan });

  // Registered by hand and non-passively: React attaches `wheel` passively at
  // the root, so a JSX `onWheel` cannot `preventDefault` - and without that,
  // Ctrl+wheel would zoom the whole WebView on top of zooming the diagram. The
  // canvas has nothing of its own to scroll, so it takes the plain wheel too
  // (`.claude/rules/ui-conventions.md`).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      setCamera((c) => zoomAt(c, px, py, e.deltaY));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const toDiagram = (clientX: number, clientY: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return toDiagramPoint(camera, clientX - rect.left, clientY - rect.top);
  };

  return { wrapRef, camera, setCamera, size, panDrag, toDiagram };
}
