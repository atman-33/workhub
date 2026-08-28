import { useCallback, useEffect, useRef, useState } from "react";
import { usePanDrag } from "@/components/schedule/use-pan-drag";
import {
  DEFAULT_LAYOUT,
  layoutMindmap,
  NODE_PAD_X,
  STICKY_FONT_SIZE,
  STICKY_PAD,
  textWidth,
  type MindmapLayout,
  type PositionedNode,
  type PositionedSticky,
} from "@/lib/mindmap/layout";
import {
  COLOR_HEX,
  STICKY_FILL_HEX,
  STICKY_INK,
  type MindmapNode,
  type NodeWidth,
  type Sticky,
} from "@/lib/mindmap/parse";
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
  /** The note's box-width setting, applied by the layout. */
  nodeWidth: NodeWidth;
  /** Sticky notes to draw. Empty while the note hides them. */
  stickies: Sticky[];
  selectedId: string | null;
  /** The selected sticky, if the last click landed on one. Selecting a sticky
   * and selecting a node are mutually exclusive — the view enforces that. */
  selectedStickyId: string | null;
  /** Sticky currently being edited inline; its paper renders a textarea. */
  editingStickyId: string | null;
  onSelectSticky: (id: string | null) => void;
  onStartEditSticky: (id: string) => void;
  onCommitStickyText: (id: string, text: string) => void;
  onCancelStickyEdit: () => void;
  /** A finished sticky drag: the new offset from its node's centre. */
  onMoveSticky: (id: string, dx: number, dy: number) => void;
  /** Node currently being renamed inline; its box renders an input. */
  editingId: string | null;
  /** True while an AI edit holds the file: the canvas is look-only. */
  locked?: boolean;
  onSelect: (id: string | null) => void;
  onStartEdit: (id: string) => void;
  onCommitEdit: (id: string, title: string) => void;
  onCancelEdit: () => void;
  onToggleCollapse: (id: string) => void;
  /** A finished re-parent drag: put `id` under `parentId`. `dropSide` is which
   * side of the new parent the pointer was on, which is what decides where a
   * branch of the root ends up. */
  onReparent: (id: string, parentId: string, dropSide: "left" | "right") => void;
  /** Bumped by the view to re-fit the map (a new file, or the Fit button). */
  fitToken: number;
}

const MIN_ZOOM = 0.2;
/** Travel, in screen px, before a press on a node becomes a drag rather than a
 * click. Mirrors `usePanDrag`'s threshold so both gestures arbitrate alike. */
const DRAG_THRESHOLD_PX = 4;
/** How far from a box a drop still counts as landing on it. The boxes are
 * small and the gaps between them are not; without this, a drag that stops two
 * pixels short of the target silently does nothing. */
const SNAP_RADIUS = 44;
const MAX_ZOOM = 2.5;
/** Padding around the map when fitting it to the viewport. */
const FIT_PADDING = 48;

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

interface DragState {
  id: string;
  /** Where the press landed, in diagram coordinates. */
  originX: number;
  originY: number;
  /** Where the pointer is now. */
  x: number;
  y: number;
  /** Drop target under (or nearest to) the pointer. */
  over: string | null;
  /** False until the press has travelled far enough to be a drag. */
  active: boolean;
}

/** A sticky being dragged to a new offset. Kept apart from `DragState`: a
 * node drag re-parents, a sticky drag only moves paper. */
interface StickyDragState {
  id: string;
  /** Pointer position when the press landed, in diagram coordinates. */
  fromX: number;
  fromY: number;
  /** The sticky's offset when the press landed. */
  dx: number;
  dy: number;
  /** How far the pointer has travelled since, in diagram coordinates. */
  moveX: number;
  moveY: number;
  active: boolean;
}

