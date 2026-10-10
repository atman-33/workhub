import {
  STICKY_FONT_SIZE,
  STICKY_PAD,
  wrapStickyText,
  type Box,
} from "@/lib/diagram/sticky-layout";
import { textWidth } from "@/lib/diagram/text";

const TIP_GAP = 16;

/** An element's note, shown next to it while the pointer rests on it. Shared by
 * every diagram kind that keeps notes on its elements.
 *
 * By default the tip hangs below the element and is centred on it. A tip for
 * something at the edge of the picture (a quadrant's note mark) picks the side
 * it opens towards: `placement` puts it above or below, `align` lines its left
 * edge, right edge or centre up with the element. `maxLines` cuts a long note
 * short with an ellipsis; the full text is in the side panel. */
export function NoteTip({
  box,
  note,
  placement = "below",
  align = "center",
  maxLines,
}: {
  box: Box;
  note: string;
  placement?: "below" | "above";
  align?: "start" | "center" | "end";
  maxLines?: number;
}) {
  let lines = wrapStickyText(note);
  if (maxLines !== undefined && lines.length > maxLines) {
    lines = [...lines.slice(0, maxLines - 1), `${lines[maxLines - 1].replace(/\s+$/, "")}…`];
  }
  const lineHeight = STICKY_FONT_SIZE * 1.45;
  const width = Math.min(
    220,
    Math.max(...lines.map((l) => textWidth(l, STICKY_FONT_SIZE))) + STICKY_PAD * 2,
  );
  const height = lines.length * lineHeight + STICKY_PAD * 2;
  const x =
    align === "start"
      ? box.x
      : align === "end"
        ? box.x + box.width - width
        : box.x + box.width / 2 - width / 2;
  const y = placement === "above" ? box.y - TIP_GAP - height : box.y + box.height + TIP_GAP;
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
