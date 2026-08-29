// Preview of one ink capture, with a crop selection on top of it.
//
// Cropping lives here rather than in the overlay: during a drawing session the
// left button is the pen and Alt is held down, so a second drag mode there
// would be both cramped and a one-shot — get the rectangle wrong and the shot
// is gone. Here it can be redone as often as needed, and the result reuses the
// same save/copy path as Alt+C.
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Crop, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import type { InkCapture } from "@/types";

/** Drags shorter than this are a click that missed, not a selection. */
const MIN_DRAG = 6;
/** Grab area of a resize handle, in displayed pixels. */
const HANDLE = 10;

interface Rect {
  /** All four in *displayed* pixels; converted to natural pixels on export. */
  x: number;
  y: number;
  w: number;
  h: number;
}

type Grip = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "move";

function normalize(rect: Rect): Rect {
  return {
    x: rect.w < 0 ? rect.x + rect.w : rect.x,
    y: rect.h < 0 ? rect.y + rect.h : rect.y,
    w: Math.abs(rect.w),
    h: Math.abs(rect.h),
  };
}

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(value, max));
}

/** Which part of the selection the pointer is on, if any. */
function gripAt(rect: Rect, x: number, y: number): Grip | null {
  const nearLeft = Math.abs(x - rect.x) <= HANDLE;
  const nearRight = Math.abs(x - (rect.x + rect.w)) <= HANDLE;
  const nearTop = Math.abs(y - rect.y) <= HANDLE;
  const nearBottom = Math.abs(y - (rect.y + rect.h)) <= HANDLE;
  const insideX = x >= rect.x - HANDLE && x <= rect.x + rect.w + HANDLE;
  const insideY = y >= rect.y - HANDLE && y <= rect.y + rect.h + HANDLE;
  if (!insideX || !insideY) return null;
  if (nearTop && nearLeft) return "nw";
  if (nearTop && nearRight) return "ne";
  if (nearBottom && nearLeft) return "sw";
  if (nearBottom && nearRight) return "se";
  if (nearTop) return "n";
  if (nearBottom) return "s";
  if (nearLeft) return "w";
  if (nearRight) return "e";
  if (x > rect.x && x < rect.x + rect.w && y > rect.y && y < rect.y + rect.h) return "move";
  return null;
}

const CURSORS: Record<Grip, string> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
  move: "move",
};

/** Applies a drag of (dx, dy) on `grip` to the rectangle it started from. */
function resize(start: Rect, grip: Grip, dx: number, dy: number, max: Rect): Rect {
  if (grip === "move") {
    return {
      ...start,
      x: clamp(start.x + dx, max.w - start.w),
      y: clamp(start.y + dy, max.h - start.h),
    };
  }
  let { x, y, w, h } = start;
  if (grip.includes("w")) {
    const nx = clamp(x + dx, max.w);
    w += x - nx;
    x = nx;
  }
  if (grip.includes("e")) w = clamp(w + dx, max.w - x);
  if (grip.includes("n")) {
    const ny = clamp(y + dy, max.h);
    h += y - ny;
    y = ny;
  }
  if (grip.includes("s")) h = clamp(h + dy, max.h - y);
  return normalize({ x, y, w, h });
}

