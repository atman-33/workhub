import { useCallback, useEffect, useRef, useState } from "react";
import { usePanDrag } from "@/components/schedule/use-pan-drag";
import {
  layoutMindmap,
  type MindmapLayout,
  type PositionedNode,
} from "@/lib/mindmap/layout";
import { COLOR_HEX, type MindmapNode } from "@/lib/mindmap/parse";
import { cn } from "@/lib/utils";

/**
 * The mindmap canvas.
 *
 * Draws `layoutMindmap`'s output as SVG and owns exactly one piece of state
 * the file does not: the viewport (`pan`/`zoom`). Everything else — which node
 * is selected, what the tree contains — belongs to the view above, so the
 * canvas stays a pure function of the document plus a camera.
 *
 * Gestures follow the conventions the Schedule grid already established, so
 * the two boards feel like one app:
 *
 * - **right-drag pans** (`usePanDrag`), and a right button that stays put is
 *   still a context menu;
 * - **wheel zooms** toward the pointer, so zooming in on a branch does not
 *   also require panning it back into view;
 * - **left-drag on a node re-parents it**, with the drop target outlined. The
 *   drop is refused when it would put a node inside its own subtree, which the
 *   caller checks — the canvas only reports the intent.
 */

interface Props {
  roots: MindmapNode[];
  selectedId: string | null;
  /** Node currently being renamed inline; its box renders an input. */
  editingId: string | null;
  /** True while an AI edit holds the file: the canvas is look-only. */
  locked?: boolean;
  onSelect: (id: string | null) => void;
  onStartEdit: (id: string) => void;
  onCommitEdit: (id: string, title: string) => void;
  onCancelEdit: () => void;
  onToggleCollapse: (id: string) => void;
  /** A finished re-parent drag: put `id` under `parentId`. */
  onReparent: (id: string, parentId: string) => void;
  /** Bumped by the view to re-fit the map (a new file, or the Fit button). */
  fitToken: number;
}

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.5;
/** Padding around the map when fitting it to the viewport. */
const FIT_PADDING = 48;

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export function MindmapCanvas({
  roots,
  selectedId,
  editingId,
  locked,
  onSelect,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onToggleCollapse,
  onReparent,
  fitToken,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const [layout, setLayout] = useState<MindmapLayout>(() => layoutMindmap(roots));
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; over: string | null } | null>(
    null,
  );

  useEffect(() => {
    setLayout(layoutMindmap(roots));
  }, [roots]);

  const fit = useCallback(() => {
    const el = wrapRef.current;
    if (!el || !layout.nodes.length) return;
    const { width, height } = el.getBoundingClientRect();
    const scale = Math.min(
      (width - FIT_PADDING * 2) / Math.max(layout.bounds.width, 1),
      (height - FIT_PADDING * 2) / Math.max(layout.bounds.height, 1),
      // Never zoom *in* to fit: a two-node map blown up to fill the window
      // looks broken rather than roomy.
      1,
    );
    const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale));
    setCamera({
      zoom,
      x: width / 2 - (layout.bounds.x + layout.bounds.width / 2) * zoom,
      y: height / 2 - (layout.bounds.y + layout.bounds.height / 2) * zoom,
    });
  }, [layout]);

  // Re-fit when the view asks for it. Deliberately not on every layout change:
  // adding a node while zoomed in must not yank the camera away from what the
  // user is looking at.
  useEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitToken]);

  const pan = useCallback((dx: number, dy: number) => {
    setCamera((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
  }, []);
  const panDrag = usePanDrag({ onPan: pan });

  // Registered by hand and non-passively: React attaches `wheel` passively at
  // the root, so a JSX `onWheel` cannot `preventDefault` — and without that,
  // Ctrl+wheel would zoom the whole WebView on top of zooming the map. The
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
      setCamera((c) => {
        const next = Math.max(
          MIN_ZOOM,
          Math.min(MAX_ZOOM, c.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)),
        );
        // Keep the point under the cursor fixed while the scale changes.
        const k = next / c.zoom;
        return { zoom: next, x: px - (px - c.x) * k, y: py - (py - c.y) * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  /** Screen point -> diagram coordinates. */
  const toDiagram = (clientX: number, clientY: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - camera.x) / camera.zoom,
      y: (clientY - rect.top - camera.y) / camera.zoom,
    };
  };

  const nodeAt = (x: number, y: number): PositionedNode | null =>
    layout.nodes.find((n) => x >= n.x && x <= n.x + n.width && y >= n.y && y <= n.y + n.height) ??
    null;

  const startNodeDrag = (e: React.PointerEvent, node: PositionedNode) => {
    // The root has nowhere to move to, and a locked file moves nowhere at all.
    if (locked || node.depth === 0 || editingId) return;
    e.stopPropagation();
    const at = toDiagram(e.clientX, e.clientY);
    setDrag({ id: node.id, x: at.x, y: at.y, over: null });
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const at = toDiagram(e.clientX, e.clientY);
      const hit = nodeAt(at.x, at.y);
      setDrag((d) =>
        d ? { ...d, x: at.x, y: at.y, over: hit && hit.id !== d.id ? hit.id : null } : d,
      );
    };
    const onUp = () => {
      setDrag((d) => {
        if (d?.over) onReparent(d.id, d.over);
        return null;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  });

  return (
    <div
      ref={wrapRef}
      className={cn(
        "relative min-h-0 flex-1 overflow-hidden bg-background",
        panDrag.panning ? "cursor-grabbing" : drag ? "cursor-grabbing" : "cursor-default",
      )}
      onPointerDown={panDrag.onPointerDown}
      onContextMenuCapture={panDrag.onContextMenuCapture}
      // A click on the empty canvas clears the selection, which is what makes
      // "press Escape or click away" work without a global handler.
      onClick={(e) => {
        if (e.target === e.currentTarget || (e.target as Element).tagName === "svg") onSelect(null);
      }}
    >
      <svg className="absolute inset-0 size-full" role="presentation">
        <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}>
          {layout.edges.map((edge) => (
            <path
              key={`${edge.from}-${edge.to}`}
              d={edge.path}
              fill="none"
              stroke={edge.color ? COLOR_HEX[edge.color] : "currentColor"}
              strokeOpacity={edge.color ? 0.85 : 0.35}
              strokeWidth={1.75}
              strokeLinecap="round"
              className="text-muted-foreground"
            />
          ))}
          {layout.nodes.map((node) => (
            <NodeBox
              key={node.id}
              node={node}
              selected={node.id === selectedId}
              dragging={drag?.id === node.id}
              dropTarget={drag?.over === node.id}
              editing={node.id === editingId}
              locked={locked}
              onSelect={onSelect}
              onStartEdit={onStartEdit}
              onCommitEdit={onCommitEdit}
              onCancelEdit={onCancelEdit}
              onToggleCollapse={onToggleCollapse}
              onDragStart={startNodeDrag}
            />
          ))}
        </g>
      </svg>

      <Minimap layout={layout} camera={camera} wrap={wrapRef} selectedId={selectedId} />

      <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-background/80 px-1.5 py-0.5 text-[10px] text-muted-foreground">
        {Math.round(camera.zoom * 100)}%
      </div>
    </div>
  );
}

interface NodeProps {
  node: PositionedNode;
  selected: boolean;
  dragging: boolean;
  dropTarget: boolean;
  editing: boolean;
  locked?: boolean;
  onSelect: (id: string) => void;
  onStartEdit: (id: string) => void;
  onCommitEdit: (id: string, title: string) => void;
  onCancelEdit: () => void;
  onToggleCollapse: (id: string) => void;
  onDragStart: (e: React.PointerEvent, node: PositionedNode) => void;
}

function NodeBox({
  node,
  selected,
  dragging,
  dropTarget,
  editing,
  locked,
  onSelect,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onToggleCollapse,
  onDragStart,
}: NodeProps) {
  const color = node.color ?? node.branchColor;
  const stroke = color ? COLOR_HEX[color] : undefined;
  const isRoot = node.depth === 0;
  const lineHeight = 14 * 1.45;
  const firstBaseline =
    node.y + node.height / 2 - ((node.lines.length - 1) * lineHeight) / 2 + 14 * 0.36;
  const badgeX = node.side === "right" ? node.x + node.width + 8 : node.x - 8;

  return (
    <g
      opacity={dragging ? 0.45 : 1}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        onSelect(node.id);
        onDragStart(e, node);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!locked) onStartEdit(node.id);
      }}
      className="cursor-pointer"
    >
      <rect
        x={node.x}
        y={node.y}
        width={node.width}
        height={node.height}
        rx={isRoot ? node.height / 2 : 8}
        className={cn(
          isRoot ? "fill-foreground" : "fill-card",
          !stroke && !isRoot && "stroke-border",
        )}
        stroke={dropTarget ? undefined : stroke}
        strokeWidth={isRoot ? 0 : 1.5}
      />
      {(selected || dropTarget) && (
        <rect
          x={node.x - 3}
          y={node.y - 3}
          width={node.width + 6}
          height={node.height + 6}
          rx={isRoot ? node.height / 2 + 3 : 11}
          fill="none"
          className={dropTarget ? "stroke-primary" : "stroke-ring"}
          strokeWidth={2}
          strokeDasharray={dropTarget ? "4 3" : undefined}
        />
      )}

      {editing ? (
        <foreignObject x={node.x} y={node.y} width={node.width} height={node.height}>
          <NodeInput
            initial={node.title}
            onCommit={(value) => onCommitEdit(node.id, value)}
            onCancel={onCancelEdit}
          />
        </foreignObject>
      ) : (
        node.lines.map((line, i) => (
          <text
            key={`${node.id}-${i}`}
            x={node.x + node.width / 2}
            y={firstBaseline + i * lineHeight}
            textAnchor="middle"
            fontSize={14}
            fontWeight={isRoot ? 600 : 400}
            className={cn("select-none", isRoot ? "fill-background" : "fill-foreground")}
          >
            {line}
          </text>
        ))
      )}

      {node.task && !editing && (
        <text
          x={node.x + node.width / 2}
          y={node.y + node.height + 11}
          textAnchor="middle"
          fontSize={9}
          className="fill-muted-foreground select-none"
        >
          {node.task}
        </text>
      )}

      {node.childCount > 0 && (
        <g
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse(node.id);
          }}
          className="cursor-pointer"
        >
          <circle
            cx={badgeX}
            cy={node.y + node.height / 2}
            r={7}
            className={cn("fill-background", stroke ? "" : "stroke-border")}
            stroke={stroke}
            strokeWidth={1.5}
          />
          <text
            x={badgeX}
            y={node.y + node.height / 2 + 3.5}
            textAnchor="middle"
            fontSize={9}
            className="fill-foreground select-none"
          >
            {node.collapsed ? node.childCount : "–"}
          </text>
        </g>
      )}
    </g>
  );
}

