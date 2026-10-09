import type { ReactNode } from "react";
import { Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import type { CameraView } from "@/components/diagram/use-camera";
import { cn } from "@/lib/utils";

/**
 * The frame every diagram canvas draws into: an SVG sized to its wrapper, a
 * `<g>` carrying the camera transform, and the zoom percentage.
 *
 * Children are drawn in diagram coordinates. `overlay` is for screen-space
 * furniture on top (a minimap). The wrapper takes the pan gesture, so a right
 * button that travels pans from anywhere on it.
 */
interface Props {
  view: CameraView;
  /** True while a left-button drag is in progress, for the cursor. */
  grabbing?: boolean;
  /** A click (or double-click) on the empty canvas, not on anything drawn. */
  onBackgroundClick?: (e: React.MouseEvent) => void;
  onBackgroundDoubleClick?: (e: React.MouseEvent) => void;
  /** Shows a Fit button in the corner when given. */
  onFit?: () => void;
  fitLabel?: string;
  overlay?: ReactNode;
  children: ReactNode;
}

/** True when the event landed on the canvas itself rather than on a drawn shape. */
export function isBackgroundTarget(e: React.MouseEvent): boolean {
  const tag = (e.target as Element).tagName;
  return e.target === e.currentTarget || tag === "svg";
}

export function DiagramSurface({
  view,
  grabbing,
  onBackgroundClick,
  onBackgroundDoubleClick,
  onFit,
  fitLabel,
  overlay,
  children,
}: Props) {
  const { wrapRef, camera, panDrag } = view;
  return (
    <div
      ref={wrapRef}
      className={cn(
        "relative min-h-0 flex-1 overflow-hidden bg-background",
        panDrag.panning || grabbing ? "cursor-grabbing" : "cursor-default",
      )}
      onPointerDown={panDrag.onPointerDown}
      onContextMenuCapture={panDrag.onContextMenuCapture}
      // A click on the empty canvas clears the selection, which is what makes
      // "press Escape or click away" work without a global handler.
      onClick={(e) => {
        if (isBackgroundTarget(e)) onBackgroundClick?.(e);
      }}
      onDoubleClick={(e) => {
        if (isBackgroundTarget(e)) onBackgroundDoubleClick?.(e);
      }}
    >
      <svg className="absolute inset-0 size-full" role="presentation">
        <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}>{children}</g>
      </svg>

      {overlay}

      {onFit && (
        <div className="absolute right-2 top-2">
          <Hint label={fitLabel ?? ""} disabled={!fitLabel}>
            <Button size="icon" variant="outline" className="size-7" onClick={onFit}>
              <Maximize2 className="size-3.5" />
            </Button>
          </Hint>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-background/80 px-1.5 py-0.5 text-[10px] text-muted-foreground">
        {Math.round(camera.zoom * 100)}%
      </div>
    </div>
  );
}
