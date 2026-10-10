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
import { COLOR_HEX } from "@/lib/diagram/colors";
import {
  bandHeaderText,
  EDGE_LABEL_FONT_SIZE,
  LANE_FONT_SIZE,
  layoutFlow,
  STEP_FONT_SIZE,
  stepTextY,
  type FlowLayout,
  type PositionedStep,
} from "@/lib/diagram/flow/layout";
import type { FlowDocModel } from "@/lib/diagram/flow/parse";
import { allowAnyConnection, hitNode, portOfDrop, type ConnectionRule, type EdgePort } from "@/lib/diagram/node-edge";
import type { Sticky } from "@/lib/diagram/sticky";
import type { PositionedSticky } from "@/lib/diagram/sticky-layout";
import { textWidth } from "@/lib/diagram/text";
import { cn } from "@/lib/utils";

/**
 * The business-flow canvas.
 *
 * Draws `layoutFlow`'s output as SVG - the same geometry the exports render -
 * and owns exactly one piece of state the file does not: the camera (plus the
 * transient hover and the gestures in flight). What is selected and what the
 * note contains belong to the view above.
 *
 * - **left-drag on a step moves it**; released over another lane it joins that
 *   lane. Reported once, on release, for that step only;
 * - **a handle on a hovered step** drags out a new arrow onto another step;
 * - **the end handles of a selected arrow** re-attach that end to another step;
 * - **double-click on a lane adds a step** there, on a step or an arrow
 *   renames it;
 * - right-drag pans and the wheel zooms (the shared camera).
 */
