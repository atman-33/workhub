import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { ArrowHandles, RubberBand } from "@/components/diagram/arrow-handles";
import {
  ClipboardMenuItems,
  NodeClipboardMenu,
  type CanvasClipboard,
} from "@/components/diagram/clipboard-menu";
import { DiagramSurface } from "@/components/diagram/diagram-surface";
import { EdgeArrow } from "@/components/diagram/edge-arrow";
import { NodeInput } from "@/components/diagram/node-input";
import { ShapeOutline } from "@/components/diagram/node-shape";
import { NoteTip } from "@/components/diagram/note-tip";
import { StickyPaper } from "@/components/diagram/sticky-paper";
import { useCamera } from "@/components/diagram/use-camera";
import { useEdgeDrag } from "@/components/diagram/use-edge-drag";
import { useFreeDrag } from "@/components/diagram/use-free-drag";
import { useMarquee } from "@/components/diagram/use-marquee";
import { COLOR_HEX } from "@/lib/diagram/colors";
import { hitNode } from "@/lib/diagram/node-edge";
import { idsInRect, shiftPositions } from "@/lib/diagram/multi-select";
import { speechBubbleOutline } from "@/lib/diagram/shapes";
import type { Sticky } from "@/lib/diagram/sticky";
import type { PositionedSticky } from "@/lib/diagram/sticky-layout";
import {
  BUBBLE_BULLET,
  BUBBLE_BULLET_WIDTH,
  BUBBLE_FONT_SIZE,
  BUBBLE_LINE_HEIGHT,
  BUBBLE_PAD,
  EDGE_LABEL_FONT_SIZE,
  layoutUsecase,
  nodeTextY,
  type PositionedBubble,
  type PositionedNode,
  type UsecaseLayout,
} from "@/lib/diagram/usecase/layout";
import type { UsecaseDocModel } from "@/lib/diagram/usecase/parse";
import { symbolOfKind } from "@/lib/diagram/usecase/symbols";
import { cn } from "@/lib/utils";

/**
 * The use case canvas (T-0707), copied from the IFDAM canvas.
 *
 * Draws `layoutUsecase`'s output as SVG - the same geometry the exports render
 * (`usecase/export.ts`'s `renderNode` / `renderBubble`) - and owns exactly one
 * piece of state the file does not: the camera (plus the transient hover and
 * the gestures in flight). What is selected and what the note contains belong
 * to the view above.
 *
 * - **left-drag on a node moves it**, alone or with the rest of the selection
 *   (Shift+click grows the selection; dragging any selected node moves them
 *   all, reported once on release so one undo step restores them). A person's
 *   speech bubble is part of the person: pressing it selects (and drags) the
 *   person, and it follows the person while dragged. The marquee only tests
 *   node boxes - a bubble alone never selects anything, like a sticky;
 * - **left-drag on empty canvas draws a marquee** selecting every node it
 *   touches (Shift held: added to the selection instead);
 * - **a handle on a hovered node** drags out a new line onto another node, and
 *   any other node is highlighted as a target;
 * - **the end handles of a selected line** re-attach that end the same way;
 * - **double-click on empty canvas adds a node** of the chosen kind there; on
 *   a node it renames it, on a line it selects it (label and arrow are set in
 *   the side panel). A bubble's items are edited in the side panel, not here;
 * - right-drag pans and the wheel zooms (the shared camera).
 */
interface Props {
  doc: UsecaseDocModel;
  /** Sticky notes to draw. Empty while the note hides them. */
  stickies: Sticky[];
  /** The layout of `doc` as it stands (the view needs it for edits too). */
  layout: UsecaseLayout;
  /** The ordered selection; the ring is drawn on every entry. */
  selectedNodeIds: string[];
  selectedEdgeKey: string | null;
  selectedStickyId: string | null;
  editingNodeId: string | null;
  editingStickyId: string | null;
  /** A click on a node: plain replaces the selection, Shift toggles it. */
  onSelectNode: (id: string | null, additive: boolean) => void;
  /** A finished marquee: the caught ids replace the selection, or join it with Shift. */
  onSelectMarquee: (ids: string[], additive: boolean) => void;
  onSelectEdge: (key: string | null) => void;
  onSelectSticky: (id: string | null) => void;
  onStartEditNode: (id: string) => void;
  onCommitNodeTitle: (id: string, title: string) => void;
  onCancelNodeEdit: () => void;
  onStartEditSticky: (id: string) => void;
  onCommitStickyText: (id: string, text: string) => void;
  onCancelStickyEdit: () => void;
  /** A finished sticky drag: the new offset from its node's centre. */
  onMoveSticky: (id: string, dx: number, dy: number) => void;
  /** A finished node drag: the new centres of every moved node. */
  onMoveNodes: (moves: ReadonlyMap<string, { x: number; y: number }>) => void;
  /** A double-click on empty canvas: add a node centred here. */
  onAddAt: (x: number, y: number) => void;
  onConnect: (from: string, to: string) => void;
  onReattach: (edge: { from: string; to: string }, end: "from" | "to", nodeId: string) => void;
  /** Copy, duplicate and paste, offered in the right-click menus. */
  clipboard: CanvasClipboard;
  /** Bumped by the view to re-fit (a new note, or the Fit button). */
  fitToken: number;
}