/** Inline rename. Enter commits, Escape abandons, blur commits — the same
 * bargain the task board's inline fields make. */
function NodeInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit(value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      className="size-full rounded bg-transparent px-2 text-center text-sm outline-none"
    />
  );
}

/**
 * Overview of the whole map with the viewport drawn on it.
 *
 * Worth its pixels precisely when the map has outgrown the window, so it hides
 * itself when everything already fits.
 */
function Minimap({
  layout,
  camera,
  wrap,
  selectedId,
}: {
  layout: MindmapLayout;
  camera: Camera;
  wrap: React.RefObject<HTMLDivElement | null>;
  selectedId: string | null;
}) {
  const size = { width: 168, height: 112 };
  const rect = wrap.current?.getBoundingClientRect();
  if (!layout.nodes.length || !rect) return null;

  const visible = {
    x: -camera.x / camera.zoom,
    y: -camera.y / camera.zoom,
    width: rect.width / camera.zoom,
    height: rect.height / camera.zoom,
  };
  if (
    visible.x <= layout.bounds.x &&
    visible.y <= layout.bounds.y &&
    visible.x + visible.width >= layout.bounds.x + layout.bounds.width &&
    visible.y + visible.height >= layout.bounds.y + layout.bounds.height
  ) {
    return null;
  }

  // Include the viewport in the framed area, so the marker never leaves the
  // minimap when the user pans off the map.
  const minX = Math.min(layout.bounds.x, visible.x);
  const minY = Math.min(layout.bounds.y, visible.y);
  const maxX = Math.max(layout.bounds.x + layout.bounds.width, visible.x + visible.width);
  const maxY = Math.max(layout.bounds.y + layout.bounds.height, visible.y + visible.height);

  return (
    <svg
      className="pointer-events-none absolute bottom-2 left-2 rounded border bg-background/80"
      width={size.width}
      height={size.height}
      viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
      preserveAspectRatio="xMidYMid meet"
      role="presentation"
    >
      {layout.nodes.map((node) => (
        <rect
          key={node.id}
          x={node.x}
          y={node.y}
          width={node.width}
          height={node.height}
          rx={4}
          className={node.id === selectedId ? "fill-primary" : "fill-muted-foreground"}
          fillOpacity={node.id === selectedId ? 0.9 : 0.45}
        />
      ))}
      <rect
        x={visible.x}
        y={visible.y}
        width={visible.width}
        height={visible.height}
        fill="none"
        className="stroke-ring"
        strokeWidth={(maxX - minX) / size.width}
      />
    </svg>
  );
}
