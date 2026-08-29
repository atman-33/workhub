// Floating panel: a positionable, resizable in-app window (quick-capture-like
// independent surface) rendered in a portal above the main UI. The title bar
// drags the panel around; eight invisible handles around the border resize it;
// the rect survives restarts via localStorage. No modal backdrop — the app
// behind the panel stays usable.
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export interface FloatingPanelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Resize directions, one handle each ("ne" = north-east corner, ...). */
type Dir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const DIRS: Dir[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

const HANDLE_CLASS: Record<Dir, string> = {
  // All handles straddle the panel border so they stay findable. The left and
  // right ones sit fully outside: the body scrolls, and a handle overlapping
  // its edge would steal the scrollbar's outer pixels.
  n: "left-3 right-3 -top-1.5 h-3 cursor-n-resize",
  s: "left-3 right-3 -bottom-1.5 h-3 cursor-s-resize",
  e: "top-3 bottom-3 -right-1.5 w-1.5 cursor-e-resize",
  w: "top-3 bottom-3 -left-1.5 w-1.5 cursor-w-resize",
  ne: "-top-1.5 -right-1.5 size-3.5 cursor-ne-resize",
  nw: "-top-1.5 -left-1.5 size-3.5 cursor-nw-resize",
  se: "-bottom-1.5 -right-1.5 size-3.5 cursor-se-resize",
  sw: "-bottom-1.5 -left-1.5 size-3.5 cursor-sw-resize",
};

function loadRect(key: string): FloatingPanelRect | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const r = JSON.parse(raw) as FloatingPanelRect;
    if (![r.x, r.y, r.width, r.height].every(Number.isFinite)) return null;
    return r;
  } catch {
    return null;
  }
}

function saveRect(key: string, rect: FloatingPanelRect): void {
  try {
    localStorage.setItem(key, JSON.stringify(rect));
  } catch {
    // Storage can be unavailable or full; ignore silently.
  }
}

/** Keep a rect inside the viewport and above the minimum size. */
function clampRect(
  r: FloatingPanelRect,
  minWidth: number,
  minHeight: number,
): FloatingPanelRect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(Math.max(r.width, minWidth), vw);
  const height = Math.min(Math.max(r.height, minHeight), vh);
  const x = Math.min(Math.max(r.x, 0), Math.max(0, vw - width));
  const y = Math.min(Math.max(r.y, 0), Math.max(0, vh - height));
  return { x, y, width, height };
}

// Elements the title-bar drag must never steal presses from (buttons in the
// header, form controls a caller might render there).
const DRAG_BLOCK_SELECTOR =
  "button, a, input, textarea, select, label, [role='combobox'], [data-no-drag]";

/** Release an implicit pointer capture; a no-op when the capture is already
 *  gone (e.g. after pointercancel), which would otherwise throw. */
function releaseCapture(el: HTMLElement, pointerId: number): void {
  if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** localStorage key the last rect is persisted under. */
  storageKey: string;
  /** Left side of the title bar; the bar doubles as the drag handle. */
  title: ReactNode;
  /** Right side of the title bar, before the built-in close button. */
  actions?: ReactNode;
  /** First-open size when nothing is persisted yet. */
  defaultWidth: number;
  defaultHeight: number;
  minWidth?: number;
  minHeight?: number;
  /** Fill the viewport (minus a margin) and disable moving/resizing. */
  maximized?: boolean;
  children: ReactNode;
  /** Bottom bar; nothing renders when absent. */
  footer?: ReactNode;
}

