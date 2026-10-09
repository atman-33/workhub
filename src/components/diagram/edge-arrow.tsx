import { arrowHeadPath, type EdgeGeometry, type Point } from "@/lib/diagram/node-edge";
import type { Box } from "@/lib/diagram/sticky-layout";
import { cn } from "@/lib/utils";

/** Radius of the round handles on an arrow's ends and on a hovered node. */
export const HANDLE_RADIUS = 5;

/**
 * One arrow: the line, its head, an optional label, and a fat invisible line
 * on top so a thin arrow is easy to click. When selected it shows a handle on
 * each end; pressing one starts the end-point drag (`useEdgeDrag`).
 */
export function EdgeArrow({
  geometry,
  label,
  labelBox,
  labelFontSize,
  selected,
  faded,
  onSelect,
  onStartLabelEdit,
  onEndPointerDown,
}: {
  geometry: EdgeGeometry;
  label?: string;
  labelBox?: Box;
  labelFontSize: number;
  selected: boolean;
  /** Drawn pale: the arrow is being re-attached and its old shape is a ghost. */
  faded?: boolean;
  onSelect: () => void;
  onStartLabelEdit: () => void;
  onEndPointerDown: (e: React.PointerEvent, end: "from" | "to") => void;
}) {
  return (
    <g opacity={faded ? 0.25 : 1}>
      <path d={geometry.d} fill="none" stroke="transparent" strokeWidth={12} className="cursor-pointer"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          onSelect();
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onStartLabelEdit();
        }}
      />
      <path
        d={geometry.d}
        fill="none"
        strokeWidth={selected ? 2.5 : 1.5}
        className={cn("pointer-events-none", selected ? "stroke-ring" : "stroke-muted-foreground")}
      />
      <path
        d={arrowHeadPath(geometry.end, geometry.headAngle)}
        strokeWidth={1}
        strokeLinejoin="round"
        className={cn("pointer-events-none", selected ? "fill-ring stroke-ring" : "fill-muted-foreground stroke-muted-foreground")}
      />
      {label && labelBox && (
        <g
          className="cursor-pointer"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            onSelect();
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            onStartLabelEdit();
          }}
        >
          <rect
            x={labelBox.x}
            y={labelBox.y}
            width={labelBox.width}
            height={labelBox.height}
            rx={3}
            className="fill-background stroke-border"
            fillOpacity={0.92}
          />
          <text
            x={labelBox.x + labelBox.width / 2}
            y={labelBox.y + labelBox.height / 2 + labelFontSize * 0.36}
            textAnchor="middle"
            fontSize={labelFontSize}
            className="fill-foreground select-none"
          >
            {label}
          </text>
        </g>
      )}
      {selected && !faded && (
        <>
          <EndHandle at={geometry.start} onPointerDown={(e) => onEndPointerDown(e, "from")} />
          <EndHandle at={geometry.end} onPointerDown={(e) => onEndPointerDown(e, "to")} />
        </>
      )}
    </g>
  );
}

function EndHandle({ at, onPointerDown }: { at: Point; onPointerDown: (e: React.PointerEvent) => void }) {
  return (
    <circle
      cx={at.x}
      cy={at.y}
      r={HANDLE_RADIUS}
      className="cursor-crosshair fill-background stroke-ring"
      strokeWidth={2}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        onPointerDown(e);
      }}
    />
  );
}
