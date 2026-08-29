// Ink preview window (label `ink-preview`): a floating always-on-top window
// that shows one saved capture at full size, with a crop selection on top of
// it. Opened from the Ink tab; the Rust side shows the pre-built window and
// emits `ink-preview://open` with the capture path (see src-tauri/src/
// ink_preview.rs), and every open re-initializes the form — the same
// contract as the quick-capture window.
//
// Cropping lives here rather than in the drawing overlay: during a session
// the left button is the pen and Alt is held down, so a second drag mode
// there would be cramped and a one-shot. Here the window can be dragged
// wherever it does not cover the reference material and resized until the
// region to select is comfortably large, and the result reuses the same
// save/copy path as Alt+C.
import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Check, Copy, Crop, Loader2, Save, Scissors, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  CURSORS,
  MIN_DRAG,
  gripAt,
  resize as resizeRect,
  type Grip,
  type Rect,
} from "@/lib/crop-rect";

function hide() {
  void invoke("ink_preview_hide");
}

/**
 * Header button with a shadcn/ui tooltip instead of the browser's `title`.
 * The button rides inside a span because a disabled button swallows pointer
 * events and would never show its tooltip; when disabled it gets
 * `pointer-events-none` so the span becomes the hover target (radix's own
 * recommendation for disabled triggers). Enabled buttons keep their clicks.
 */
function TipButton({ label, ...props }: ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button
            size="icon-sm"
            variant="ghost"
            {...props}
            className={cn(props.className, props.disabled && "pointer-events-none")}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export function PreviewApp() {
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [src, setSrc] = useState("");
  const [rect, setRect] = useState<Rect | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [savedNote, setSavedNote] = useState("");
  const [error, setError] = useState("");
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ grip: Grip; origin: Rect; startX: number; startY: number } | null>(null);

  useEffect(() => {
    const unlisten = listen<{ path: string }>("ink-preview://open", (event) => {
      const next = event.payload.path;
      setPath(next);
      setName(next.split("/").pop() ?? next);
      setRect(null);
      setSrc("");
      setError("");
      setCopied(false);
      setSavedNote("");
      void (async () => {
        try {
          setSrc(await api.readInkCapture(next));
        } catch (e) {
          setError(String(e));
        }
      })();
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  /** Displayed size of the image, which every rectangle here is expressed in. */
  const bounds = useCallback(
    (): Rect => ({
      x: 0,
      y: 0,
      w: imageRef.current?.clientWidth ?? 0,
      h: imageRef.current?.clientHeight ?? 0,
    }),
    [],
  );

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
    setRect(resizeRect(drag.origin, drag.grip, x - drag.startX, y - drag.startY, bounds()));
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
    if (!el) return "";
    const scale = el.naturalWidth / (el.clientWidth || el.naturalWidth);
    const area = rect
      ? {
          x: Math.round(rect.x * scale),
          y: Math.round(rect.y * scale),
          w: Math.max(1, Math.round(rect.w * scale)),
          h: Math.max(1, Math.round(rect.h * scale)),
        }
      : { x: 0, y: 0, w: el.naturalWidth, h: el.naturalHeight };
    const canvas = document.createElement("canvas");
    canvas.width = area.w;
    canvas.height = area.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.drawImage(el, area.x, area.y, area.w, area.h, 0, 0, area.w, area.h);
    return canvas.toDataURL("image/png").split(",")[1] ?? "";
  };

  const copy = useCallback(async () => {
    if (!path) return;
    setBusy(true);
    setError("");
    try {
      const data = render();
      // No selection: the file on disk is already the image, so copy it
      // straight from there rather than re-encoding it.
      if (!rect) await api.copyInkCapture(path);
      else await api.copyInkPng(data);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [path, rect]);

  const saveCrop = useCallback(async () => {
    if (!path || !rect) return;
    setBusy(true);
    setError("");
    try {
      const saved = await api.saveInkCrop(path, render());
      // The main window's list refreshes itself on the backend's
      // captures-changed event; this just confirms what landed.
      setSavedNote(`Saved ${saved.split("/").pop() ?? saved}`);
      setTimeout(() => setSavedNote(""), 2500);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [path, rect]);

  // Esc clears the selection first and only closes the window once there is
  // nothing selected, so an unwanted rectangle is one key away from gone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (rect) setRect(null);
        else hide();
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
  }, [rect, copy, saveCrop]);

  const natural = (() => {
    const el = imageRef.current;
    return el?.naturalWidth ? `${el.naturalWidth} × ${el.naturalHeight}` : "";
  })();
  const selection = rect
    ? (() => {
        const el = imageRef.current;
        const scale = el?.clientWidth ? el.naturalWidth / el.clientWidth : 1;
        return `${Math.round(rect.w * scale)} × ${Math.round(rect.h * scale)}`;
      })()
    : "";

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
        {/* Whole-header drag via startDragging(): the `data-tauri-drag-region`
            attribute only fires when the element directly under the cursor has
            it, so the icon/text/badge children would be dead zones. */}
        <header
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            if ((e.target as HTMLElement).closest("button")) return;
            getCurrentWindow().startDragging().catch(console.error);
          }}
          className="flex shrink-0 cursor-move select-none items-center gap-2 border-b px-3 py-2"
        >
          <Scissors className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate text-xs font-medium" title={path}>
            {name || "Ink preview"}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {selection ? `${selection} selected` : natural}
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <TipButton
              label={rect ? "Copy selection (Ctrl+C)" : "Copy image (Ctrl+C)"}
              disabled={busy || (!src && !rect)}
              onClick={() => void copy()}
              aria-label="Copy to clipboard"
            >
              {copied ? <Check className="text-emerald-500" /> : <Copy />}
            </TipButton>
            <TipButton
              label="Save the selection beside the original (Enter)"
              disabled={busy || !rect}
              onClick={() => void saveCrop()}
              aria-label="Save crop"
            >
              <Save />
            </TipButton>
            <TipButton
              label="Clear the selection (Esc)"
              disabled={!rect}
              onClick={() => setRect(null)}
              aria-label="Clear selection"
            >
              <Crop />
            </TipButton>
            <TipButton label="Close (Esc)" onClick={hide} aria-label="Close preview">
              <X />
            </TipButton>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/40 p-3">
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
                alt={name}
                draggable={false}
                className="block max-h-[calc(100vh-7rem)] max-w-full object-contain"
              />
              {rect && (
                <div
                  className="pointer-events-none absolute border border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
                  style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
                />
              )}
            </div>
          ) : error ? (
            <p className="max-w-full truncate p-4 text-xs text-destructive" title={error}>
              {error}
            </p>
          ) : (
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 px-3 py-1.5">
          {error ? (
            <p className="min-w-0 flex-1 truncate text-[11px] text-destructive" title={error}>
              {error}
            </p>
          ) : savedNote ? (
            <p className="flex min-w-0 flex-1 items-center gap-1 truncate text-[11px] text-emerald-500">
              <Check className="size-3 shrink-0" />
              {savedNote}
            </p>
          ) : (
            <p className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
              Drag to select · drag its edges to adjust · drag inside to move · Ctrl+C copies · Enter
              saves the crop · Esc clears, then closes
            </p>
          )}
        </div>
        </div>
    </TooltipProvider>
  );
}
