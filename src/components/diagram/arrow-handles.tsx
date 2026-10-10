import { HANDLE_RADIUS } from "@/components/diagram/edge-arrow";
import type { EdgeDragState } from "@/components/diagram/use-edge-drag";
import {
  arrowHeadPath,
  boundaryPoint,
  centerOf,
  portOfDrop,
  type DiagramNode,
  type Point,
  type PortSide,
} from "@/lib/diagram/node-edge";
import { cn } from "@/lib/utils";

/**
 * The two pieces of the draw-an-arrow gesture that every node-and-arrow kind
 * (business flow, PFD) draws the same way. The gesture itself is `useEdgeDrag`.
 */

/** The four round handles on the sides of a node; pressing one starts an arrow. */
export function ArrowHandles({
  node,
  onStart,
}: {
  node: DiagramNode;
  onStart: (e: React.PointerEvent) => void;
}) {  const c = centerOf(node);
  const far = 4000;
  const spots: Point[] = [
    boundaryPoint(node, { x: c.x + far, y: c.y }),
    boundaryPoint(node, { x: c.x - far, y: c.y }),
    boundaryPoint(node, { x: c.x, y: c.y - far }),
    boundaryPoint(node, { x: c.x, y: c.y + far }),
  ];
  return (
    <>
      {spots.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={HANDLE_RADIUS}
          className="cursor-crosshair fill-background stroke-ring"
          strokeWidth={1.5}
          onPointerDown={onStart}
        />
      ))}
    </>
  );
}

/** The arrow being drawn or re-routed, from the node it keeps to the pointer
 * (or to the node it would land on). */export function RubberBand({
  drag,
  byId,
}: {
  drag: EdgeDragState;
  byId: ReadonlyMap<string, DiagramNode>;
}) {
  const anchor = byId.get(drag.anchorId);
  if (!anchor) return null;
  const over = drag.overId ? byId.get(drag.overId) : undefined;
  const loose: Point = over ? boundaryPoint(over, centerOf(anchor)) : drag.pointer;
  const anchorEnd = boundaryPoint(anchor, over ? centerOf(over) : drag.pointer);
  // The head always sits at the arrow's `to`: the loose end, except when the
  // held end is the arrow's start.
  const headAtAnchor = drag.mode === "reattach" && drag.end === "from";
  const [tail, tip] = headAtAnchor ? [loose, anchorEnd] : [anchorEnd, loose];
  const angle = Math.atan2(tip.y - tail.y, tip.x - tail.x);
  return (
    <g pointerEvents="none">
      <path
        d={`M ${tail.x} ${tail.y} L ${tip.x} ${tip.y}`}
        fill="none"
        strokeWidth={2}
        strokeDasharray="5 4"
        className="stroke-ring"
      />
      <path d={arrowHeadPath(tip, angle)} className="fill-ring stroke-ring" strokeWidth={1} />
    </g>
  );
}

/**
 * The four round handles on the sides of a node, each naming its side;
 * pressing one starts an arrow pinned to that side (T-0712). Where `ArrowHandles`
 * draws an arrow from anywhere, these pin the exit.
 */
export function PortHandles({
  node,
  onStart,
}: {
  node: DiagramNode;
  onStart: (e: React.PointerEvent, side: PortSide) => void;
}) {
  const c = centerOf(node);
  const far = 4000;
  const spots: { side: PortSide; p: Point }[] = [
    { side: "E", p: boundaryPoint(node, { x: c.x + far, y: c.y }) },
    { side: "W", p: boundaryPoint(node, { x: c.x - far, y: c.y }) },
    { side: "N", p: boundaryPoint(node, { x: c.x, y: c.y - far }) },
    { side: "S", p: boundaryPoint(node, { x: c.x, y: c.y + far }) },
  ];
  return (
    <>
      {spots.map(({ side, p }) => (
        <circle
          key={side}
          cx={p.x}
          cy={p.y}
          r={HANDLE_RADIUS}
          className="cursor-crosshair fill-background stroke-ring"
          strokeWidth={1.5}
          onPointerDown={(e) => onStart(e, side)}
        />
      ))}
    </>
  );
}

/**
 * Where a dragged arrow would land: the four sides of the node under the
 * pointer, display only, with the nearest side filled (all dim in the middle,
 * which stays automatic).
 */
export function DropSpots({ node, pointer }: { node: DiagramNode; pointer: Point }) {
  const c = centerOf(node);
  const far = 4000;
  const spots: { side: PortSide; p: Point }[] = [
    { side: "E", p: boundaryPoint(node, { x: c.x + far, y: c.y }) },
    { side: "W", p: boundaryPoint(node, { x: c.x - far, y: c.y }) },
    { side: "N", p: boundaryPoint(node, { x: c.x, y: c.y - far }) },
    { side: "S", p: boundaryPoint(node, { x: c.x, y: c.y + far }) },
  ];
  const near = portOfDrop(node, pointer)?.side ?? null;
  return (
    <g pointerEvents="none">
      {spots.map(({ side, p }) => (
        <circle
          key={side}
          cx={p.x}
          cy={p.y}
          r={side === near ? 6 : 4}
          className={cn("stroke-ring", side === near ? "fill-ring" : "fill-background")}
          strokeWidth={1.5}
        />
      ))}
    </g>
  );
}
