import { useEffect, useMemo, useRef, useState } from "react";
import { RubberBand } from "@/components/diagram/arrow-handles";
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
import { HANDLE_RADIUS } from "@/components/diagram/edge-arrow";
import {
  boundaryPoint,
  hitNode,
  portOfDrop,
  type EdgePort,
  type Point,
  type PortSide,
} from "@/lib/diagram/node-edge";
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
 *   select, double-clicked on its header to rename. Dragging a frame (moving
 *   every member) is later work (T-0711): a frame answers the pointer with
 *   selection only;
 * - **left-drag on a block moves it**; reported once, on release, for that
 *   block only (it is the only block that gets a `@`);
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
  selectedNodeId: string | null;
  selectedFrameId: string | null;
  selectedEdgeKey: string | null;
  selectedStickyId: string | null;
  editingNodeId: string | null;
  editingFrameId: string | null;
  editingStickyId: string | null;
  onSelectNode: (id: string | null) => void;
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
  /** A finished block drag: where its centre was dropped. */
  onMoveNode: (id: string, cx: number, cy: number) => void;
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
    port: EdgePort,
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

/** The four round handles on the sides of a block, each naming its side;
 * pressing one starts an arrow pinned to that side. */
function PortHandles({
  node,
  onStart,
}: {
  node: PositionedNode;
  onStart: (e: React.PointerEvent, side: PortSide) => void;
}) {
  const c = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
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

export function ArchitectureCanvas({
  doc,
  stickies,
  layout: base,
  selectedNodeId,
  selectedFrameId,
  selectedEdgeKey,
  selectedStickyId,
  editingNodeId,
  editingFrameId,
  editingStickyId,
  onSelectNode,
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
  const frameFree = useFreeDrag({
    toDiagram,
    zoom: camera.zoom,
    onEnd: (d) => {
      onMoveFrame(d.id, d.dx, d.dy);
      swallowClick();
    },
  });

  // While a block is dragged, the layout is recomputed with it at the pointer,
  // so its arrows follow it live instead of jumping on release. While a frame
  // is dragged every member is held at the pointer the same way, so the frame
  // follows too.
  const dragging = nodeFree.drag?.active ? nodeFree.drag : null;
  const frameDragging = !dragging && frameFree.drag?.active ? frameFree.drag : null;
  const layout = useMemo(() => {
    if (dragging) {
      const node = base.byId.get(dragging.id);
      if (!node) return base;
      return layoutArchitecture(doc, stickies, {
        pinned: [{ id: dragging.id, cx: node.cx + dragging.dx, cy: node.cy + dragging.dy }],
      });
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
      // The drop point decides the entering side wherever it lands on the node.
      const toPort = portOfDrop(over, d.pointer);
      if (d.mode === "create") {
        onConnect(d.anchorId, overId, {
          ...(pendingPort.current ? { fromPort: pendingPort.current } : {}),
          toPort,
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
          toPort,
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
    onSelectFrame(null);
    onSelectEdge(null);
    onSelectSticky(null);
  };

  const hovered = hoverId && !dragging && !frameDragging ? (layout.byId.get(hoverId) ?? null) : null;
  const handleNodes = edgeDrag.drag || dragging || frameDragging ? [] : [hoverId, selectedNodeId];
  // The arrow being re-attached draws pale: matched by its ends, since a
  // two-way arrow's key is not its written direction.
  const ghostFrom = edgeDrag.drag?.mode === "reattach" ? edgeDrag.drag.edge?.from : null;
  const ghostTo = edgeDrag.drag?.mode === "reattach" ? edgeDrag.drag.edge?.to : null;

  return (
    <DiagramSurface
      view={view}
      grabbing={Boolean(nodeFree.drag) || Boolean(frameFree.drag) || Boolean(edgeDrag.drag)}
      onBackgroundClick={clearSelection}
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
              {(node.id === selectedNodeId || isTarget) && (
                <ShapeOutline
                  shape={node.shape}
                  box={node}
                  grow={3}
                  fill="none"
                  className="stroke-ring"
                  strokeWidth={2}
                  strokeDasharray={isTarget && node.id !== selectedNodeId ? "4 3" : undefined}
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
