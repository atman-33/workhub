// Voice-input indicator window (label `voice-indicator`): a small,
// non-focusable, always-on-top pill shown while recording/transcribing/on
// error. Driven entirely by the Rust side (src-tauri/src/voice.rs), which
// also owns show/hide — this component only reacts to `voice:state` events.
import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AlertCircle, Loader2, Mic } from "lucide-react";
import { cn } from "@/lib/utils";

type VoiceState = "idle" | "recording" | "transcribing" | "error";

interface StatePayload {
  state: VoiceState;
  message?: string | null;
}

export function VoiceIndicatorApp() {
  const [state, setState] = useState<VoiceState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const recordingStart = useRef<number | null>(null);

  useEffect(() => {
    const unlisten = listen<StatePayload>("voice:state", (event) => {
      const { state: next, message: msg } = event.payload;
      setState(next);
      setMessage(msg ?? null);
      if (next === "recording") {
        recordingStart.current = Date.now();
        setElapsed(0);
      } else {
        recordingStart.current = null;
      }
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

  if (state === "idle") return null;

  return (
    <div className="h-screen w-screen overflow-hidden p-1">
      <div className="flex h-full w-full min-w-0 items-center justify-center gap-2 rounded-full border bg-popover px-3.5 text-popover-foreground shadow-lg">
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
      </div>
    </div>
  );
}
