import {
  STICKY_FONT_SIZE,
  STICKY_PAD,
  wrapStickyText,
  type Box,
} from "@/lib/diagram/sticky-layout";
import { textWidth } from "@/lib/diagram/text";

/** An element's note, shown under it while the pointer rests on it. Shared by
 * every diagram kind that keeps notes on its elements. */
export function NoteTip({ box, note }: { box: Box; note: string }) {
  const lines = wrapStickyText(note);
  const lineHeight = STICKY_FONT_SIZE * 1.45;
  const width = Math.min(
    220,
    Math.max(...lines.map((l) => textWidth(l, STICKY_FONT_SIZE))) + STICKY_PAD * 2,
  );
  const height = lines.length * lineHeight + STICKY_PAD * 2;
  const x = box.x + box.width / 2 - width / 2;
  const y = box.y + box.height + 16;
  return (
    <g pointerEvents="none">
      <rect x={x} y={y} width={width} height={height} rx={4} className="fill-popover stroke-border" />
      {lines.map((line, i) => (
        <text
          key={i}
          x={x + STICKY_PAD}
          y={y + STICKY_PAD + STICKY_FONT_SIZE * 0.9 + i * lineHeight}
          fontSize={STICKY_FONT_SIZE}
          className="fill-popover-foreground select-none"
        >
          {line}
        </text>
      ))}
    </g>
  );
}