/** The bubble: the outline with its tail towards the person, and the actions as a bulleted list. */
function Bubble({ bubble }: { bubble: PositionedBubble }) {
  const outline = speechBubbleOutline(bubble, bubble.tailSide);
  const textX = bubble.x + BUBBLE_PAD + BUBBLE_BULLET_WIDTH;
  return (
    <g>
      {createElement(outline.tag, {
        ...outline.attrs,
        className: "fill-card stroke-muted-foreground",
        strokeWidth: 1.2,
      })}
      {bubble.items.map((item, n) => {
        const y = bubble.y + item.y;
        return (
          <g key={n}>
            <text
              x={bubble.x + BUBBLE_PAD}
              y={y}
              fontSize={BUBBLE_FONT_SIZE}
              className="fill-foreground select-none"
            >
              {BUBBLE_BULLET}
            </text>
            {item.lines.map((line, i) => (
              <text
                key={i}
                x={textX}
                y={y + i * BUBBLE_LINE_HEIGHT}
                fontSize={BUBBLE_FONT_SIZE}
                className="fill-foreground select-none"
              >
                {line}
              </text>
            ))}
          </g>
        );
      })}
    </g>
  );
}

export function UsecaseCanvas({
  doc,
  stickies,
  layout: base,
  selectedNodeIds,
  selectedEdgeKey,
  selectedStickyId,
  editingNodeId,
  editingStickyId,
  onSelectNode,
  onSelectMarquee,
  onSelectEdge,
  onSelectSticky,
  onStartEditNode,
  onCommitNodeTitle,
  onCancelNodeEdit,
  onStartEditSticky,
  onCommitStickyText,
  onCancelStickyEdit,
  onMoveSticky,
  onMoveNodes,
  onAddAt,
  onConnect,
  onReattach,
  clipboard,
  fitToken,
}: Props) {
  const view = useCamera({ bounds: base.bounds, fitToken });
  const { camera, toDiagram } = view;
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // A drag that ends over empty canvas is followed by a click that would clear
  // the selection it just made; this swallows that one click.
  const justDragged = useRef(false);
  const swallowClick = () => {
    justDragged.current = true;
    setTimeout(() => {
      justDragged.current = false;
    }, 0);
  };

  const nodeFree = useFreeDrag({
    toDiagram,
    zoom: camera.zoom,
    onEnd: (d) => {
      const origins = groupOrigins.current;
      const ids = [...origins.keys()];
      if (ids.length) {
        onMoveNodes(
          shiftPositions(origins, ids, d.dx, d.dy, (x, y) => ({ x: Math.round(x), y: Math.round(y) })),
        );
      }
      groupOrigins.current = new Map();
      swallowClick();
    },
  });
  const stickyFree = useFreeDrag({
    toDiagram,
    zoom: camera.zoom,
    onEnd: (d) => {
      const source = stickies.find((s) => s.id === d.id);
      if (source) onMoveSticky(d.id, Math.round(source.dx + d.dx), Math.round(source.dy + d.dy));
      swallowClick();
    },
  });

  const marquee = useMarquee({
    toDiagram,
    zoom: camera.zoom,
    onMarquee: (rect, additive) => onSelectMarquee(idsInRect(base.nodes, rect), additive),
  });

  /** Centres of the drag's group, snapshotted when the press landed. */
  const groupOrigins = useRef(new Map<string, { x: number; y: number }>());

  // While nodes are dragged, the layout is recomputed with the whole group at
  // the pointer, so their lines, bubbles and stickies follow live instead of
  // jumping on release. The moved nodes are laid over the document as `@`
  // positions - the ring reads those directly, so several moved nodes preview
  // at once and every person's bubble follows its person.
  const dragging = nodeFree.drag?.active ? nodeFree.drag : null;
  const layout = useMemo(() => {
    if (!dragging) return base;
    const origins = groupOrigins.current;
    if (!origins.size) return base;
    const moves = shiftPositions(
      origins,
      [...origins.keys()],
      dragging.dx,
      dragging.dy,
      (x, y) => ({ x: Math.round(x), y: Math.round(y) }),
    );
    return layoutUsecase(
      {
        ...doc,
        nodes: doc.nodes.map((n) => {
          const at = moves.get(n.id);
          return at ? { ...n, x: at.x, y: at.y } : n;
        }),
      },
      stickies,
    );
  }, [base, dragging, doc, stickies]);

  const edgeDrag = useEdgeDrag({
    toDiagram,
    nodeAt: (p) => hitNode(layout.nodes, p)?.id ?? null,
    // Any node but the line's own anchor lights up (no connection rules).
    canJoin: (d, overId) => overId !== d.anchorId,
    onDrop: (d, overId) => {
      if (d.mode === "create") onConnect(d.anchorId, overId);
      else if (d.edge && d.end) onReattach(d.edge, d.end, overId);
      swallowClick();
    },
  });

  // Re-seeded when the rename target changes, not when the layout does - the
  // layout changes on every keystroke via the draft itself.
  useEffect(() => {
    setDraft(editingNodeId ? (base.byId.get(editingNodeId)?.title ?? "") : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingNodeId]);

  const startNodeDrag = (e: React.PointerEvent, node: PositionedNode) => {
    if (e.button !== 0) return;
    // Shift+click grows or shrinks the selection instead of dragging.
    if (e.shiftKey) {
      onSelectNode(node.id, true);
      return;
    }
    // Dragging a selected node moves the whole group; anywhere else starts
    // over with this node alone.
    const ids = selectedNodeIds.includes(node.id) ? selectedNodeIds : [node.id];
    if (!selectedNodeIds.includes(node.id)) onSelectNode(node.id, false);
    if (editingNodeId) return;
    e.stopPropagation();
    const origins = new Map<string, { x: number; y: number }>();
    for (const id of ids) {
      const at = base.byId.get(id);
      if (at) origins.set(id, { x: at.cx, y: at.cy });
    }
    groupOrigins.current = origins;
    nodeFree.start(e, node.id);
  };
  const startStickyDrag = (e: React.PointerEvent, sticky: PositionedSticky) => {
    if (editingStickyId) return;
    e.stopPropagation();
    if (!stickies.some((s) => s.id === sticky.id)) return;
    stickyFree.start(e, sticky.id);
  };
  const clearSelection = () => {
    if (justDragged.current || marquee.consumeClick()) return;
    onSelectNode(null, false);
    onSelectEdge(null);
    onSelectSticky(null);
  };

  const hovered = hoverId && !dragging ? (layout.byId.get(hoverId) ?? null) : null;
  const focusedNodeId = selectedNodeIds[selectedNodeIds.length - 1] ?? null;
  const handleNodes = edgeDrag.drag || dragging ? [] : [hoverId, focusedNodeId];
  const ghostKey =
    edgeDrag.drag?.mode === "reattach" && edgeDrag.drag.edge
      ? `${edgeDrag.drag.edge.from}->${edgeDrag.drag.edge.to}`
      : null;

  return (
    <DiagramSurface
      view={view}
      grabbing={Boolean(nodeFree.drag) || Boolean(edgeDrag.drag) || Boolean(marquee.marquee)}
      onBackgroundClick={clearSelection}
      onBackgroundPointerDown={marquee.onPointerDown}
      menu={<ClipboardMenuItems onPaste={clipboard.onPaste} canPaste={clipboard.canPaste} />}
      onBackgroundDoubleClick={(e) => {
        const at = toDiagram(e.clientX, e.clientY);
        onAddAt(at.x, at.y);
      }}
    >
      {layout.edges.map((edge) => (
        <EdgeArrow
          key={edge.key}
          geometry={edge.geometry}
          head={edge.head}
          {...(edge.label ? { label: edge.label } : {})}
          {...(edge.labelBox ? { labelBox: edge.labelBox } : {})}
          labelFontSize={EDGE_LABEL_FONT_SIZE}
          selected={edge.key === selectedEdgeKey}
          faded={edge.key === ghostKey}
          onSelect={() => onSelectEdge(edge.key)}
          onStartLabelEdit={() => onSelectEdge(edge.key)}
          onEndPointerDown={(e, end) =>
            edgeDrag.startReattach(e, { from: edge.from, to: edge.to }, end)
          }
        />
      ))}

      {layout.nodes.map((node) => {
        const editing = node.id === editingNodeId;
        const symbol = symbolOfKind(node.kind);
        const stroke = node.color ? COLOR_HEX[node.color] : undefined;
        const isDragged = dragging?.id === node.id;
        const isTarget = edgeDrag.drag?.overId === node.id;
        const showHandles = handleNodes.includes(node.id);
        const bubble = layout.bubbleOf.get(node.id);
        const person = symbol.bubble;
        return (
          <NodeClipboardMenu
            key={node.id}
            svg
            canPaste={clipboard.canPaste}
            onCopy={() => clipboard.onCopy(node.id)}
            onDuplicate={() => clipboard.onDuplicate(node.id)}
            onPaste={clipboard.onPaste}
          >
            <g
              opacity={isDragged ? 0.85 : 1}
              className="cursor-pointer"
              onPointerDown={(e) => startNodeDrag(e, node)}
              onPointerEnter={() => setHoverId(node.id)}
              onPointerLeave={() => setHoverId((h) => (h === node.id ? null : h))}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onStartEditNode(node.id);
              }}
            >
              {/* The whole box answers the pointer, a person's name included
                  (the icon outline alone is a small target). */}
              {person && (
                <rect
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                  fill="transparent"
                />
              )}
              <ShapeOutline
                shape={node.shape}
                box={node}
                className={cn(
                  symbol.text === "middle" ? "fill-card" : "fill-muted",
                  !stroke && (symbol.centre ? "stroke-foreground" : "stroke-muted-foreground"),
                )}
                stroke={stroke}
                strokeWidth={node.strokeWidth}
                strokeDasharray={node.dash}
              />
              {selectedNodeIds.includes(node.id) || isTarget ? (
                person ? (
                  <rect
                    x={node.x - 3}
                    y={node.y - 3}
                    width={node.width + 6}
                    height={node.height + 6}
                    rx={6}
                    fill="none"
                    className="stroke-ring"
                    strokeWidth={2}
                    strokeDasharray={isTarget && !selectedNodeIds.includes(node.id) ? "4 3" : undefined}
                  />
                ) : (
                  <ShapeOutline
                    shape={node.shape}
                    box={node}
                    grow={3}
                    fill="none"
                    className="stroke-ring"
                    strokeWidth={2}
                    strokeDasharray={isTarget && !selectedNodeIds.includes(node.id) ? "4 3" : undefined}
                  />
                )
              ) : null}
              {editing ? (
                <foreignObject
                  x={node.cx - Math.max(node.width, 140) / 2}
                  y={nodeTextY(node, 0) - 20}
                  width={Math.max(node.width, 140)}
                  height={28}
                >
                  <NodeInput
                    value={draft}
                    onChange={setDraft}
                    onCommit={(value) => onCommitNodeTitle(node.id, value)}
                    onCancel={onCancelNodeEdit}
                  />
                </foreignObject>
              ) : (
                node.lines.map((line, i) => (
                  <text
                    key={`${node.id}-${i}`}
                    x={node.cx}
                    y={nodeTextY(node, i)}
                    textAnchor="middle"
                    fontSize={node.fontSize}
                    fontWeight={node.bold ? 600 : undefined}
                    className="fill-foreground select-none"
                  >
                    {line}
                  </text>
                ))
              )}
              {bubble && <Bubble bubble={bubble} />}
              {node.task && !editing && (
                <text
                  x={node.cx}
                  y={node.y + node.height + 13}
                  textAnchor="middle"
                  fontSize={10}
                  strokeWidth={3}
                  paintOrder="stroke"
                  className="fill-muted-foreground stroke-background font-mono select-none"
                >
                  {node.task}
                </text>
              )}
              {showHandles && !editing && (
                <ArrowHandles
                  node={node}
                  onStart={(e) => {
                    if (e.button !== 0) return;
                    e.stopPropagation();
                    edgeDrag.startCreate(e, node.id);
                  }}
                />
              )}
            </g>
          </NodeClipboardMenu>
        );
      })}

      {edgeDrag.drag && <RubberBand drag={edgeDrag.drag} byId={layout.byId} />}

      {/* The marquee in flight: everything it touches joins the selection on release. */}
      {marquee.marquee && (
        <rect
          x={marquee.marquee.x0}
          y={marquee.marquee.y0}
          width={marquee.marquee.x1 - marquee.marquee.x0}
          height={marquee.marquee.y1 - marquee.marquee.y0}
          className="fill-ring/10 stroke-ring"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          pointerEvents="none"
        />
      )}

      {/* Stickies are drawn last, so a note the user dropped over a node stays
          readable instead of disappearing under it. */}
      {layout.stickies.map((sticky) => (
        <StickyPaper
          key={sticky.id}
          sticky={sticky}
          offsetX={stickyFree.drag?.active && stickyFree.drag.id === sticky.id ? stickyFree.drag.dx : 0}
          offsetY={stickyFree.drag?.active && stickyFree.drag.id === sticky.id ? stickyFree.drag.dy : 0}
          selected={sticky.id === selectedStickyId}
          editing={sticky.id === editingStickyId}
          onSelect={onSelectSticky}
          onStartEdit={onStartEditSticky}
          onCommit={onCommitStickyText}
          onCancel={onCancelStickyEdit}
          onDragStart={startStickyDrag}
        />
      ))}

      {hovered?.note && !editingNodeId && !edgeDrag.drag && (
        <NoteTip box={hovered} note={hovered.note} />
      )}
    </DiagramSurface>
  );
}