interface Props {
  doc: FlowDocModel;
  /** Sticky notes to draw. Empty while the note hides them. */
  stickies: Sticky[];
  /** The layout of `doc` as it stands (the view needs it for edits too). */
  layout: FlowLayout;
  unassignedLabel: string;
  selectedStepId: string | null;
  selectedEdgeKey: string | null;
  selectedStickyId: string | null;
  editingStepId: string | null;
  editingEdgeKey: string | null;
  editingStickyId: string | null;
  canConnect?: ConnectionRule;
  onSelectStep: (id: string | null) => void;
  onSelectEdge: (key: string | null) => void;
  onSelectSticky: (id: string | null) => void;
  onStartEditStep: (id: string) => void;
  onCommitStepTitle: (id: string, title: string) => void;
  onCancelStepEdit: () => void;
  onStartEditEdge: (key: string) => void;
  onCommitEdgeLabel: (key: string, label: string) => void;
  onCancelEdgeEdit: () => void;
  onStartEditSticky: (id: string) => void;
  onCommitStickyText: (id: string, text: string) => void;
  onCancelStickyEdit: () => void;
  /** A finished sticky drag: the new offset from its step's centre. */
  onMoveSticky: (id: string, dx: number, dy: number) => void;
  /** A finished step drag: where its centre was dropped. */
  onMoveStep: (id: string, cx: number, cy: number) => void;
  /** A double-click on a lane: add a step at this x and offset from the lane's middle. */
  onAddAt: (bandKey: string, x: number, y: number) => void;
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

export function FlowCanvas({
  doc,
  stickies,
  layout: base,
  unassignedLabel,
  selectedStepId,
  selectedEdgeKey,
  selectedStickyId,
  editingStepId,
  editingEdgeKey,
  editingStickyId,
  canConnect = allowAnyConnection,
  onSelectStep,
  onSelectEdge,
  onSelectSticky,
  onStartEditStep,
  onCommitStepTitle,
  onCancelStepEdit,
  onStartEditEdge,
  onCommitEdgeLabel,
  onCancelEdgeEdit,
  onStartEditSticky,
  onCommitStickyText,
  onCancelStickyEdit,
  onMoveSticky,
  onMoveStep,
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
  const [edgeDraft, setEdgeDraft] = useState("");
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

  const stepFree = useFreeDrag({
    toDiagram,
    zoom: camera.zoom,
    onEnd: (d) => {
      const step = base.byId.get(d.id);
      if (step) onMoveStep(d.id, step.cx + d.dx, step.cy + d.dy);
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

  // While a step is dragged, the layout is recomputed with it at the pointer,
  // so its arrows and stickies follow it live instead of jumping on release.
  const dragging = stepFree.drag?.active ? stepFree.drag : null;
  const layout = useMemo(() => {
    if (!dragging) return base;
    const step = base.byId.get(dragging.id);
    if (!step) return base;
    return layoutFlow(doc, stickies, {
      unassignedLabel,
      pinned: { id: dragging.id, cx: step.cx + dragging.dx, cy: step.cy + dragging.dy },
    });
  }, [base, dragging, doc, stickies, unassignedLabel]);
  const dropBand = dragging
    ? layout.bandAt(layout.byId.get(dragging.id)?.cy ?? 0).key
    : null;

  const edgeDrag = useEdgeDrag({
    toDiagram,
    nodeAt: (p) => hitNode(layout.steps, p)?.id ?? null,
    canJoin: (d, overId) => {
      if (overId === d.anchorId) return false;
      if (d.mode === "create") return canConnect(d.anchorId, overId);
      return d.end === "to" ? canConnect(d.anchorId, overId) : canConnect(overId, d.anchorId);
    },
    onDrop: (d, overId) => {
      const over = layout.byId.get(overId);
      if (!over) {
        pendingPort.current = null;
        return;
      }
      // The drop point decides the entering side wherever it lands on the
      // step; the middle stays automatic.
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

  const editingStep = editingStepId ? (layout.byId.get(editingStepId) ?? null) : null;
  // Re-seeded when the rename target changes, not when the layout does - the
  // layout changes on every keystroke via the draft itself.
  useEffect(() => {
    setDraft(editingStepId ? (base.byId.get(editingStepId)?.title ?? "") : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingStepId]);
  useEffect(() => {
    setEdgeDraft(
      editingEdgeKey ? (base.edges.find((e) => e.key === editingEdgeKey)?.label ?? "") : "",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingEdgeKey]);

  const startStepDrag = (e: React.PointerEvent, step: PositionedStep) => {
    if (e.button !== 0) return;
    onSelectStep(step.id);
    if (editingStepId) return;
    e.stopPropagation();
    stepFree.start(e, step.id);
  };
  const startStickyDrag = (e: React.PointerEvent, sticky: PositionedSticky) => {
    if (editingStickyId) return;
    e.stopPropagation();
    if (!stickies.some((s) => s.id === sticky.id)) return;
    stickyFree.start(e, sticky.id);
  };
  const clearSelection = () => {
    if (justDragged.current) return;
    onSelectStep(null);
    onSelectEdge(null);
    onSelectSticky(null);
  };

  const hovered = hoverId && !dragging ? (layout.byId.get(hoverId) ?? null) : null;
  const handleSteps = edgeDrag.drag || dragging ? [] : [hoverId, selectedStepId];
  // The steps a dragged arrow keeps and would land on, if any.
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
      grabbing={Boolean(stepFree.drag) || Boolean(edgeDrag.drag)}
      onBackgroundClick={clearSelection}
      menu={<ClipboardMenuItems onPaste={clipboard.onPaste} canPaste={clipboard.canPaste} />}
    >
      {layout.bands.map((band) => {
        const header = bandHeaderText(band);
        const accent = band.color ? COLOR_HEX[band.color] : undefined;
        return (
          <g key={band.key || "unassigned"}>
            <rect
              x={band.x}
              y={band.y}
              width={band.width}
              height={band.height}
              className={cn(
                "fill-muted-foreground/5 stroke-border",
                dropBand === band.key && "fill-ring/10",
              )}
              strokeWidth={1}
              onClick={clearSelection}
              onDoubleClick={(e) => {
                e.stopPropagation();
                const at = toDiagram(e.clientX, e.clientY);
                onAddAt(band.key, at.x, at.y - (band.y + band.height / 2));
              }}
            />
            {band.headerWidth > 0 && (
              <>
                <rect
                  x={band.x}
                  y={band.y}
                  width={band.headerWidth}
                  height={band.height}
                  className="fill-muted/60 stroke-border"
                  strokeWidth={1}
                  pointerEvents="none"
                />
                <rect
                  x={band.x}
                  y={band.y}
                  width={3}
                  height={band.height}
                  className={accent ? undefined : "fill-muted-foreground"}
                  fill={accent}
                  pointerEvents="none"
                />
              </>
            )}
            {header && (
              <text
                x={header.x}
                y={header.y}
                textAnchor="middle"
                fontSize={LANE_FONT_SIZE}
                fontWeight={600}
                transform={`rotate(-90 ${header.x} ${header.y})`}
                className="fill-foreground select-none"
                pointerEvents="none"
              >
                {header.text}
              </text>
            )}
          </g>
        );
      })}

      {layout.edges.map((edge) => (
        <EdgeArrow
          key={edge.key}
          geometry={edge.geometry}
          {...(edge.label ? { label: edge.label } : {})}
          {...(edge.labelBox ? { labelBox: edge.labelBox } : {})}
          labelFontSize={EDGE_LABEL_FONT_SIZE}
          selected={edge.key === selectedEdgeKey}
          faded={edge.key === ghostKey}
          onSelect={() => {
            onSelectEdge(edge.key);
          }}
          onStartLabelEdit={() => onStartEditEdge(edge.key)}
          onEndPointerDown={(e, end) => edgeDrag.startReattach(e, { from: edge.from, to: edge.to }, end)}
        />
      ))}

      {editingEdgeKey &&
        (() => {
          const edge = layout.edges.find((e) => e.key === editingEdgeKey);
          if (!edge) return null;
          const width = Math.max(120, textWidth(edgeDraft, EDGE_LABEL_FONT_SIZE + 2) + 28);
          return (
            <foreignObject x={edge.geometry.mid.x - width / 2} y={edge.geometry.mid.y - 13} width={width} height={26}>
              <NodeInput
                value={edgeDraft}
                onChange={setEdgeDraft}
                onCommit={(value) => onCommitEdgeLabel(edge.key, value)}
                onCancel={onCancelEdgeEdit}
              />
            </foreignObject>
          );
        })()}

      {layout.steps.map((step) => {
        const editing = step.id === editingStepId;
        const stroke = step.color ? COLOR_HEX[step.color] : undefined;
        const isDragged = dragging?.id === step.id;
        const isTarget = edgeDrag.drag?.overId === step.id;
        const showHandles = handleSteps.includes(step.id);
        return (
          <NodeClipboardMenu
            key={step.id}
            svg
            canPaste={clipboard.canPaste}
            onCopy={() => clipboard.onCopy(step.id)}
            onDuplicate={() => clipboard.onDuplicate(step.id)}
            onPaste={clipboard.onPaste}
          >
          <g
            opacity={isDragged ? 0.85 : 1}
            className="cursor-pointer"
            onPointerDown={(e) => startStepDrag(e, step)}
            onPointerEnter={() => setHoverId(step.id)}
            onPointerLeave={() => setHoverId((h) => (h === step.id ? null : h))}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onStartEditStep(step.id);
            }}
          >
            <ShapeOutline
              shape={step.shape}
              box={step}
              className={cn("fill-card", !stroke && "stroke-border")}
              stroke={stroke}
              strokeWidth={1.5}
            />
            {(step.id === selectedStepId || isTarget) && (
              <ShapeOutline
                shape={step.shape}
                box={step}
                grow={3}
                fill="none"
                className="stroke-ring"
                strokeWidth={2}
                strokeDasharray={isTarget && step.id !== selectedStepId ? "4 3" : undefined}
              />
            )}
            {editing ? (
              <foreignObject
                x={step.cx - Math.max(step.width, 140) / 2}
                y={step.cy - 14}
                width={Math.max(step.width, 140)}
                height={28}
              >
                <NodeInput
                  value={draft}
                  onChange={setDraft}
                  onCommit={(value) => onCommitStepTitle(step.id, value)}
                  onCancel={onCancelStepEdit}
                />
              </foreignObject>
            ) : (
              step.lines.map((line, i) => (
                <text
                  key={`${step.id}-${i}`}
                  x={step.cx}
                  y={stepTextY(step, i)}
                  textAnchor="middle"
                  fontSize={STEP_FONT_SIZE}
                  className="fill-foreground select-none"
                >
                  {line}
                </text>
              ))
            )}
            {step.task && !editing && (
              <text
                x={step.cx}
                y={step.y + step.height + 12}
                textAnchor="middle"
                fontSize={10}
                className="fill-muted-foreground font-mono select-none"
              >
                {step.task}
              </text>
            )}
            {showHandles && !editing && (
              <PortHandles
                node={step}
                onStart={(e, side) => {
                  if (e.button !== 0) return;
                  e.stopPropagation();
                  pendingPort.current = { side };
                  edgeDrag.startCreate(e, step.id);
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

      {/* Stickies are drawn last, so a note the user dropped over a step stays
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

      {hovered?.note && !editingStep && !edgeDrag.drag && <NoteTip box={hovered} note={hovered.note} />}
    </DiagramSurface>
  );
}
