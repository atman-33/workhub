import { type PointerEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Maximize, Scan, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { type View, actualSizeView, fitView, zoomAround } from "@/lib/docs/zoom";
import type { DocsFigure } from "@/types";

/** Zoom factor of one button press or one wheel notch. */
const STEP = 1.25;

/**
 * One figure — a mermaid diagram or an image — on a pan/zoom canvas (T-0279),
 * in a Docs viewer window.
 *
 * The wheel zooms around the cursor and a drag pans, the way a map or an image
 * viewer behaves; the figure opens fitted to the window. It stays fitted as
 * the window is resized until the user zooms or pans it themselves.
 *
 * A mermaid diagram is inlined as the SVG mermaid produced (already rendered
 * with `securityLevel: "strict"` in the tab); everything else — an image, a
 * PlantUML diagram from a server — is an `<img>`, which runs nothing.
 */
export function FigureViewer({ figure }: { figure: DocsFigure }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  // True until the user zooms or pans; while it is, a resize re-fits.
  const [fitted, setFitted] = useState(true);
  const drag = useRef<{ x: number; y: number; view: View } | null>(null);

  // A mermaid SVG sizes itself to its container (`width="100%"` and a
  // max-width), which on a canvas with no width means nothing useful. Pin it to
  // its own viewBox so it has a natural size to zoom from.
  //
  // Inserted here rather than with `dangerouslySetInnerHTML`: React re-applies
  // that on every render (each pan and zoom is one), which would put the
  // markup back as it came and undo the sizing below.
  const svgHost = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = svgHost.current;
    if (figure.type !== "svg" || !host) return;
    // Mermaid's own output, rendered with securityLevel "strict" in the tab.
    host.innerHTML = figure.content;
    const svg = host.querySelector("svg");
    if (!svg) return;
    const box = svg.viewBox?.baseVal;
    const rect = svg.getBoundingClientRect();
    const width = box && box.width > 0 ? box.width : rect.width;
    const height = box && box.height > 0 ? box.height : rect.height;
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.style.maxWidth = "none";
    setSize({ width, height });
  }, [figure]);

  const viewportSize = useCallback(() => {
    const el = viewport.current;
    return el ? { vw: el.clientWidth, vh: el.clientHeight } : { vw: 0, vh: 0 };
  }, []);

  const fit = useCallback(() => {
    if (!size) return;
    const { vw, vh } = viewportSize();
    setView(fitView(size.width, size.height, vw, vh));
    setFitted(true);
  }, [size, viewportSize]);

  const actualSize = useCallback(() => {
    if (!size) return;
    const { vw, vh } = viewportSize();
    setView(actualSizeView(size.width, size.height, vw, vh));
    setFitted(false);
  }, [size, viewportSize]);

  useEffect(() => {
    if (fitted) fit();
  }, [fit, fitted]);

  useEffect(() => {
    const el = viewport.current;
    if (!el || !fitted) return;
    const observer = new ResizeObserver(() => fit());
    observer.observe(el);
    return () => observer.disconnect();
  }, [fit, fitted]);

  const zoomBy = useCallback(
    (factor: number, px?: number, py?: number) => {
      const { vw, vh } = viewportSize();
      setView((v) => zoomAround(v, factor, px ?? vw / 2, py ?? vh / 2));
      setFitted(false);
    },
    [viewportSize],
  );

  // Native, non-passive: the wheel zooms, and must not also scroll.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomBy(e.deltaY < 0 ? STEP : 1 / STEP, e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, view };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) return;
    setView({
      ...start.view,
      x: start.view.x + e.clientX - start.x,
      y: start.view.y + e.clientY - start.y,
    });
    setFitted(false);
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b px-3 py-1.5">
        <span className="mr-1 min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {figure.title}
        </span>
        <Hint label="Zoom out (wheel)">
          <Button size="icon-sm" variant="ghost" aria-label="Zoom out" onClick={() => zoomBy(1 / STEP)}>
            <ZoomOut />
          </Button>
        </Hint>
        <span className="w-12 text-center text-[11px] tabular-nums text-muted-foreground">
          {Math.round(view.scale * 100)}%
        </span>
        <Hint label="Zoom in (wheel)">
          <Button size="icon-sm" variant="ghost" aria-label="Zoom in" onClick={() => zoomBy(STEP)}>
            <ZoomIn />
          </Button>
        </Hint>
        <Hint label="Fit to window">
          <Button size="icon-sm" variant="ghost" aria-label="Fit to window" onClick={fit}>
            <Maximize />
          </Button>
        </Hint>
        <Hint label="Actual size (100%)">
          <Button size="icon-sm" variant="ghost" aria-label="Actual size" onClick={actualSize}>
            <Scan />
          </Button>
        </Hint>
      </div>
      <div
        ref={viewport}
        className="relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden select-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => (fitted ? actualSize() : fit())}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            // Hidden until measured, so the figure does not flash at 100% in a
            // corner before it is fitted.
            visibility: size ? "visible" : "hidden",
          }}
        >
          {figure.type === "svg" ? (
            <div ref={svgHost} />
          ) : (
            <img
              src={figure.content}
              alt={figure.title}
              draggable={false}
              className="block max-w-none"
              onLoad={(e) =>
                setSize({
                  width: e.currentTarget.naturalWidth,
                  height: e.currentTarget.naturalHeight,
                })
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
