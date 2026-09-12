import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Textarea } from "@/components/ui/textarea";

/** Where the bubble points, in viewport coordinates. */
export interface PopoverAnchor {
  x: number;
  y: number;
}

interface Props {
  at: PopoverAnchor;
  /** The passage the note is about, shown so the target is never in doubt. */
  quote: string;
  /** The note being edited; "" for a new one. */
  value: string;
  onSave: (comment: string) => void;
  onCancel: () => void;
  /** Offered only when an existing note is open. */
  onDelete?: () => void;
}

const WIDTH = 320;
const MARGIN = 8;

/**
 * The bubble that takes a note on the selected passage.
 *
 * Fixed-position rather than a Radix `Popover`: the anchor is a text range,
 * and for an HTML document it is a range inside a sandboxed frame, so there is
 * no element in this tree to hang a trigger on. Coordinates are the viewport's
 * — the caller has already added the frame's offset, if any.
 *
 * `Ctrl+Enter` saves and `Escape` cancels, on `window` in the capture phase:
 * the textarea has focus, but Escape has to work even after a click has moved
 * focus out of it.
 */
export function AnnotationPopover({ at, quote, value, onSave, onCancel, onDelete }: Props) {
  const [comment, setComment] = useState(value);
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ left: at.x, top: at.y });

  // Re-seeded per opening, which is what the key on the caller's side is for;
  // this also covers clicking a second note while one is open.
  useEffect(() => {
    setComment(value);
  }, [value]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const height = el.offsetHeight;
    const maxLeft = window.innerWidth - WIDTH - MARGIN;
    const left = Math.max(MARGIN, Math.min(at.x, maxLeft));
    // Below the selection, unless that would run off the bottom.
    const below = at.y + MARGIN;
    const top =
      below + height > window.innerHeight - MARGIN
        ? Math.max(MARGIN, at.y - height - MARGIN)
        : below;
    setPlace({ left, top });
  }, [at.x, at.y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  return (
    <div
      ref={box}
      style={{ left: place.left, top: place.top, width: WIDTH }}
      className="fixed z-50 rounded-md border bg-popover p-2 shadow-md"
    >
      <p className="mb-1.5 max-h-16 overflow-y-auto border-l-2 border-primary/60 pl-2 text-[11px] leading-relaxed text-muted-foreground">
        {quote}
      </p>
      <Textarea
        autoFocus
        rows={3}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            onSave(comment);
          }
        }}
        placeholder="What should change here?"
        className="max-h-40 resize-none overflow-y-auto text-xs"
      />
      <div className="mt-1.5 flex items-center gap-1">
        {onDelete && (
          <Hint label="Delete this note">
            <Button size="icon-sm" variant="ghost" aria-label="Delete this note" onClick={onDelete}>
              <Trash2 />
            </Button>
          </Hint>
        )}
        <span className="flex-1 text-[10px] text-muted-foreground">Ctrl+Enter</span>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={!comment.trim()} onClick={() => onSave(comment)}>
          Save
        </Button>
      </div>
    </div>
  );
}
