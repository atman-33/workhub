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
import {
  hitNode,
  portOfDrop,
  type EdgePort,
} from "@/lib/diagram/node-edge";
import { idsInRect, shiftPositions } from "@/lib/diagram/multi-select";
import type { Sticky } from "@/lib/diagram/sticky";
import type { PositionedSticky } from "@/lib/diagram/sticky-layout";
import {
  EDGE_LABEL_FONT_SIZE,
  FRAME_HEADER,
  FRAME_TITLE_FONT_SIZE,
  layoutArchitecture,
  nodeTextY,
  type ArchitectureLayout,
  type PositionedFrame,
  type PositionedNode,
} from "@/lib/diagram/architecture/layout";
import type { ArchitectureDocModel } from "@/lib/diagram/architecture/parse";
import { symbolOfKind } from "@/lib/diagram/architecture/symbols";
import { cn } from "@/lib/utils";

/**
 * The architecture canvas (T-0710), copied from the use case canvas.
 *
 * Draws `layoutArchitecture`'s output as SVG - the same geometry the exports
 * render - and owns exactly one piece of state the file does not: the camera
 * (plus the transient hover and the gestures in flight). What is selected and
 * what the note contains belong to the view above.
 *
 * - **frames are background**: a frame is drawn under the arrows, clicked to
 *   select, double-clicked on its header to rename. Dragging a frame's header
 *   moves every member; a frame is never a marquee node - the marquee tests
 *   block boxes only, and a press on a frame never arms it (frames answer the
 *   pointer with selection and stop the press there);
 * - **left-drag on a block moves it**, alone or with the rest of the selection
 *   (Shift+click grows the selection; dragging any selected block moves them
 *   all, reported once on release so one undo step restores them). A lone drop
 *   may move the block across a frame border; a group drag keeps every
 *   membership and the frames stretch and shrink after it instead;
 * - **left-drag on empty canvas draws a marquee** selecting every block it
 *   touches (Shift held: added to the selection instead);
 * - **a handle on a hovered block** drags out a new arrow onto another block,
 *   and any other block is highlighted as a target. Arrows never join frames;
 * - **the end handles of a selected arrow** re-attach that end the same way;
 * - **double-click on empty canvas adds a block** of the chosen kind there
 *   (outside every frame); on a block it renames it, on an arrow it selects
 *   it (label and direction are set in the side panel);
 * - right-drag pans and the wheel zooms (the shared camera).
 */
interface Props {
  doc: ArchitectureDocModel;
  /** Sticky notes to draw. Empty while the note hides them. */
  stickies: Sticky[];
  /** The layout of `doc` as it stands (the view needs it for edits too). */
  layout: ArchitectureLayout;
  /** The ordered selection; the ring is drawn on every entry. */
  selectedNodeIds: string[];
  selectedFrameId: string | null;
  selectedEdgeKey: string | null;
  selectedStickyId: string | null;
  editingNodeId: string | null;
  editingFrameId: string | null;
  editingStickyId: string | null;
  /** A click on a block: plain replaces the selection, Shift toggles it. */
  onSelectNode: (id: string | null, additive: boolean) => void;
  /** A finished marquee: the caught ids replace the selection, or join it with Shift. */
  onSelectMarquee: (ids: string[], additive: boolean) => void;
  onSelectFrame: (id: string | null) => void;
  onSelectEdge: (key: string | null) => void;
  onSelectSticky: (id: string | null) => void;
  onStartEditNode: (id: string) => void;
  onCommitNodeTitle: (id: string, title: string) => void;
  onCancelNodeEdit: () => void;
  onStartEditFrame: (id: string) => void;
  onCommitFrameTitle: (id: string, title: string) => void;
  onCancelFrameEdit: () => void;
  onStartEditSticky: (id: string) => void;
  onCommitStickyText: (id: string, text: string) => void;
  onCancelStickyEdit: () => void;
  /** A finished sticky drag: the new offset from its target's centre. */
  onMoveSticky: (id: string, dx: number, dy: number) => void;
  /** A finished lone-block drag: where its centre was dropped (may join another frame). */
  onMoveNode: (id: string, cx: number, cy: number) => void;
  /** A finished group drag: the new centres of every moved block (frames kept). */
  onMoveNodes: (moves: ReadonlyMap<string, { x: number; y: number }>) => void;
  /** A finished frame drag: how far every member travelled. */
  onMoveFrame: (id: string, dx: number, dy: number) => void;
  /** A double-click on empty canvas: add a block centred here (in the frame under it, if any). */
  onAddAt: (x: number, y: number, frameId: string | undefined) => void;
  onConnect: (
    from: string,
    to: string,
    ports?: { fromPort?: EdgePort; toPort?: EdgePort },
  ) => void;
  onReattach: (
    edge: { from: string; to: string; bidi: boolean },
    end: "from" | "to",
    nodeId: string,
    port: EdgePort | null,
  ) => void;
  /** Copy, duplicate and paste, offered in the right-click menus. */
  clipboard: CanvasClipboard;
  /** Bumped by the view to re-fit (a new note, or the Fit button). */
  fitToken: number;
}