export function InkCaptureDialog({
  capture,
  onClose,
  onSaved,
}: {
  capture: InkCapture | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [src, setSrc] = useState("");
  const [rect, setRect] = useState<Rect | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ grip: Grip; origin: Rect; startX: number; startY: number } | null>(null);

  useEffect(() => {
    setRect(null);
    setSrc("");
    setError("");
    setCopied(false);
    if (!capture) return;
    let cancelled = false;
    void (async () => {
      try {
        const url = await api.readInkCapture(capture.path);
        if (!cancelled) setSrc(url);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [capture]);

  /** Displayed size, which every rectangle here is expressed in. */
  const bounds = useCallback((): Rect => {
    const el = imageRef.current;
    return { x: 0, y: 0, w: el?.clientWidth ?? 0, h: el?.clientHeight ?? 0 };
  }, []);

  const pointAt = (e: React.PointerEvent<HTMLDivElement>): { x: number; y: number } => {
    const box = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const { x, y } = pointAt(e);
    const grip = rect ? gripAt(rect, x, y) : null;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (grip && rect) {
      dragRef.current = { grip, origin: rect, startX: x, startY: y };
      return;
    }
    // A fresh selection: drag the south-east corner out of an empty rect.
    const seed = { x, y, w: 0, h: 0 };
    dragRef.current = { grip: "se", origin: seed, startX: x, startY: y };
    setRect(seed);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const { x, y } = pointAt(e);
    if (!drag) {
      // Hover feedback only: the cursor says what a drag from here would do.
      const grip = rect ? gripAt(rect, x, y) : null;
      e.currentTarget.style.cursor = grip ? CURSORS[grip] : "crosshair";
      return;
    }
    setRect(resize(drag.origin, drag.grip, x - drag.startX, y - drag.startY, bounds()));
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    setRect((current) => {
      if (!current) return current;
      // A stray click clears the selection instead of leaving a sliver that
      // the export would round down to nothing.
      return current.w < MIN_DRAG || current.h < MIN_DRAG ? null : current;
    });
  };

  /** The selection (or the whole image) as base64 PNG at natural resolution. */
  const render = (): string => {
    const el = imageRef.current;
    if (!el || !capture) return "";
    const scale = capture.width / (el.clientWidth || capture.width);
    const area = rect
      ? {
          x: Math.round(rect.x * scale),
          y: Math.round(rect.y * scale),
          w: Math.max(1, Math.round(rect.w * scale)),
          h: Math.max(1, Math.round(rect.h * scale)),
        }
      : { x: 0, y: 0, w: capture.width, h: capture.height };
    const canvas = document.createElement("canvas");
    canvas.width = area.w;
    canvas.height = area.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.drawImage(el, area.x, area.y, area.w, area.h, 0, 0, area.w, area.h);
    return canvas.toDataURL("image/png").split(",")[1] ?? "";
  };

  const copy = useCallback(async () => {
    if (!capture) return;
    setBusy(true);
    setError("");
    try {
      const data = render();
      // No selection: the file on disk is already the image, so copy it
      // straight from there rather than re-encoding it.
      if (!rect) await api.copyInkCapture(capture.path);
      else await api.copyInkPng(data);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [capture, rect]);

  const saveCrop = useCallback(async () => {
    if (!capture || !rect) return;
    setBusy(true);
    setError("");
    try {
      await api.saveInkCrop(capture.path, render());
      onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [capture, rect, onSaved]);

  // Esc clears the selection first and only closes the dialog once there is
  // nothing selected, so an unwanted rectangle is one key away from gone.
  useEffect(() => {
    if (!capture) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && rect) {
        e.preventDefault();
        e.stopPropagation();
        setRect(null);
        return;
      }
      if (e.key === "Enter" && rect) {
        e.preventDefault();
        void saveCrop();
        return;
      }
      if (e.key.toLowerCase() === "c" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void copy();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capture, rect, copy, saveCrop]);

  const selection = rect
    ? (() => {
        const el = imageRef.current;
        const scale = capture && el?.clientWidth ? capture.width / el.clientWidth : 1;
        return `${Math.round(rect.w * scale)} × ${Math.round(rect.h * scale)}`;
      })()
    : capture
      ? `${capture.width} × ${capture.height}`
      : "";

  return (
    <Dialog open={!!capture} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex max-h-[92vh] max-w-[min(96vw,1400px)] flex-col gap-3 p-4"
        showCloseButton={false}
      >
        <div className="flex shrink-0 items-center gap-2">
          <DialogTitle className="truncate text-sm font-medium">{capture?.name}</DialogTitle>
          <span className="shrink-0 text-xs text-muted-foreground">
            {rect ? "Selection" : "Full image"} {selection}
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void copy()}>
              {copied ? <Check className="text-emerald-500" /> : <Copy />}
              {rect ? "Copy selection" : "Copy"}
            </Button>
            <Button size="sm" variant="outline" disabled={busy || !rect} onClick={() => void saveCrop()}>
              <Save />
              Save crop
            </Button>
            <Button size="sm" variant="ghost" disabled={!rect} onClick={() => setRect(null)}>
              <Crop />
              Clear
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close">
              <X />
            </Button>
          </div>
        </div>

        {error && <p className="shrink-0 text-xs text-destructive">{error}</p>}

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-md bg-muted/40">
          {src ? (
            <div
              className="relative touch-none select-none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <img
                ref={imageRef}
                src={src}
                alt={capture?.name ?? ""}
                draggable={false}
                className="block max-h-[74vh] max-w-full object-contain"
              />
              {rect && (
                <div
                  className="pointer-events-none absolute border border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
                  style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
                />
              )}
            </div>
          ) : (
            <p className="p-8 text-xs text-muted-foreground">Loading…</p>
          )}
        </div>

        <p className="shrink-0 text-[11px] text-muted-foreground">
          Drag to select a region, drag its edges to adjust, drag inside it to move. Ctrl+C copies,
          Enter saves the crop beside the original, Esc clears the selection.
        </p>
      </DialogContent>
    </Dialog>
  );
}
