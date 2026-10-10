import { useEffect, useMemo, useRef, useState } from "react";
import { DropSpots, PortHandles, RubberBand } from "@/components/diagram/arrow-handles";
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
import { idsInRect, shiftPositions } from "@/lib/diagram/multi-select";
import { hitNode, portOfDrop, type EdgePort } from "@/lib/diagram/node-edge";
import {
  EDGE_LABEL_FONT_SIZE,
  ITEM_LINE_HEIGHT,
  layoutIfdam,
  NODE_FONT_SIZE,
  nodeTextY,
  SCREEN_BULLET_WIDTH,
  SCREEN_CAPTION_FONT_SIZE,
  SCREEN_ITEM_FONT_SIZE,
  SCREEN_PAD_X,
  SCREEN_TITLE_FONT_SIZE,
  TITLE_LINE_HEIGHT,
  type IfdamLayout,
  type PositionedNode,
} from "@/lib/diagram/ifdam/layout";
import type { IfdamDocModel } from "@/lib/diagram/ifdam/parse";
import { useT } from "@/lib/i18n";
import type { Sticky } from "@/lib/diagram/sticky";
import type { PositionedSticky } from "@/lib/diagram/sticky-layout";
import { cn } from "@/lib/utils";

/**
 * The IFDAM canvas (T-0704), copied from the program-flow canvas.
 *
 * Draws `layoutIfdam`'s output as SVG - the same geometry the exports render -
 * and owns exactly one piece of state the file does not: the camera (plus the
 * transient hover and the gestures in flight). What is selected and what the
 * note contains belong to the view above.
 *
 * - **left-drag on a node moves it**, alone or with the rest of the selection
 *   (Shift+click grows the selection; dragging any selected node moves them
 *   all, reported once on release so one undo step restores them);
 * - **left-drag on empty canvas draws a marquee** selecting every node it
 *   touches (Shift held: added to the selection instead);
 * - **a handle on a hovered node** drags out a new arrow onto another node, and
 *   any other node is highlighted as a target;
 * - **the end handles of a selected arrow** re-attach that end the same way;
 * - **double-click on empty canvas adds a node** of the chosen symbol there; on
 *   a node it renames it, on an arrow it selects it (the label is set in the
 *   side panel);
 * - right-drag pans and the wheel zooms (the shared camera).
 */
interface Props {
  doc: IfdamDocModel;
  /** Sticky notes to draw. Empty while the note hides them. */
  stickies: Sticky[];
  /** The layout of `doc` as it stands (the view needs it for edits too). */
  layout: IfdamLayout;
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
  onConnect: (
    from: string,
    to: string,
    ports?: { fromPort?: EdgePort; toPort?: EdgePort },
  ) => void;
  onReattach: (
    edge: { from: string; to: string },
    end: "from" | "to",
    nodeId: string,
    port: EdgePort | null,
  ) => void;
  /** Copy, duplicate and paste, offered in the right-click menus. */
  clipboard: CanvasClipboard;
  /** Bumped by the view to re-fit (a new note, or the Fit button). */
  fitToken: number;
}