export function MindmapCanvas({
  roots,
  nodeWidth,
  stickies,
  selectedId,
  selectedStickyId,
  editingStickyId,
  editingId,
  locked,
  onSelectSticky,
  onStartEditSticky,
  onCommitStickyText,
  onCancelStickyEdit,
  onMoveSticky,
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
  const [layout, setLayout] = useState<MindmapLayout>(() =>
    layoutMindmap(roots, { nodeWidth, stickies }),
  );
  const [drag, setDrag] = useState<DragState | null>(null);
  const [stickyDrag, setStickyDrag] = useState<StickyDragState | null>(null);
  /**
   * The canvas's own size, tracked rather than read on demand.
   *
   * The app shell keeps every tab mounted and hides the inactive ones, so on
   * first mount this element measures 0x0 and any fit computed then is
   * meaningless. Watching the box means the first fit happens when the tab is
   * actually shown, and again whenever the window or the side panel resizes it.
   */
  const [size, setSize] = useState({ width: 0, height: 0 });
  /** A fit was asked for and has not been satisfiable yet (no size, no nodes). */
  const pendingFit = useRef(true);

  /**
   * The layout the camera is currently aimed at, and the node the next layout
   * should be pinned to.
   *
   * Collapsing a branch re-flows everything above and below it, so the node
   * whose badge was clicked slides out from under the pointer. Remembering it
   * across the re-layout lets the camera absorb the difference, which is the
   * only way to keep a gesture's own target still — the file has no
   * coordinates to hold anything in place.
   */
  const layoutRef = useRef(layout);
  const anchorId = useRef<string | null>(null);

  useEffect(() => {
    const next = layoutMindmap(roots, { nodeWidth, stickies });
    const anchor = anchorId.current;
    anchorId.current = null;
    if (anchor) {
      const before = layoutRef.current.byId.get(anchor);
      const after = next.byId.get(anchor);
      if (before && after) {
        const dx = after.x - before.x;
        const dy = after.y - before.y;
        // Screen position of a diagram point is `camera + p * zoom`, so
        // undoing a move of `d` means shifting the camera by `-d * zoom`.
        if (dx || dy) setCamera((c) => ({ ...c, x: c.x - dx * c.zoom, y: c.y - dy * c.zoom }));
      }
    }
    layoutRef.current = next;
    setLayout(next);
  }, [roots, nodeWidth, stickies]);

  /**
   * What is currently typed in the rename box.
   *
   * Held here, rather than only inside the input, so the box can grow with the
   * text: the node's own width comes from the *saved* title, so without this a
   * long name is typed into a box the size of the old one and most of it is
   * invisible.
   */
  const [draft, setDraft] = useState("");
  useEffect(() => {
    setDraft(editingId ? (layout.byId.get(editingId)?.title ?? "") : "");
    // Re-seeded when the rename target changes, not when the layout does — the
    // layout changes on every keystroke via the draft itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  /** Width the box needs for the text being typed into it. */
  const draftWidth = Math.ceil(textWidth(draft, DEFAULT_LAYOUT.fontSize)) + NODE_PAD_X * 2 + 16;

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
    const { width, height } = size;
    if (!width || !height || !layout.nodes.length) return false;
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
    return true;
  }, [layout, size]);

  // The view asks for a fit by bumping the token; it is recorded rather than
  // acted on, because the request usually arrives one render before the layout
  // and the size are both known.
  useEffect(() => {
    pendingFit.current = true;
  }, [fitToken]);

  // Satisfy a pending request as soon as it can be satisfied. Deliberately not
  // a fit on every layout change: adding a node while zoomed in must not yank
  // the camera away from what the user is looking at.
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

  /** True when `id` is `ancestorId` or sits somewhere beneath it. */
  const isWithin = (id: string, ancestorId: string): boolean => {
    let cursor: string | undefined = id;
    while (cursor) {
      if (cursor === ancestorId) return true;
      cursor = layout.byId.get(cursor)?.parentId;
    }
    return false;
  };

  /**
   * The node a drop would land on: the box under the pointer, or — when the
   * pointer is between boxes — the nearest one within reach.
   *
   * Requiring an exact hit made the gesture feel broken: the boxes are small,
   * the gaps between them are large, and a drag that lands two pixels short
   * silently did nothing. `moving` is excluded along with its whole subtree,
   * since a node cannot become its own descendant.
   */
  const dropTargetAt = (x: number, y: number, moving: string): string | null => {
    let best: { id: string; distance: number } | null = null;
    for (const node of layout.nodes) {
      if (isWithin(node.id, moving)) continue;
      const dx = Math.max(node.x - x, 0, x - (node.x + node.width));
      const dy = Math.max(node.y - y, 0, y - (node.y + node.height));
      const distance = Math.hypot(dx, dy);
      if (distance > SNAP_RADIUS) continue;
      if (!best || distance < best.distance) best = { id: node.id, distance };
    }
    return best?.id ?? null;
  };

  const startNodeDrag = (e: React.PointerEvent, node: PositionedNode) => {
    // The root has nowhere to move to, and a locked file moves nowhere at all.
    if (locked || node.depth === 0 || editingId) return;
    e.stopPropagation();
    const at = toDiagram(e.clientX, e.clientY);
    setDrag({
      id: node.id,
      originX: at.x,
      originY: at.y,
      x: at.x,
      y: at.y,
      over: null,
      active: false,
    });
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const at = toDiagram(e.clientX, e.clientY);
      setDrag((d) => {
        if (!d) return d;
        // A press that never travels is a click on the node, not a drag — the
        // same arbitration `usePanDrag` makes for the right button.
        const active =
          d.active ||
          Math.abs(at.x - d.originX) * camera.zoom + Math.abs(at.y - d.originY) * camera.zoom >=
            DRAG_THRESHOLD_PX;
        return {
          ...d,
          x: at.x,
          y: at.y,
          active,
          over: active ? dropTargetAt(at.x, at.y, d.id) : null,
        };
      });
    };
    const onUp = () => {
      setDrag((d) => {
        if (d?.active && d.over) {
          const parent = layout.byId.get(d.over);
          const side = parent && d.x < parent.x + parent.width / 2 ? "left" : "right";
          onReparent(d.id, d.over, side);
        }
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

  const startStickyDrag = (e: React.PointerEvent, sticky: PositionedSticky) => {
    if (locked || editingStickyId) return;
    e.stopPropagation();
    const at = toDiagram(e.clientX, e.clientY);
    const source = stickies.find((s) => s.id === sticky.id);
    if (!source) return;
    setStickyDrag({
      id: sticky.id,
      fromX: at.x,
      fromY: at.y,
      dx: source.dx,
      dy: source.dy,
      moveX: 0,
      moveY: 0,
      active: false,
    });
  };

  // The move is committed once, on release, rather than on every pointer
  // event: each commit is a file write and an undo entry, and a drag would
  // otherwise fill the undo stack with a hundred intermediate positions.
  useEffect(() => {
    if (!stickyDrag) return;
    const onMove = (e: PointerEvent) => {
      const at = toDiagram(e.clientX, e.clientY);
      setStickyDrag((d) => {
        if (!d) return d;
        const moveX = at.x - d.fromX;
        const moveY = at.y - d.fromY;
        const active =
          d.active ||
          (Math.abs(moveX) + Math.abs(moveY)) * camera.zoom >= DRAG_THRESHOLD_PX;
        return { ...d, moveX, moveY, active };
      });
    };
    const onUp = () => {
      setStickyDrag((d) => {
        if (d?.active) onMoveSticky(d.id, Math.round(d.dx + d.moveX), Math.round(d.dy + d.moveY));
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

  const dragged = drag?.active ? (layout.byId.get(drag.id) ?? null) : null;

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
        if (e.target === e.currentTarget || (e.target as Element).tagName === "svg") {
          onSelect(null);
          onSelectSticky(null);
        }
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
              dragging={Boolean(drag?.active) && drag?.id === node.id}
              dropTarget={drag?.over === node.id}
              editing={node.id === editingId}
              editingWidth={draftWidth}
              draft={draft}
              onDraftChange={setDraft}
              locked={locked}
              onSelect={onSelect}
              onStartEdit={onStartEdit}
              onCommitEdit={onCommitEdit}
              onCancelEdit={onCancelEdit}
              onToggleCollapse={(id) => {
                anchorId.current = id;
                onToggleCollapse(id);
              }}
              onDragStart={startNodeDrag}
            />
          ))}

          {/* Stickies are drawn last, so a note the user dropped over a
              branch stays readable instead of disappearing under it. */}
          {layout.stickies.map((sticky) => (
            <StickyPaper
              key={sticky.id}
              sticky={sticky}
              offsetX={stickyDrag?.active && stickyDrag.id === sticky.id ? stickyDrag.moveX : 0}
              offsetY={stickyDrag?.active && stickyDrag.id === sticky.id ? stickyDrag.moveY : 0}
              selected={sticky.id === selectedStickyId}
              editing={sticky.id === editingStickyId}
              locked={locked}
              onSelect={onSelectSticky}
              onStartEdit={onStartEditSticky}
              onCommit={onCommitStickyText}
              onCancel={onCancelStickyEdit}
              onDragStart={startStickyDrag}
            />
          ))}

          {/* The node being dragged, redrawn under the pointer. Without a
              ghost the gesture gave no feedback at all — the box stayed put
              and only faded, so the map read as "nothing is moving". */}
          {dragged && drag && (
            <g pointerEvents="none" opacity={0.9}>
              {drag.over && (
                <path
                  d={dropLine(layout.byId.get(drag.over)!, drag)}
                  fill="none"
                  className="stroke-primary"
                  strokeWidth={2}
                  strokeDasharray="5 4"
                />
              )}
              <rect
                x={drag.x - dragged.width / 2}
                y={drag.y - dragged.height / 2}
                width={dragged.width}
                height={dragged.height}
                rx={8}
                className="fill-card stroke-primary"
                strokeWidth={2}
              />
              <text
                x={drag.x}
                y={drag.y + 5}
                textAnchor="middle"
                fontSize={14}
                className="fill-foreground select-none"
              >
                {dragged.lines[0]}
              </text>
            </g>
          )}
        </g>
      </svg>

      <Minimap layout={layout} camera={camera} size={size} selectedId={selectedId} />

      <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-background/80 px-1.5 py-0.5 text-[10px] text-muted-foreground">
        {Math.round(camera.zoom * 100)}%
      </div>
    </div>
  );
}

/** Line from the prospective parent to the ghost, so the drop reads as "this
 * node goes under that one" rather than "this node lands here". */
function dropLine(parent: PositionedNode, drag: { x: number; y: number }): string {
  const fromRight = drag.x >= parent.x + parent.width / 2;
  const x1 = fromRight ? parent.x + parent.width : parent.x;
  const y1 = parent.y + parent.height / 2;
  const dx = (drag.x - x1) / 2;
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${drag.x - dx} ${drag.y}, ${drag.x} ${drag.y}`;
}

interface NodeProps {
  node: PositionedNode;
  selected: boolean;
  dragging: boolean;
  dropTarget: boolean;
  editing: boolean;
  /** Width the rename box needs for what is typed in it so far. */
  editingWidth: number;
  draft: string;
  onDraftChange: (value: string) => void;
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
  editingWidth,
  draft,
  onDraftChange,
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
  // While being renamed the box grows with the text, from its own centre so it
  // does not crawl sideways as it widens.
  const width = editing ? Math.max(node.width, editingWidth) : node.width;
  const x = node.x - (width - node.width) / 2;
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
        x={x}
        y={node.y}
        width={width}
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
          x={x - 3}
          y={node.y - 3}
          width={width + 6}
          height={node.height + 6}
          rx={isRoot ? node.height / 2 + 3 : 11}
          fill="none"
          className={dropTarget ? "stroke-primary" : "stroke-ring"}
          strokeWidth={2}
          strokeDasharray={dropTarget ? "4 3" : undefined}
        />
      )}

      {editing ? (
        <foreignObject x={x} y={node.y} width={width} height={node.height}>
          <NodeInput
            value={draft}
            onChange={onDraftChange}
            onCommit={(value) => onCommitEdit(node.id, value)}
            onCancel={onCancelEdit}
          />
        </foreignObject>
      ) : (
        node.lines.map((line, i) => (
          <text
            key={`${node.id}-${i}`}
            x={x + width / 2}
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
          x={x + width / 2}
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
 * bargain the task board's inline fields make.
 *
 * The value lives in the canvas so the box can size itself to the text; this
 * component only owns focus.
 */
function NodeInput({
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  value: string;
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
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
      // Its own background and text colour rather than the node's: the root is
      // drawn in the foreground colour, so an inherited-colour field on it was
      // white text on white.
      className="size-full rounded border border-ring bg-background px-2 text-center text-sm text-foreground outline-none"
    />
  );
}

/**
 * One sticky note.
 *
 * Drawn in diagram coordinates like everything else, so it pans and zooms with
 * the map it annotates and its offset from its node never changes on screen.
 * A leader line runs back to the node, which is what keeps a sticky legible
 * once it has been dragged clear of the box it belongs to.
 */
function StickyPaper({
  sticky,
  offsetX,
  offsetY,
  selected,
  editing,
  locked,
  onSelect,
  onStartEdit,
  onCommit,
  onCancel,
  onDragStart,
}: {
  sticky: PositionedSticky;
  /** Live drag displacement, applied while the pointer is down. */
  offsetX: number;
  offsetY: number;
  selected: boolean;
  editing: boolean;
  locked?: boolean;
  onSelect: (id: string) => void;
  onStartEdit: (id: string) => void;
  onCommit: (id: string, text: string) => void;
  onCancel: () => void;
  onDragStart: (e: React.PointerEvent, sticky: PositionedSticky) => void;
}) {
  const x = sticky.x + offsetX;
  const y = sticky.y + offsetY;
  const lineHeight = STICKY_FONT_SIZE * 1.45;
  const firstBaseline = y + STICKY_PAD + STICKY_FONT_SIZE * 0.9;

  return (
    <g
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        onSelect(sticky.id);
        onDragStart(e, sticky);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!locked) onStartEdit(sticky.id);
      }}
      className="cursor-pointer"
    >
      <path
        d={`M ${sticky.anchorX} ${sticky.anchorY} L ${x + sticky.width / 2} ${y + sticky.height / 2}`}
        stroke={COLOR_HEX[sticky.color]}
        strokeOpacity={0.5}
        strokeWidth={1}
        strokeDasharray="3 3"
        fill="none"
      />
      <rect
        x={x}
        y={y}
        width={sticky.width}
        height={sticky.height}
        rx={3}
        fill={STICKY_FILL_HEX[sticky.color]}
        stroke={COLOR_HEX[sticky.color]}
        strokeWidth={1}
      />
      {selected && (
        <rect
          x={x - 3}
          y={y - 3}
          width={sticky.width + 6}
          height={sticky.height + 6}
          rx={6}
          fill="none"
          className="stroke-ring"
          strokeWidth={2}
        />
      )}
      {editing ? (
        <foreignObject x={x} y={y} width={sticky.width} height={sticky.height}>
          <StickyInput
            value={sticky.text}
            onCommit={(text) => onCommit(sticky.id, text)}
            onCancel={onCancel}
          />
        </foreignObject>
      ) : (
        sticky.lines.map((line, i) => (
          <text
            key={`${sticky.id}-${i}`}
            x={x + STICKY_PAD}
            y={firstBaseline + i * lineHeight}
            fontSize={STICKY_FONT_SIZE}
            fill={STICKY_INK}
            className="select-none"
          >
            {line}
          </text>
        ))
      )}
    </g>
  );
}

/** Inline sticky editing. Multi-line, so Enter is a line break and the commit
 * gestures are blur and Ctrl+Enter; Escape abandons, as everywhere else. */
function StickyInput({
  value,
  onCommit,
  onCancel,
}: {
  value: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <textarea
      ref={ref}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          onCommit(draft);
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      // Paper colours rather than theme colours: the field sits on the sticky,
      // and a themed field on pale paper is unreadable in the dark app.
      style={{ background: "#ffffff", color: STICKY_INK }}
      className="size-full resize-none rounded-[3px] border border-ring px-1.5 py-1 text-[11px] leading-[1.45] outline-none"
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
  size,
  selectedId,
}: {
  layout: MindmapLayout;
  camera: Camera;
  /** The canvas's size, tracked by its ResizeObserver — reading the ref during
   * render would give nothing on the first pass and never correct itself. */
  size: { width: number; height: number };
  selectedId: string | null;
}) {
  const box = { width: 168, height: 112 };
  if (!layout.nodes.length || !size.width || !size.height) return null;

  const visible = {
    x: -camera.x / camera.zoom,
    y: -camera.y / camera.zoom,
    width: size.width / camera.zoom,
    height: size.height / camera.zoom,
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
      width={box.width}
      height={box.height}
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
        strokeWidth={(maxX - minX) / box.width}
      />
    </svg>
  );
}
