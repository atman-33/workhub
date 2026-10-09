import { useEffect, useRef, useState } from "react";
import { COLOR_HEX, STICKY_FILL_HEX, STICKY_INK } from "@/lib/diagram/colors";
import {
  STICKY_FONT_SIZE,
  STICKY_PAD,
  type PositionedSticky,
} from "@/lib/diagram/sticky-layout";

/**
 * One sticky note.
 *
 * Drawn in diagram coordinates like everything else, so it pans and zooms with
 * the diagram it annotates and its offset from its node never changes on screen.
 * A leader line runs back to the node, which is what keeps a sticky legible
 * once it has been dragged clear of the box it belongs to.
 */
export function StickyPaper({
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
export function StickyInput({
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