/** One frame: a thin border over a wash of its colour, with the title in the header band. */
function FrameShape({ frame, selected }: { frame: PositionedFrame; selected: boolean }) {
  const hex = frame.color ? COLOR_HEX[frame.color] : undefined;
  return (
    <g>
      <rect
        x={frame.x}
        y={frame.y}
        width={frame.width}
        height={frame.height}
        fill={hex ?? "#808080"}
        fillOpacity={hex ? 0.08 : 0.05}
        stroke={hex}
        strokeWidth={1}
        className={cn(!hex && "stroke-border")}
      />
      <text
        x={frame.x + 10}
        y={frame.y + FRAME_HEADER / 2 + FRAME_TITLE_FONT_SIZE * 0.36}
        fontSize={FRAME_TITLE_FONT_SIZE}
        className="fill-foreground select-none"
      >
        {frame.title}
      </text>
      {selected && (
        <rect
          x={frame.x - 3}
          y={frame.y - 3}
          width={frame.width + 6}
          height={frame.height + 6}
          rx={6}
          fill="none"
          className="stroke-ring"
          strokeWidth={2}
        />
      )}
    </g>
  );
}

export function ArchitectureCanvas({
  doc,
  stickies,
  layout: base,
  selectedNodeIds,
  selectedFrameId,
  selectedEdgeKey,
  selectedStickyId,
  editingNodeId,
  editingFrameId,
  editingStickyId,
  onSelectNode,
  onSelectMarquee,
  onSelectFrame,
  onSelectEdge,
  onSelectSticky,
  onStartEditNode,
  onCommitNodeTitle,
  onCancelNodeEdit,
  onStartEditFrame,
  onCommitFrameTitle,
  onCancelFrameEdit,
  onStartEditSticky,
  onCommitStickyText,
  onCancelStickyEdit,
  onMoveSticky,
  onMoveNode,
  onMoveNodes,
  onMoveFrame,
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
  /** The pinned exit side a port-handle drag carries, if any. */
  const pendingPort = useRef<EdgePort | null>(null);
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
      groupOrigins.current = new Map();
      const ids = [...origins.keys()];
      if (!ids.length) return;
      if (ids.length === 1) {
        // A lone block keeps the old drop: released over another frame it
        // joins that frame (`reparentByDrop` rewrites `frame:`).
        const node = base.byId.get(d.id);
        if (node) onMoveNode(d.id, node.cx + d.dx, node.cy + d.dy);
      } else {
        onMoveNodes(
          shiftPositions(origins, ids, d.dx, d.dy, (x, y) => ({
            x: Math.round(x),
            y: Math.round(y),
          })),
        );
      }
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
  const frameFree = useFreeDrag({
    toDiagram,
    zoom: camera.zoom,
    onEnd: (d) => {
      onMoveFrame(d.id, d.dx, d.dy);
      swallowClick();
    },
  });

  const marquee = useMarquee({
    toDiagram,
    zoom: camera.zoom,
    // Blocks only: frames are never nodes, so a marquee over a frame catches
    // its members but never the frame itself - and a press on a frame header
    // never reaches the background to arm the marquee at all.
    onMarquee: (rect, additive) => onSelectMarquee(idsInRect(base.nodes, rect), additive),
  });

  /** Centres of the drag's group, snapshotted when the press landed. */
  const groupOrigins = useRef(new Map<string, { x: number; y: number }>());

  // While blocks are dragged, the layout is recomputed with the whole group
  // at the pointer, so their arrows follow live and the frames stretch and
  // shrink around them instead of jumping on release. A lone block is pinned
  // raw (it may be joining another frame); a group moves with every
  // membership kept (see `moveNodesTo`).
  const dragging = nodeFree.drag?.active ? nodeFree.drag : null;
  const frameDragging = !dragging && frameFree.drag?.active ? frameFree.drag : null;
  const layout = useMemo(() => {
    if (dragging) {
      const ids = [...groupOrigins.current.keys()];
      if (!ids.length) return base;
      if (ids.length === 1) {
        const node = base.byId.get(dragging.id);
        if (!node) return base;
        return layoutArchitecture(doc, stickies, {
          pinned: [{ id: dragging.id, cx: node.cx + dragging.dx, cy: node.cy + dragging.dy }],
        });
      }
      const moves = shiftPositions(
        groupOrigins.current,
        ids,
        dragging.dx,
        dragging.dy,
        (x, y) => ({ x: Math.round(x), y: Math.round(y) }),
      );
      return layoutArchitecture(
        {
          ...doc,
          nodes: doc.nodes.map((n) => {
            const at = moves.get(n.id);
            return at ? { ...n, x: at.x, y: at.y } : n;
          }),
        },
        stickies,
      );
    }
    if (frameDragging) {
      const pins: { id: string; cx: number; cy: number }[] = [];
      for (const n of doc.nodes) {
        if (n.frame !== frameDragging.id) continue;
        const laid = base.byId.get(n.id);
        if (!laid) continue;
        pins.push({ id: n.id, cx: laid.cx + frameDragging.dx, cy: laid.cy + frameDragging.dy });
      }
      return layoutArchitecture(doc, stickies, { pinned: pins });
    }
    return base;
  }, [base, dragging, frameDragging, doc, stickies]);

  const edgeDrag = useEdgeDrag({
    toDiagram,
    nodeAt: (p) => hitNode(layout.nodes, p)?.id ?? null,
    // Any block but the arrow's own anchor lights up (no connection rules, and never a frame).
    canJoin: (d, overId) => overId !== d.anchorId,
    onDrop: (d, overId) => {
      const over = layout.byId.get(overId);
      if (!over) {
        pendingPort.current = null;
        return;
      }
      // The drop point decides the entering side wherever it lands on the node;
      // the middle stays automatic.
      const toPort = portOfDrop(over, d.pointer);
      if (d.mode === "create") {
        onConnect(d.anchorId, overId, {
          ...(pendingPort.current ? { fromPort: pendingPort.current } : {}),
          ...(toPort ? { toPort } : {}),
        });
        pendingPort.current = null;
      } else if (d.edge && d.end) {
        // The drag only carries the ends; the direction flag is read back from
        // the note (a two-way arrow is stored as written).
        const full = doc.edges.find((e) => e.from === d.edge!.from && e.to === d.edge!.to);
        onReattach(
          { from: d.edge.from, to: d.edge.to, bidi: full?.bidi ?? false },
          d.end,
          overId,
          toPort ?? null,
        );
      }
      swallowClick();
    },
  });

  // Re-seeded when the rename target changes, not when the layout does - the
  // layout changes on every keystroke via the draft itself.
  useEffect(() => {
    if (editingNodeId) setDraft(base.byId.get(editingNodeId)?.title ?? "");
    else if (editingFrameId) setDraft(base.frameById.get(editingFrameId)?.title ?? "");
    else setDraft("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingNodeId, editingFrameId]);

  const startNodeDrag = (e: React.PointerEvent, node: PositionedNode) => {
    if (e.button !== 0) return;
    // Shift+click grows or shrinks the selection instead of dragging.
    if (e.shiftKey) {
      onSelectNode(node.id, true);
      return;
    }
    // Dragging a selected block moves the whole group; anywhere else starts
    // over with this block alone.
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
    onSelectFrame(null);
    onSelectEdge(null);
    onSelectSticky(null);
  };

  const hovered = hoverId && !dragging && !frameDragging ? (layout.byId.get(hoverId) ?? null) : null;
  const focusedNodeId = selectedNodeIds[selectedNodeIds.length - 1] ?? null;
  const handleNodes = edgeDrag.drag || dragging || frameDragging ? [] : [hoverId, focusedNodeId];
  // The node a dragged arrow would land on, if any, and the node it keeps.
  const dropTarget =
    edgeDrag.drag?.overId ? (layout.byId.get(edgeDrag.drag.overId) ?? null) : null;
  const dragAnchor =
    edgeDrag.drag?.anchorId ? (layout.byId.get(edgeDrag.drag.anchorId) ?? null) : null;
  // The arrow being re-attached draws pale: matched by its ends, since a
  // two-way arrow's key is not its written direction.
  const ghostFrom = edgeDrag.drag?.mode === "reattach" ? edgeDrag.drag.edge?.from : null;
  const ghostTo = edgeDrag.drag?.mode === "reattach" ? edgeDrag.drag.edge?.to : null;

  return (
    <DiagramSurface
      view={view}
      grabbing={Boolean(nodeFree.drag) || Boolean(frameFree.drag) || Boolean(edgeDrag.drag) || Boolean(marquee.marquee)}
      onBackgroundClick={clearSelection}
      onBackgroundPointerDown={marquee.onPointerDown}
      menu={<ClipboardMenuItems onPaste={clipboard.onPaste} canPaste={clipboard.canPaste} />}
      onBackgroundDoubleClick={(e) => {
        const at = toDiagram(e.clientX, e.clientY);
        // The topmost frame under the pointer adopts the block; blocks answer
        // the pointer themselves, so this is always an empty spot.
        let frameId: string | undefined;
        for (let i = layout.frames.length - 1; i >= 0; i--) {
          const f = layout.frames[i];
          if (at.x >= f.x && at.x <= f.x + f.width && at.y >= f.y && at.y <= f.y + f.height) {
            frameId = f.id;
            break;
          }
        }
        onAddAt(at.x, at.y, frameId);
      }}
    >
      {layout.frames.map((frame) => (
        <g
          key={frame.id}
          className="cursor-pointer"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            onSelectFrame(frame.id);
            // A press that travels becomes a frame drag (every member moves);
            // a press that does not is a click, and only selects.
            if (!editingFrameId) frameFree.start(e, frame.id);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            onStartEditFrame(frame.id);
          }}
        >
          <FrameShape frame={frame} selected={frame.id === selectedFrameId} />
          {frame.id === editingFrameId && (
            <foreignObject x={frame.x + 4} y={frame.y + 2} width={Math.max(frame.width - 8, 140)} height={28}>
              <NodeInput
                value={draft}
                onChange={setDraft}
                onCommit={(value) => onCommitFrameTitle(frame.id, value)}
                onCancel={onCancelFrameEdit}
              />
            </foreignObject>
          )}
        </g>
      ))}

      {layout.edges.map((edge) => (
        <EdgeArrow
          key={edge.key}
          geometry={edge.geometry}
          startHead={edge.bidi}
          startAngle={edge.startAngle}
          {...(edge.label ? { label: edge.label } : {})}
          {...(edge.labelBox ? { labelBox: edge.labelBox } : {})}
          labelFontSize={EDGE_LABEL_FONT_SIZE}
          selected={edge.key === selectedEdgeKey}
          faded={edge.from === ghostFrom && edge.to === ghostTo}
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
        const person = symbol.text === "below-icon";
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
                className={cn("fill-card", !stroke && "stroke-muted-foreground")}
                stroke={stroke}
                strokeWidth={node.strokeWidth}
              />
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
                    className="fill-foreground select-none"
                  >
                    {line}
                  </text>
                ))
              )}
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

      {edgeDrag.drag && <RubberBand drag={edgeDrag.drag} byId={layout.byId} />}
      {dragAnchor && edgeDrag.drag && (
        <DropSpots node={dragAnchor} pointer={edgeDrag.drag.pointer} />
      )}
      {dropTarget && edgeDrag.drag && (
        <DropSpots node={dropTarget} pointer={edgeDrag.drag.pointer} />
      )}

      {/* The marquee in flight: every block it touches joins the selection on release. */}
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
