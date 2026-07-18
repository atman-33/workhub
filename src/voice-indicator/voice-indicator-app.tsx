// Voice-input indicator window (label `voice-indicator`): a small,
// non-focusable, always-on-top pill/preview panel shown while
// recording/transcribing/on error. Driven mostly by the Rust side
// (src-tauri/src/voice.rs), which owns show/hide/resize/position — this
// component reacts to `voice:state` and `voice:preview` events and renders
// accordingly. The pill (and, in preview mode, its header row) is
// draggable; Rust remembers where the user leaves it.
import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AlertCircle, Loader2, Mic, Square } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type VoiceState = "idle" | "recording" | "transcribing" | "error";

interface StatePayload {
  state: VoiceState;
  message?: string | null;
}

interface PreviewPayload {
  text: string;
}

export function VoiceIndicatorApp() {
  const [state, setState] = useState<VoiceState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [preview, setPreview] = useState("");
  const recordingStart = useRef<number | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unlisten = listen<StatePayload>("voice:state", (event) => {
      const { state: next, message: msg } = event.payload;
      setState(next);
      setMessage(msg ?? null);
      if (next === "recording") {
        recordingStart.current = Date.now();
        setElapsed(0);
        // A fresh recording always starts clean, even if the previous
        // session left preview text behind.
        setPreview("");
      } else {
        recordingStart.current = null;
        if (next === "idle") setPreview("");
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<PreviewPayload>("voice:preview", (event) => {
      setPreview(event.payload.text);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (state !== "recording") return;
    const id = setInterval(() => {
      if (recordingStart.current) {
        setElapsed(Math.floor((Date.now() - recordingStart.current) / 1000));
      }
    }, 250);
    return () => clearInterval(id);
  }, [state]);

  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [preview]);

  if (state === "idle") return null;

  const hasPreview = preview.trim().length > 0;
  // Pill layout stays until preview text actually exists (Rust only grows
  // the window on the first `voice:preview` event, so rendering the preview
  // panel any earlier would cram it into the 48px pill window) and for
  // errors.
  const isPreviewMode = hasPreview && (state === "recording" || state === "transcribing");

  const stopButton = state === "recording" && (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void api.voiceStopRecording();
      }}
      aria-label="Stop recording"
      className="flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground/70 transition-colors hover:bg-foreground/10 hover:text-foreground"
    >
      <Square className="size-3.5 fill-current" />
    </button>
  );

  const statusRow = (
    <>
      {state === "recording" && (
        <>
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
            <span className="relative inline-flex size-2.5 rounded-full bg-red-500" />
          </span>
          <Mic className="size-3.5 text-muted-foreground" />
          <span className="font-mono text-xs tabular-nums">
            {String(Math.floor(elapsed / 60)).padStart(2, "0")}:
            {String(elapsed % 60).padStart(2, "0")}
          </span>
        </>
      )}
      {state === "transcribing" && (
        <>
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          <span className="text-xs">Transcribing…</span>
        </>
      )}
      {state === "error" && (
        <>
          <AlertCircle className="size-3.5 shrink-0 text-destructive" />
          <span
            className={cn("min-w-0 flex-1 truncate text-xs text-destructive")}
            title={message ?? undefined}
          >
            {message ?? "Voice input error"}
          </span>
        </>
      )}
    </>
  );

  if (isPreviewMode) {
    return (
      <div className="flex h-screen w-screen flex-col overflow-hidden p-1">
        <div className="flex h-full w-full min-w-0 flex-col overflow-hidden rounded-2xl border bg-popover p-2 text-popover-foreground shadow-lg">
          {/* Whole-header drag via startDragging() — `data-tauri-drag-region`
              only fires on the element directly under the cursor, so the
              icon/timer children would be dead zones (see quick-capture).
              Header-only, so dragging never fights the transcript below. */}
          <div
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              if ((e.target as HTMLElement).closest("button")) return;
              getCurrentWindow().startDragging().catch(console.error);
            }}
            className="flex shrink-0 cursor-move select-none items-center gap-2 px-1.5 py-1"
          >
            {statusRow}
            {stopButton && <span className="ml-auto flex items-center">{stopButton}</span>}
          </div>
          <div
            ref={previewRef}
            className="voice-preview-scroll mt-1 min-h-0 flex-1 overflow-y-auto rounded-md bg-background/40 px-2 py-1.5 text-xs text-muted-foreground"
          >
            {preview || <span className="italic opacity-60">Listening…</span>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden p-1">
      <div
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          if ((e.target as HTMLElement).closest("button")) return;
          getCurrentWindow().startDragging().catch(console.error);
        }}
        className="flex h-full w-full min-w-0 cursor-move select-none items-center justify-center gap-2 rounded-full border bg-popover px-3.5 text-popover-foreground shadow-lg"
      >
        {statusRow}
        {stopButton}
      </div>
    </div>
  );
}
