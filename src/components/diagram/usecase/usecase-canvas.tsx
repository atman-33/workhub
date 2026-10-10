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
import { COLOR_HEX } from "@/lib/diagram/colors";
import { hitNode } from "@/lib/diagram/node-edge";
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
 * - **left-drag on a node moves it**; reported once, on release, for that node
 *   only (it is the only node that gets a `@`). A person's speech bubble is
 *   part of the person: pressing it selects (and drags) the person, and it
 *   follows the person while dragged;
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
  selectedNodeId: string | null;
  selectedEdgeKey: string | null;
  selectedStickyId: string | null;
  editingNodeId: string | null;
  editingStickyId: string | null;
  onSelectNode: (id: string | null) => void;
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
  /** A finished node drag: where its centre was dropped. */
  onMoveNode: (id: string, cx: number, cy: number) => void;
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
  selectedNodeId,
  selectedEdgeKey,
  selectedStickyId,
  editingNodeId,
  editingStickyId,
  onSelectNode,
  onSelectEdge,
  onSelectSticky,
  onStartEditNode,
  onCommitNodeTitle,
  onCancelNodeEdit,
  onStartEditSticky,
  onCommitStickyText,
  onCancelStickyEdit,
  onMoveSticky,
  onMoveNode,
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
      const node = base.byId.get(d.id);
      if (node) onMoveNode(d.id, node.cx + d.dx, node.cy + d.dy);
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

  // While a node is dragged, the layout is recomputed with it at the pointer,
  // so its lines, bubble and stickies follow it live instead of jumping on release.
  const dragging = nodeFree.drag?.active ? nodeFree.drag : null;
  const layout = useMemo(() => {
    if (!dragging) return base;
    const node = base.byId.get(dragging.id);
    if (!node) return base;
    return layoutUsecase(doc, stickies, {
      pinned: { id: dragging.id, cx: node.cx + dragging.dx, cy: node.cy + dragging.dy },
    });
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
    onSelectNode(node.id);
    if (editingNodeId) return;
    e.stopPropagation();
    nodeFree.start(e, node.id);
  };
  const startStickyDrag = (e: React.PointerEvent, sticky: PositionedSticky) => {
    if (editingStickyId) return;
    e.stopPropagation();
    if (!stickies.some((s) => s.id === sticky.id)) return;
    stickyFree.start(e, sticky.id);
  };
  const clearSelection = () => {
    if (justDragged.current) return;
    onSelectNode(null);
    onSelectEdge(null);
    onSelectSticky(null);
  };

  const hovered = hoverId && !dragging ? (layout.byId.get(hoverId) ?? null) : null;
  const handleNodes = edgeDrag.drag || dragging ? [] : [hoverId, selectedNodeId];
  const ghostKey =
    edgeDrag.drag?.mode === "reattach" && edgeDrag.drag.edge
      ? `${edgeDrag.drag.edge.from}->${edgeDrag.drag.edge.to}`
      : null;

  return (
    <DiagramSurface
      view={view}
      grabbing={Boolean(nodeFree.drag) || Boolean(edgeDrag.drag)}
      onBackgroundClick={clearSelection}
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
              {node.id === selectedNodeId || isTarget ? (
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
                    strokeDasharray={isTarget && node.id !== selectedNodeId ? "4 3" : undefined}
                  />
                ) : (
                  <ShapeOutline
                    shape={node.shape}
                    box={node}
                    grow={3}
                    fill="none"
                    className="stroke-ring"
                    strokeWidth={2}
                    strokeDasharray={isTarget && node.id !== selectedNodeId ? "4 3" : undefined}
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
