// Voice tab: history of past voice-input transcripts. Recorded as a safety
// net in `src-tauri/src/voice.rs` regardless of whether the auto-paste
// succeeded (see the `voice:history-updated` hook), so a lost-focus paste is
// never lost — the text is still here to copy manually. Capped at 50
// entries server-side (oldest dropped first).
import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Check, Copy, Mic, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/graph/confirm-dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { VoiceHistoryEntry } from "@/types";

const MAX_ENTRIES = 50;

function formatCreated(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function HistoryRow({
  entry,
  onDelete,
}: {
  entry: VoiceHistoryEntry;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(entry.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [entry.text]);

  return (
    <div className="flex flex-col gap-1.5 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          {formatCreated(entry.created)} · {entry.model}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="icon-xs" variant="ghost" onClick={() => void handleCopy()} aria-label="Copy">
            {copied ? <Check className="text-emerald-500" /> : <Copy />}
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => onDelete(entry.id)}
            aria-label="Delete"
          >
            <Trash2 />
          </Button>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className={cn(
          "whitespace-pre-wrap break-words text-left text-sm",
          !expanded && "line-clamp-3",
        )}
      >
        {entry.text}
      </button>
    </div>
  );
}

export function VoiceView() {
  const [entries, setEntries] = useState<VoiceHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearOpen, setClearOpen] = useState(false);

  const refresh = useCallback(async () => {
    const list = await api.voiceHistoryList();
    setEntries(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const unlisten = listen("voice:history-updated", () => void refresh());
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [refresh]);

  const handleDelete = useCallback(
    (id: string) => {
      setEntries((prev) => prev.filter((e) => e.id !== id));
      void api.voiceHistoryDelete(id);
    },
    [],
  );

  const confirmClear = useCallback(() => {
    setClearOpen(false);
    setEntries([]);
    void api.voiceHistoryClear();
  }, []);

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden p-4">
      <div className="flex shrink-0 items-center gap-2">
        <Mic className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Voice history</h2>
        <span className="text-xs text-muted-foreground">
          {entries.length} entr{entries.length === 1 ? "y" : "ies"} · only the latest{" "}
          {MAX_ENTRIES} are kept
        </span>
        <Button
          size="xs"
          variant="outline"
          className="ml-auto"
          disabled={entries.length === 0}
          onClick={() => setClearOpen(true)}
        >
          Clear all
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No voice transcripts yet. Recordings are saved here automatically, even if the
            paste into another app fails or its target loses focus.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {entries.map((entry) => (
              <HistoryRow key={entry.id} entry={entry} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={clearOpen}
        title="Clear voice history"
        description={`Delete all ${entries.length} saved transcript${entries.length === 1 ? "" : "s"}? This cannot be undone.`}
        confirmLabel="Clear all"
        destructive
        onConfirm={confirmClear}
        onClose={() => setClearOpen(false)}
      />
    </div>
  );
}
