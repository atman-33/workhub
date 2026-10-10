import { useEffect, useMemo, useRef, useState } from "react";
import {
  ClipboardMenuItems,
  NodeClipboardMenu,
  type CanvasClipboard,
} from "@/components/diagram/clipboard-menu";
import { DiagramSurface } from "@/components/diagram/diagram-surface";
import { NodeInput } from "@/components/diagram/node-input";
import { NoteTip } from "@/components/diagram/note-tip";
import { StickyPaper } from "@/components/diagram/sticky-paper";
import { useCamera } from "@/components/diagram/use-camera";
import { useFreeDrag } from "@/components/diagram/use-free-drag";
import { useMarquee } from "@/components/diagram/use-marquee";
import { COLOR_HEX } from "@/lib/diagram/colors";
import { idsInRect, shiftPositions } from "@/lib/diagram/multi-select";
import type { Sticky } from "@/lib/diagram/sticky";
import type { PositionedSticky } from "@/lib/diagram/sticky-layout";
import {
  ITEM_FONT_SIZE,
  CROSS_STROKE_WIDTH,
  PLOT,
  QUADRANT_LABEL_OPACITY,
  layoutMatrix,
  unitAt,
  type PositionedItem,
} from "@/lib/diagram/matrix2x2/layout";
import { clampUnit, type MatrixDocModel } from "@/lib/diagram/matrix2x2/parse";
import type { QuadrantKey } from "@/lib/diagram/matrix2x2/quadrant-notes";
import { useT } from "@/lib/i18n";
import { LINE_HEIGHT, NODE_PAD_X, textWidth } from "@/lib/diagram/text";
import { cn } from "@/lib/utils";

/**
 * The 2x2 matrix canvas.
 *
 * Draws `layoutMatrix`'s output as SVG - the same geometry the exports render -
 * and owns exactly one piece of state the file does not: the camera. Which
 * item is selected and what the note contains belong to the view above.
 *
 * - **left-drag on an item moves it**, alone or with the rest of the selection
 *   (Shift+click grows the selection; dragging any selected item moves them
 *   all, reported once on release so one undo step restores them);
 * - **left-drag on empty plot draws a marquee** selecting every item it
 *   touches (Shift held: added to the selection instead);
 * - **double-click on the plot adds an item** where it landed;
 * - **double-click on an item renames it** in place;
 * - **a click on a quadrant selects it**, for its note in the side panel; a
 *   quadrant with a note carries a small mark in its outer corner, and resting
 *   the pointer on the mark shows the note (T-0692);
 * - right-drag pans and the wheel zooms (the shared camera).
 */
interface Props {
  doc: MatrixDocModel;
  /** Sticky notes to draw. Empty while the note hides them. */
  stickies: Sticky[];
  /** The ordered selection; the ring is drawn on every entry. */
  selectedIds: string[];
  selectedStickyId: string | null;
  /** The quadrant selected for its note; exclusive with an item or a sticky. */
  selectedQuadrant: QuadrantKey | null;
  editingId: string | null;
  editingStickyId: string | null;
  /** True while an AI edit holds the file: the canvas is look-only. */
  locked?: boolean;
  /** A click on an item: plain replaces the selection, Shift toggles it. */
  onSelect: (id: string | null, additive: boolean) => void;
  /** A finished marquee: the caught ids replace the selection, or join it with Shift. */
  onSelectMarquee: (ids: string[], additive: boolean) => void;
  onSelectSticky: (id: string | null) => void;
  onSelectQuadrant: (key: QuadrantKey | null) => void;
  onStartEdit: (id: string) => void;
  onCommitEdit: (id: string, title: string) => void;
  onCancelEdit: () => void;
  onStartEditSticky: (id: string) => void;
  onCommitStickyText: (id: string, text: string) => void;
  onCancelStickyEdit: () => void;
  /** A finished sticky drag: the new offset from its item's centre. */
  onMoveSticky: (id: string, dx: number, dy: number) => void;
  /** A finished item drag: the new unit coordinates of every moved item. */
  onMoveItems: (moves: ReadonlyMap<string, { x: number; y: number }>) => void;
  /** A double-click on the plot: add an item at these unit coordinates. */
  onAddAt: (x: number, y: number) => void;
  /** Copy, duplicate and paste, offered in the right-click menus. */
  clipboard: CanvasClipboard;
  /** Bumped by the view to re-fit (a new note, or the Fit button). */
  fitToken: number;
}

/** Lines of a quadrant note the hover tip shows; the rest is in the side panel. */
const QUADRANT_TIP_MAX_LINES = 12;

