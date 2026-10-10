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
import { COLOR_HEX } from "@/lib/diagram/colors";
import type { Sticky } from "@/lib/diagram/sticky";
import type { PositionedSticky } from "@/lib/diagram/sticky-layout";
import {
  ITEM_FONT_SIZE,
  CROSS_STROKE_WIDTH,
  QUADRANT_LABEL_OPACITY,
  layoutMatrix,
  unitAt,
  type PositionedItem,
} from "@/lib/diagram/matrix2x2/layout";
import type { MatrixDocModel } from "@/lib/diagram/matrix2x2/parse";
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
 * - **left-drag on an item moves it**; the new position is reported once, on
 *   release, and only for that item;
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
  selectedId: string | null;
  selectedStickyId: string | null;
  /** The quadrant selected for its note; exclusive with an item or a sticky. */
  selectedQuadrant: QuadrantKey | null;
  editingId: string | null;
  editingStickyId: string | null;
  /** True while an AI edit holds the file: the canvas is look-only. */
  locked?: boolean;
  onSelect: (id: string | null) => void;
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
  /** A finished item drag: the new unit coordinates (rounded, in 0..1). */
  onMoveItem: (id: string, x: number, y: number) => void;
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
  selectedId,
  selectedStickyId,
  selectedQuadrant,
  editingId,
  editingStickyId,
  locked,
  onSelect,
  onSelectSticky,
  onSelectQuadrant,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onStartEditSticky,
  onCommitStickyText,
  onCancelStickyEdit,
  onMoveSticky,
  onMoveItem,
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
      const at = dragUnit(d.id, d.dx, d.dy);
      if (at) onMoveItem(d.id, at.x, at.y);
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

  /** Unit coordinates an item would land on after being dragged by (dx, dy). */
  function dragUnit(id: string, dx: number, dy: number) {
    const item = base.byId.get(id);
    if (!item) return null;
    return unitAt(item.x + item.width / 2 + dx, item.y + item.height / 2 + dy);
  }

  // While an item is dragged, the layout is recomputed with it at the pointer,
  // so its stickies follow it live instead of jumping on release.
  const dragging = itemFree.drag?.active ? itemFree.drag : null;
  const layout = useMemo(() => {
    if (!dragging) return base;
    const at = dragUnit(dragging.id, dragging.dx, dragging.dy);
    if (!at) return base;
    return layoutMatrix(
      {
        ...doc,
        items: doc.items.map((i) => (i.id === dragging.id ? { ...i, x: at.x, y: at.y } : i)),
      },
      stickies,
    );
    // `dragUnit` reads `base`, which is already a dependency.
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
    onSelect(item.id);
    if (locked || editingId) return;
    e.stopPropagation();
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
    if (justDragged.current) return;
    onSelect(null);
    onSelectSticky(null);
    onSelectQuadrant(null);
  };
  const selectQuadrant = (key: QuadrantKey) => {
    if (justDragged.current) return;
    onSelectQuadrant(key);
  };

  const hovered = hoverId && !dragging ? (layout.byId.get(hoverId) ?? null) : null;
  const hoveredMark =
    hoverMark && !dragging ? (layout.quadrants.find((q) => q.key === hoverMark && q.noteMark) ?? null) : null;

  return (
    <DiagramSurface
      view={view}
      grabbing={Boolean(itemFree.drag)}
      onBackgroundClick={clearSelection}
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
            {item.id === selectedId && (
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