export function FloatingPanel({
  open,
  onClose,
  storageKey,
  title,
  actions,
  defaultWidth,
  defaultHeight,
  minWidth = 360,
  minHeight = 280,
  maximized = false,
  children,
  footer,
}: Props) {
  const titleId = useId();
  const [rect, setRect] = useState<FloatingPanelRect | null>(null);
  const rectRef = useRef<FloatingPanelRect | null>(null);
  rectRef.current = rect;
  const dragRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const resizeRef = useRef<{
    pointerId: number;
    dir: Dir;
    start: FloatingPanelRect;
    startX: number;
    startY: number;
  } | null>(null);

  const persist = useCallback(() => {
    if (rectRef.current) saveRect(storageKey, rectRef.current);
  }, [storageKey]);

  // First open: restore the persisted rect, else centre a default-sized panel.
  // Later opens keep the in-memory rect but re-clamp it into the viewport
  // (the window may have been resized or moved in between).
  useEffect(() => {
    if (!open) return;
    if (rectRef.current) {
      setRect(clampRect(rectRef.current, minWidth, minHeight));
      return;
    }
    const stored = loadRect(storageKey);
    if (stored) {
      setRect(clampRect(stored, minWidth, minHeight));
      return;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(defaultWidth, Math.max(minWidth, vw - 24));
    const height = Math.min(defaultHeight, Math.max(minHeight, vh - 24));
    setRect({
      x: Math.round((vw - width) / 2),
      y: Math.round((vh - height) / 2),
      width,
      height,
    });
  }, [open, storageKey, defaultWidth, defaultHeight, minWidth, minHeight]);

  // Persist the last rect when the panel closes.
  useEffect(() => {
    if (open) return;
    persist();
  }, [open, persist]);

  // Keep the panel reachable when the window shrinks around it.
  useEffect(() => {
    if (!open) return;
    const onResize = () => {
      setRect((r) => (r ? clampRect(r, minWidth, minHeight) : r));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, minWidth, minHeight]);

  // Esc closes the panel, like the modal dialog it replaces. Radix popovers
  // (selects, comboboxes, the date picker) handle Esc first and prevent the
  // event, so an open popover dismisses alone without closing the panel.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const onHeaderPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0 || maximized || !rect) return;
      if ((e.target as HTMLElement).closest(DRAG_BLOCK_SELECTOR)) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = {
        pointerId: e.pointerId,
        offsetX: e.clientX - rect.x,
        offsetY: e.clientY - rect.y,
      };
    },
    [maximized, rect],
  );

  const onHeaderPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const d = dragRef.current;
      if (!d || d.pointerId !== e.pointerId) return;
      setRect((r) =>
        r
          ? clampRect(
              { ...r, x: e.clientX - d.offsetX, y: e.clientY - d.offsetY },
              minWidth,
              minHeight,
            )
          : r,
      );
    },
    [minWidth, minHeight],
  );

  const endDrag = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const d = dragRef.current;
      if (!d || d.pointerId !== e.pointerId) return;
      dragRef.current = null;
      releaseCapture(e.currentTarget, e.pointerId);
      persist();
    },
    [persist],
  );

  const onHandlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 || maximized || !rect) return;
      e.preventDefault();
      e.stopPropagation();
      const dir = e.currentTarget.dataset.dir as Dir;
      e.currentTarget.setPointerCapture(e.pointerId);
      resizeRef.current = {
        pointerId: e.pointerId,
        dir,
        start: rect,
        startX: e.clientX,
        startY: e.clientY,
      };
    },
    [maximized, rect],
  );

  const onHandlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const s = resizeRef.current;
      if (!s || s.pointerId !== e.pointerId) return;
      const dx = e.clientX - s.startX;
      const dy = e.clientY - s.startY;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let { x, y, width, height } = s.start;
      if (s.dir.includes("e")) {
        width = Math.min(
          Math.max(s.start.width + dx, minWidth),
          vw - s.start.x,
        );
      }
      if (s.dir.includes("w")) {
        x = Math.min(
          Math.max(s.start.x + dx, 0),
          s.start.x + s.start.width - minWidth,
        );
        width = s.start.x + s.start.width - x;
      }
      if (s.dir.includes("s")) {
        height = Math.min(
          Math.max(s.start.height + dy, minHeight),
          vh - s.start.y,
        );
      }
      if (s.dir.includes("n")) {
        y = Math.min(
          Math.max(s.start.y + dy, 0),
          s.start.y + s.start.height - minHeight,
        );
        height = s.start.y + s.start.height - y;
      }
      setRect({ x, y, width, height });
    },
    [minWidth, minHeight],
  );

  const endResize = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const s = resizeRef.current;
      if (!s || s.pointerId !== e.pointerId) return;
      resizeRef.current = null;
      releaseCapture(e.currentTarget, e.pointerId);
      persist();
    },
    [persist],
  );

  if (!open || !rect) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      className={cn(
        "fixed z-50 flex select-none flex-col rounded-lg border bg-background text-foreground shadow-xl outline-none",
        maximized && "inset-6",
      )}
      style={
        maximized
          ? undefined
          : {
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
            }
      }
    >
      <header
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={cn(
          "flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2",
          !maximized && "cursor-move touch-none",
        )}
      >
        <span id={titleId} className="min-w-0 truncate text-sm font-semibold">
          {title}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {actions}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close"
            onClick={onClose}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 min-w-0 flex-1 select-text flex-col gap-3 overflow-y-auto px-4 py-3">
        {children}
      </div>
      {footer && <div className="shrink-0 border-t px-4 py-2.5">{footer}</div>}
      {!maximized &&
        DIRS.map((dir) => (
          <div
            key={dir}
            data-dir={dir}
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            className={cn("absolute z-10 touch-none", HANDLE_CLASS[dir])}
          />
        ))}
    </div>,
    document.body,
  );
}
