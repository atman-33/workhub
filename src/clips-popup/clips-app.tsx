// Clips popup window (label `clips-popup`): the snippet picker opened by the
// double-tap gesture. Shown/hidden by the Rust side (src-tauri/src/clips/);
// each `clips://activate` event reloads the list and resets the filter.
//
// Picking a snippet hands the work back to the backend (`clips_paste`), which
// restores focus to the app that had it before pasting — this window must not
// try to paste itself, since it is the one holding focus.
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ClipboardList } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Clip } from "@/types";

/** Snippets past this position lose their number-key shortcut. */
const QUICK_KEYS = 9;

function displayLabel(clip: Clip): string {
  const label = clip.label.trim();
  if (label) return label;
  const firstLine = clip.text.split("\n", 1)[0]?.trim() ?? "";
  return firstLine || "(empty)";
}

function matches(clip: Clip, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    clip.label.toLowerCase().includes(q) || clip.text.toLowerCase().includes(q)
  );
}

export function ClipsApp() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(
    () => clips.filter((clip) => matches(clip, query)),
    [clips, query],
  );

  const init = useCallback(async () => {
    setQuery("");
    setSelected(0);
    setError("");
    setClips(await api.clipsList());
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    void init();
    const unlisten = listen("clips://activate", () => void init());
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [init]);

  // Keep the highlighted row in view as the arrow keys move it.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const hide = () => void api.clipsHide();

  const paste = useCallback(async (clip: Clip | undefined) => {
    if (!clip) return;
    try {
      await api.clipsPaste(clip.id);
    } catch (e) {
      // The backend already put the text on the clipboard in this case, so
      // the snippet is not lost — say so instead of failing silently.
      setError(String(e));
    }
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      hide();
      return;
    }
    if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) {
      e.preventDefault();
      setSelected((i) => (visible.length ? (i + 1) % visible.length : 0));
      return;
    }
    if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) {
      e.preventDefault();
      setSelected((i) =>
        visible.length ? (i - 1 + visible.length) % visible.length : 0,
      );
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      void paste(visible[selected]);
      return;
    }
    // Ctrl+1..9 pick directly; the chord is needed because the filter box
    // has to keep plain digits for searching.
    if (e.ctrlKey && /^[1-9]$/.test(e.key)) {
      e.preventDefault();
      void paste(visible[Number(e.key) - 1]);
    }
  };

  return (
    <div
      className="flex h-screen flex-col bg-background text-foreground"
      onKeyDown={onKeyDown}
    >
      {/* Whole-header drag via startDragging(): `data-tauri-drag-region` only
          fires when the element directly under the cursor carries it. */}
      <header
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          getCurrentWindow().startDragging().catch(console.error);
        }}
        className="flex cursor-move select-none items-center gap-1.5 border-b px-3 py-2 text-xs font-medium text-muted-foreground"
      >
        <ClipboardList className="size-3.5" />
        Clips
        <span className="ml-auto font-normal">
          ↑↓ select · Enter paste · Ctrl+1-9 quick · Esc close
        </span>
      </header>

      <div className="shrink-0 p-2">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          placeholder="Filter…"
          className="h-8 w-full rounded-md border bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring"
        />
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {visible.length === 0 ? (
          <p className="p-2 text-sm text-muted-foreground">
            {clips.length === 0
              ? "No snippets yet — add them in the workhub Clips tab."
              : "No snippet matches the filter."}
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {visible.map((clip, index) => (
              <button
                key={clip.id}
                type="button"
                data-index={index}
                onMouseEnter={() => setSelected(index)}
                onClick={() => void paste(clip)}
                className={cn(
                  "flex items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                  index === selected ? "bg-accent" : "hover:bg-accent/50",
                )}
              >
                <span className="w-4 shrink-0 pt-0.5 text-[11px] text-muted-foreground">
                  {index < QUICK_KEYS ? index + 1 : ""}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{displayLabel(clip)}</span>
                  {clip.label.trim() && (
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {clip.text.split("\n", 1)[0]}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <p className="shrink-0 border-t px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