export function IfdamCanvas({
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
  const t = useT();
  // A screen's section names, in the display language; the file does not carry them.
  const captions = {
    show: t("diagram.ifdam.section.show"),
    input: t("diagram.ifdam.section.input"),
    action: t("diagram.ifdam.section.action"),
  };
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

  /** The pinned exit side a port-handle drag carries, if any. */
  const pendingPort = useRef<EdgePort | null>(null);

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
  // the pointer, so their arrows and stickies follow live instead of jumping
  // on release. The moved nodes are laid over the document as `@` positions -
  // the layout reads those directly, so loops and router detours route round
  // several moved nodes at once, and a screen's continuation lines travel with
  // its node untouched.
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
    return layoutIfdam(
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
    // Any node but the arrow's own anchor lights up (no connection rules).
    canJoin: (d, overId) => overId !== d.anchorId,
    onDrop: (d, overId) => {
      const over = layout.byId.get(overId);
      if (!over) {
        pendingPort.current = null;
        return;
      }
      // The drop point decides the entering side wherever it lands on the
      // node; the middle stays automatic.
      const toPort = portOfDrop(over, d.pointer);
      if (d.mode === "create") {
        onConnect(d.anchorId, overId, {
          ...(pendingPort.current ? { fromPort: pendingPort.current } : {}),
          ...(toPort ? { toPort } : {}),
        });
        pendingPort.current = null;
      } else if (d.edge && d.end) {
        onReattach(d.edge, d.end, overId, toPort ?? null);
      }
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
  // The nodes a dragged arrow keeps and would land on, if any.
  const dropTarget =
    edgeDrag.drag?.overId ? (layout.byId.get(edgeDrag.drag.overId) ?? null) : null;
  const dragAnchor =
    edgeDrag.drag?.anchorId ? (layout.byId.get(edgeDrag.drag.anchorId) ?? null) : null;
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
        const stroke = node.color ? COLOR_HEX[node.color] : undefined;
        const isDragged = dragging?.id === node.id;
        const isTarget = edgeDrag.drag?.overId === node.id;
        const showHandles = handleNodes.includes(node.id);
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
            <ShapeOutline
              shape={node.shape}
              box={node}
              rules={node.rules}
              className={cn("fill-card", !stroke && "stroke-border")}
              stroke={stroke}
              strokeWidth={1.5}
            />
            {/* A screen: a light band behind the title, then the sections - the
                same drawing as the exports' renderScreen. */}
            {node.kind === "screen" && node.band > 0 && (
              <rect
                x={node.x + 1}
                y={node.y + 1}
                width={node.width - 2}
                height={node.band - 1}
                className={node.color ? undefined : "fill-muted"}
                fill={node.color ? COLOR_HEX[node.color] : undefined}
                fillOpacity={node.color ? 0.2 : undefined}
              />
            )}
            {(selectedNodeIds.includes(node.id) || isTarget) && (
              <ShapeOutline
                shape={node.shape}
                box={node}
                grow={3}
                fill="none"
                className="stroke-ring"
                strokeWidth={2}
                strokeDasharray={isTarget && !selectedNodeIds.includes(node.id) ? "4 3" : undefined}
              />
            )}
            {editing ? (
              node.kind === "screen" ? (
                <foreignObject
                  x={node.x + 4}
                  y={node.y + node.titleTop - 4}
                  width={node.width - 8}
                  height={TITLE_LINE_HEIGHT + 8}
                >
                  <NodeInput
                    value={draft}
                    onChange={setDraft}
                    onCommit={(value) => onCommitNodeTitle(node.id, value)}
                    onCancel={onCancelNodeEdit}
                  />
                </foreignObject>
              ) : (
                <foreignObject
                  x={node.cx - Math.max(node.width, 140) / 2}
                  y={node.cy - 14}
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
              )
            ) : node.kind === "screen" ? (
              node.lines.map((line, i) => (
                <text
                  key={`${node.id}-${i}`}
                  x={node.x + SCREEN_PAD_X}
                  y={nodeTextY(node, i)}
                  fontSize={SCREEN_TITLE_FONT_SIZE}
                  fontWeight={600}
                  className="fill-foreground select-none"
                >
                  {line}
                </text>
              ))
            ) : (
              node.lines.map((line, i) => (
                <text
                  key={`${node.id}-${i}`}
                  x={node.cx}
                  y={nodeTextY(node, i)}
                  textAnchor="middle"
                  fontSize={NODE_FONT_SIZE}
                  className="fill-foreground select-none"
                >
                  {line}
                </text>
              ))
            )}
            {node.kind === "screen" &&
              node.sections.map((section) => (
                <g key={`${node.id}-${section.key}`}>
                  <text
                    x={node.x + SCREEN_PAD_X}
                    y={node.y + section.captionY}
                    fontSize={SCREEN_CAPTION_FONT_SIZE}
                    className="fill-muted-foreground select-none"
                  >
                    {captions[section.key]}
                  </text>
                  {section.items.map((item, n) => (
                    <g key={n}>
                      <text
                        x={node.x + SCREEN_PAD_X}
                        y={node.y + item.y}
                        fontSize={SCREEN_ITEM_FONT_SIZE}
                        className="fill-foreground select-none"
                      >
                        ・
                      </text>
                      {item.lines.map((line, i) => (
                        <text
                          key={i}
                          x={node.x + SCREEN_PAD_X + SCREEN_BULLET_WIDTH}
                          y={node.y + item.y + i * ITEM_LINE_HEIGHT}
                          fontSize={SCREEN_ITEM_FONT_SIZE}
                          className="fill-foreground select-none"
                        >
                          {line}
                        </text>
                      ))}
                    </g>
                  ))}
                </g>
              ))}
            {node.task && !editing && (
              <text
                x={node.cx}
                y={node.y - 5}
                textAnchor="middle"
                fontSize={10}
                className="fill-muted-foreground font-mono select-none"
              >
                {node.task}
              </text>
            )}
            {showHandles && !editing && (
              <PortHandles
                node={node}
                onStart={(e, side) => {
                  if (e.button !== 0) return;
                  e.stopPropagation();
                  pendingPort.current = { side };
                  edgeDrag.startCreate(e, node.id);
                }}
              />
            )}
          </g>
          </NodeClipboardMenu>
        );
      })}

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

      {edgeDrag.drag && <RubberBand drag={edgeDrag.drag} byId={layout.byId} />}
      {dragAnchor && edgeDrag.drag && (
        <DropSpots node={dragAnchor} pointer={edgeDrag.drag.pointer} />
      )}
      {dropTarget && edgeDrag.drag && (
        <DropSpots node={dropTarget} pointer={edgeDrag.drag.pointer} />
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