/** The note mark: a small page with a folded corner and three text lines. */
function NoteMarkGlyph({ box }: { box: { x: number; y: number; width: number; height: number } }) {
  const { x, y, width: w, height: h } = box;
  const fold = 4;
  return (
    <>
      {/* A transparent plate, so the whole mark takes the pointer. */}
      <rect x={x} y={y} width={w} height={h} fill="transparent" />
      <path
        d={`M${x + 1} ${y + 1} H${x + w - 1 - fold} L${x + w - 1} ${y + 1 + fold} V${y + h - 1} H${x + 1} Z`}
        className="fill-card stroke-muted-foreground"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      {[0.4, 0.62, 0.84].map((f) => (
        <line
          key={f}
          x1={x + 3.5}
          x2={x + w - 3.5}
          y1={y + h * f}
          y2={y + h * f}
          className="stroke-muted-foreground"
          strokeWidth={1}
        />
      ))}
    </>
  );
}

export function MatrixCanvas({
  doc,
  stickies,
  selectedIds,
  selectedStickyId,
  selectedQuadrant,
  editingId,
  editingStickyId,
  locked,
  onSelect,
  onSelectMarquee,
  onSelectSticky,
  onSelectQuadrant,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onStartEditSticky,
  onCommitStickyText,
  onCancelStickyEdit,
  onMoveSticky,
  onMoveItems,
  onAddAt,
  clipboard,
  fitToken,
}: Props) {
  const t = useT();
  const base = useMemo(() => layoutMatrix(doc, stickies), [doc, stickies]);
  const view = useCamera({ bounds: base.bounds, fitToken });
  const { camera, toDiagram } = view;
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [hoverMark, setHoverMark] = useState<QuadrantKey | null>(null);
  const [draft, setDraft] = useState("");
  // A drag that ends over empty canvas is followed by a click that would clear
  // the selection it just made; this swallows that one click.
  const justDragged = useRef(false);

  const itemFree = useFreeDrag({
    toDiagram,
    zoom: camera.zoom,
    onEnd: (d) => {
      const origins = groupOrigins.current;
      const ids = [...origins.keys()];
      if (ids.length) {
        // Diagram pixels to unit coordinates (y runs upward, hence the flip).
        const moves = shiftPositions(
          origins,
          ids,
          d.dx / PLOT.width,
          -d.dy / PLOT.height,
          (x, y) => ({ x: clampUnit(x), y: clampUnit(y) }),
        );
        onMoveItems(moves);
      }
      groupOrigins.current = new Map();
      justDragged.current = true;
      setTimeout(() => {
        justDragged.current = false;
      }, 0);
    },
  });
  const stickyFree = useFreeDrag({
    toDiagram,
    zoom: camera.zoom,
    onEnd: (d) => {
      const source = stickies.find((s) => s.id === d.id);
      if (source) onMoveSticky(d.id, Math.round(source.dx + d.dx), Math.round(source.dy + d.dy));
      justDragged.current = true;
      setTimeout(() => {
        justDragged.current = false;
      }, 0);
    },
  });

  const marquee = useMarquee({
    toDiagram,
    zoom: camera.zoom,
    disabled: locked,
    onMarquee: (rect, additive) => onSelectMarquee(idsInRect(base.items, rect), additive),
  });

  /** Unit origins of the drag's group, snapshotted when the press landed. */
  const groupOrigins = useRef(new Map<string, { x: number; y: number }>());

  // While items are dragged, the layout is recomputed with the whole group at
  // the pointer, so their stickies follow live instead of jumping on release.
  const dragging = itemFree.drag?.active ? itemFree.drag : null;
  const layout = useMemo(() => {
    if (!dragging) return base;
    const origins = groupOrigins.current;
    if (!origins.size) return base;
    const moves = shiftPositions(
      origins,
      [...origins.keys()],
      dragging.dx / PLOT.width,
      -dragging.dy / PLOT.height,
      (x, y) => ({ x: clampUnit(x), y: clampUnit(y) }),
    );
    return layoutMatrix(
      {
        ...doc,
        items: doc.items.map((i) => {
          const at = moves.get(i.id);
          return at ? { ...i, x: at.x, y: at.y } : i;
        }),
      },
      stickies,
    );
    // `origins` is snapshotted per gesture, not per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, dragging?.id, dragging?.dx, dragging?.dy, doc, stickies]);

  const editingItem = editingId ? (layout.byId.get(editingId) ?? null) : null;
  const draftWidth = Math.ceil(textWidth(draft, ITEM_FONT_SIZE)) + NODE_PAD_X * 2 + 16;
  // Re-seeded when the rename target changes, not when the layout does - the
  // layout changes on every keystroke via the draft itself. The view can start
  // an edit too (a freshly added item), so this cannot live in the handler.
  useEffect(() => {
    setDraft(editingId ? (base.byId.get(editingId)?.title ?? "") : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);
  const startEdit = (id: string) => {
    if (!locked) onStartEdit(id);
  };

  const startItemDrag = (e: React.PointerEvent, item: PositionedItem) => {
    if (e.button !== 0) return;
    // Shift+click grows or shrinks the selection instead of dragging.
    if (e.shiftKey) {
      onSelect(item.id, true);
      return;
    }
    // Dragging a selected item moves the whole group; anywhere else starts
    // over with this item alone.
    const ids = selectedIds.includes(item.id) ? selectedIds : [item.id];
    if (!selectedIds.includes(item.id)) onSelect(item.id, false);
    if (locked || editingId) return;
    e.stopPropagation();
    const origins = new Map<string, { x: number; y: number }>();
    for (const id of ids) {
      const at = base.byId.get(id);
      if (at) origins.set(id, { x: at.fx, y: at.fy });
    }
    groupOrigins.current = origins;
    itemFree.start(e, item.id);
  };
  const startStickyDrag = (e: React.PointerEvent, sticky: PositionedSticky) => {
    if (locked || editingStickyId) return;
    e.stopPropagation();
    if (!stickies.some((s) => s.id === sticky.id)) return;
    stickyFree.start(e, sticky.id);
  };

  const addAt = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (locked) return;
    const at = toDiagram(e.clientX, e.clientY);
    const unit = unitAt(at.x, at.y);
    onAddAt(unit.x, unit.y);
  };
  const clearSelection = () => {
    if (justDragged.current || marquee.consumeClick()) return;
    onSelect(null, false);
    onSelectSticky(null);
    onSelectQuadrant(null);
  };
  const selectQuadrant = (key: QuadrantKey) => {
    if (justDragged.current || marquee.consumeClick()) return;
    onSelectQuadrant(key);
  };

  const hovered = hoverId && !dragging ? (layout.byId.get(hoverId) ?? null) : null;
  const hoveredMark =
    hoverMark && !dragging ? (layout.quadrants.find((q) => q.key === hoverMark && q.noteMark) ?? null) : null;

  return (
    <DiagramSurface
      view={view}
      grabbing={Boolean(itemFree.drag) || Boolean(marquee.marquee)}
      onBackgroundClick={clearSelection}
      onBackgroundPointerDown={marquee.onPointerDown}
      menu={<ClipboardMenuItems onPaste={clipboard.onPaste} canPaste={clipboard.canPaste} readOnly={locked} />}
    >
      {/* Quadrants: the plot itself. Hit-testable so a double-click on them
          adds an item, and a click on them selects the quadrant (its note
          is edited in the side panel). */}
      {layout.quadrants.map((q) => (
        <rect
          key={q.key}
          x={q.x}
          y={q.y}
          width={q.width}
          height={q.height}
          className="fill-muted-foreground/5 stroke-border"
          strokeWidth={1}
          onClick={() => selectQuadrant(q.key)}
          onDoubleClick={addAt}
        />
      ))}
      {/* The selected quadrant: a faint fill and an inner ring. Deaf to the
          pointer, so the rect underneath keeps the clicks. */}
      {layout.quadrants
        .filter((q) => q.key === selectedQuadrant)
        .map((q) => (
          <rect
            key={`${q.key}-selected`}
            x={q.x + 2}
            y={q.y + 2}
            width={q.width - 4}
            height={q.height - 4}
            rx={4}
            fill="none"
            className="fill-ring/10 stroke-ring"
            strokeWidth={2}
            pointerEvents="none"
          />
        ))}
      {/* The central cross: the boundary between the quadrants, stronger than the grid. */}
      {layout.cross.map((l, i) => (
        <line
          key={i}
          x1={l.x1}
          y1={l.y1}
          x2={l.x2}
          y2={l.y2}
          className="stroke-muted-foreground"
          strokeWidth={CROSS_STROKE_WIDTH}
          pointerEvents="none"
        />
      ))}
      {/* Quadrant names are a watermark: big, very faint, behind the items and
          deaf to the pointer so they never hinder placing or adding one. */}
      {layout.quadrants
        .filter((q) => q.label.trim())
        .map((q) => (
          <text
            key={`${q.key}-label`}
            x={q.textX}
            y={q.textY}
            textAnchor="middle"
            fontSize={q.fontSize}
            fontWeight={700}
            fillOpacity={QUADRANT_LABEL_OPACITY}
            className="fill-muted-foreground select-none"
            pointerEvents="none"
          >
            {q.label}
          </text>
        ))}
      {layout.axisTexts.map((a) => (
        <text
          key={a.id}
          x={a.x}
          y={a.y}
          textAnchor={a.anchor}
          fontSize={a.fontSize}
          fontWeight={a.strong ? 600 : 400}
          transform={a.rotate ? `rotate(-90 ${a.x} ${a.y})` : undefined}
          className={cn("select-none", a.strong ? "fill-foreground" : "fill-muted-foreground")}
          pointerEvents="none"
        >
          {a.text}
        </text>
      ))}

      {layout.items.map((item) => {
        const editing = item.id === editingId;
        const width = editing ? Math.max(item.width, draftWidth) : item.width;
        const x = item.x - (width - item.width) / 2;
        const lineHeight = ITEM_FONT_SIZE * LINE_HEIGHT;
        const firstBaseline =
          item.y + item.height / 2 - ((item.lines.length - 1) * lineHeight) / 2 + ITEM_FONT_SIZE * 0.36;
        const stroke = item.color ? COLOR_HEX[item.color] : undefined;
        const isDragged = dragging?.id === item.id;
        return (
          <NodeClipboardMenu
            key={item.id}
            svg
            canPaste={clipboard.canPaste}
            readOnly={locked}
            onCopy={() => clipboard.onCopy(item.id)}
            onDuplicate={() => clipboard.onDuplicate(item.id)}
            onPaste={clipboard.onPaste}
          >
          <g
            opacity={isDragged ? 0.85 : 1}
            className="cursor-pointer"
            onPointerDown={(e) => startItemDrag(e, item)}
            onPointerEnter={() => setHoverId(item.id)}
            onPointerLeave={() => setHoverId((h) => (h === item.id ? null : h))}
            onDoubleClick={(e) => {
              e.stopPropagation();
              startEdit(item.id);
            }}
          >
            <rect
              x={x}
              y={item.y}
              width={width}
              height={item.height}
              rx={8}
              className={cn("fill-card", !stroke && "stroke-border")}
              stroke={stroke}
              strokeWidth={1.5}
              strokeDasharray={item.placed ? undefined : "4 3"}
            />
            {selectedIds.includes(item.id) && (
              <rect
                x={x - 3}
                y={item.y - 3}
                width={width + 6}
                height={item.height + 6}
                rx={11}
                fill="none"
                className="stroke-ring"
                strokeWidth={2}
              />
            )}
            {editing ? (
              <foreignObject x={x} y={item.y} width={width} height={item.height}>
                <NodeInput
                  value={draft}
                  onChange={setDraft}
                  onCommit={(value) => onCommitEdit(item.id, value)}
                  onCancel={onCancelEdit}
                />
              </foreignObject>
            ) : (
              item.lines.map((line, i) => (
                <text
                  key={`${item.id}-${i}`}
                  x={x + width / 2}
                  y={firstBaseline + i * lineHeight}
                  textAnchor="middle"
                  fontSize={ITEM_FONT_SIZE}
                  className="fill-foreground select-none"
                >
                  {line}
                </text>
              ))
            )}
            {item.task && !editing && (
              <text
                x={x + width / 2}
                y={item.y + item.height + 11}
                textAnchor="middle"
                fontSize={10}
                className="fill-muted-foreground font-mono select-none"
              >
                {item.task}
              </text>
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

      {/* Note marks sit in the outer corners, in front of the items so an item
          dropped on one never hides that its quadrant has a note. */}
      {layout.quadrants.map((q) =>
        q.noteMark ? (
          <g
            key={`${q.key}-mark`}
            className="cursor-pointer"
            opacity={0.6}
            onPointerEnter={() => setHoverMark(q.key)}
            onPointerLeave={() => setHoverMark((h) => (h === q.key ? null : h))}
            onClick={(e) => {
              e.stopPropagation();
              selectQuadrant(q.key);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <title>{t("diagram.matrix.quadrantNoteMark")}</title>
            <NoteMarkGlyph box={q.noteMark} />
          </g>
        ) : null,
      )}

      {/* Stickies are drawn last, so a note the user dropped over an item
          stays readable instead of disappearing under it. */}
      {layout.stickies.map((sticky) => (
        <StickyPaper
          key={sticky.id}
          sticky={sticky}
          offsetX={stickyFree.drag?.active && stickyFree.drag.id === sticky.id ? stickyFree.drag.dx : 0}
          offsetY={stickyFree.drag?.active && stickyFree.drag.id === sticky.id ? stickyFree.drag.dy : 0}
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

      {hovered?.note && !editingItem && <NoteTip box={hovered} note={hovered.note} />}
      {hoveredMark?.noteMark && (
        <NoteTip
          box={hoveredMark.noteMark}
          note={doc.quadrantNotes[hoveredMark.key]}
          placement={hoveredMark.key === "bl" || hoveredMark.key === "br" ? "above" : "below"}
          align={hoveredMark.key === "tl" || hoveredMark.key === "bl" ? "start" : "end"}
          maxLines={QUADRANT_TIP_MAX_LINES}
        />
      )}
    </DiagramSurface>
  );
}
