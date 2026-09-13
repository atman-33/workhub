// Voice tab: the voice-input settings (T-0277 moved them here from the
// Settings dialog, matching the Ink and Clips tabs), the meeting mode
// (T-0252: finalized transcripts accumulate into a file while a meeting is
// active), and the history of past transcripts. The history is recorded as a
// safety net in `src-tauri/src/voice.rs` regardless of whether the auto-paste
// succeeded (see the `voice:history-updated` hook), so a lost-focus paste is
// never lost — the text is still here to copy manually. Capped at 50 entries
// server-side (oldest dropped first).
import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Check, Copy, Download, FileText, Loader2, Mic, Play, Settings2, Sparkles, Square, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/graph/confirm-dialog";
import { ModelCombobox } from "@/components/model-combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { VaultScopedBadge } from "@/components/vault-scoped-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Config, MeetingStructStatus, SttModelStatus, VoiceHistoryEntry, VoiceMeeting } from "@/types";

const MAX_ENTRIES = 50;

const VOICE_MODELS: { id: string; label: string; size: string }[] = [
  { id: "tiny", label: "Tiny", size: "75MB" },
  { id: "base", label: "Base", size: "142MB" },
  { id: "small", label: "Small", size: "466MB" },
  { id: "small-q5_1", label: "Small (quantized)", size: "182MB" },
  { id: "large-v3-turbo-q5_0", label: "Large v3 Turbo (quantized)", size: "547MB" },
];

const VOICE_LANGUAGES: { id: string; label: string }[] = [
  { id: "auto", label: "Auto-detect" },
  { id: "ja", label: "Japanese" },
  { id: "en", label: "English" },
];

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

/** The voice-input settings and the local whisper models. */
function VoiceSettings({ configVersion }: { configVersion: number }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [hotkey, setHotkey] = useState("");
  const [modelStatus, setModelStatus] = useState<SttModelStatus[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [error, setError] = useState("");

  const refreshModelStatus = useCallback(async () => {
    setModelStatus(await api.sttModelStatus());
  }, []);

  useEffect(() => {
    void (async () => {
      const cfg = await api.getConfig();
      setConfig(cfg);
      setHotkey(cfg.settings.voice_hotkey);
      await refreshModelStatus();
    })();
  }, [configVersion, refreshModelStatus]);

  useEffect(() => {
    const unlistenProgress = listen<{ model: string; downloaded: number; total: number }>(
      "stt:download-progress",
      (event) => {
        if (event.payload.total > 0) {
          setDownloadProgress(Math.round((event.payload.downloaded / event.payload.total) * 100));
        }
      },
    );
    const unlistenDone = listen<string>("stt:download-done", () => {
      setDownloading(null);
      void refreshModelStatus();
    });
    const unlistenError = listen<{ model: string; message: string }>(
      "stt:download-error",
      (event) => {
        setDownloading(null);
        setError(event.payload.message);
      },
    );
    return () => {
      void unlistenProgress.then((fn) => fn());
      void unlistenDone.then((fn) => fn());
      void unlistenError.then((fn) => fn());
    };
  }, [refreshModelStatus]);

  /** Settings save immediately — there is nothing to review. The patch goes
   * onto a fresh read of the config, so a setting another tab saved
   * meanwhile is not reverted. */
  const patchSettings = useCallback(
    async (patch: Partial<Config["settings"]>) => {
      setError("");
      setConfig((c) => (c ? { ...c, settings: { ...c.settings, ...patch } } : c));
      try {
        setConfig(await api.patchSettings(patch));
        // The "active" badge follows the selected model.
        if ("voice_model" in patch) await refreshModelStatus();
      } catch (e) {
        setError(String(e));
      }
    },
    [refreshModelStatus],
  );

  const downloadModel = async (model: string) => {
    setDownloading(model);
    setDownloadProgress(0);
    setError("");
    try {
      await api.sttDownloadModel(model);
    } catch (e) {
      setDownloading(null);
      setError(String(e));
    }
  };

  const deleteModel = async (model: string) => {
    setError("");
    try {
      await api.sttDeleteModel(model);
      await refreshModelStatus();
    } catch (e) {
      setError(String(e));
    }
  };

  const settings = config?.settings;
  const enabled = settings?.voice_enabled ?? true;
  const noModel = modelStatus.length > 0 && !modelStatus.some((s) => s.downloaded);

  return (
    <div className="flex shrink-0 flex-col gap-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-3">
        <Switch
          checked={enabled}
          disabled={!config}
          onCheckedChange={(v) => void patchSettings({ voice_enabled: v })}
        />
        <span className="text-xs">Enable voice input</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Hotkey</span>
          <Input
            value={hotkey}
            disabled={!config || !enabled}
            onChange={(e) => setHotkey(e.target.value)}
            onBlur={() => {
              if (settings && hotkey !== settings.voice_hotkey) {
                void patchSettings({ voice_hotkey: hotkey });
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            placeholder="Ctrl+Shift+Space"
            className="h-8 w-40 font-mono text-xs"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Model</span>
          <Select
            value={settings?.voice_model ?? "small"}
            disabled={!config || !enabled}
            onValueChange={(v) => void patchSettings({ voice_model: v })}
          >
            <SelectTrigger size="sm" className="w-52">
              <SelectValue className="truncate" />
            </SelectTrigger>
            <SelectContent>
              {VOICE_MODELS.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label} ({m.size})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Language</span>
          <Select
            value={settings?.voice_language ?? "auto"}
            disabled={!config || !enabled}
            onValueChange={(v) => void patchSettings({ voice_language: v })}
          >
            <SelectTrigger size="sm" className="w-32">
              <SelectValue className="truncate" />
            </SelectTrigger>
            <SelectContent>
              {VOICE_LANGUAGES.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Indicator</span>
          <Select
            value={settings?.voice_indicator_placement ?? "caret"}
            disabled={!config || !enabled}
            onValueChange={(v) =>
              void patchSettings({
                voice_indicator_placement: v as Config["settings"]["voice_indicator_placement"],
              })
            }
          >
            <SelectTrigger size="sm" className="w-60">
              <SelectValue className="truncate" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="caret">Follow the text cursor</SelectItem>
              <SelectItem value="fixed">Fixed (remembers where you drag it)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={settings?.voice_system_audio ?? false}
            disabled={!config || !enabled}
            onCheckedChange={(v) => void patchSettings({ voice_system_audio: v })}
          />
          <span className="text-xs">Include system audio</span>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Press the hotkey to dictate into the focused app.{" "}
        {settings?.voice_indicator_placement === "fixed"
          ? "The indicator appears where you last dragged it, or bottom-center of the primary screen."
          : "The indicator appears next to the text cursor of the app you are dictating into, or by the mouse pointer when no text cursor can be found."}{" "}
        Turn on <b>Include system audio</b> during online meetings to also transcribe the other side's
        voice (headphones recommended — with speakers, the remote voice is recorded twice).
      </p>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Local models</p>
        {noModel && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            No model downloaded yet — download one before dictating.
          </p>
        )}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2">
          {VOICE_MODELS.map((m) => {
            const status = modelStatus.find((s) => s.model === m.id);
            const isDownloading = downloading === m.id;
            return (
              <div key={m.id} className="space-y-1 rounded-md border px-2 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5 text-xs">
                    <span className="truncate">{m.label}</span>
                    <span className="shrink-0 text-muted-foreground">({m.size})</span>
                    {status?.active && (
                      <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">
                        active
                      </span>
                    )}
                  </span>
                  {status?.downloaded ? (
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Delete ${m.label}`}
                      onClick={() => void deleteModel(m.id)}
                      disabled={isDownloading}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Download ${m.label}`}
                      onClick={() => void downloadModel(m.id)}
                      disabled={isDownloading}
                    >
                      {isDownloading ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Download className="size-3.5" />
                      )}
                    </Button>
                  )}
                </div>
                {isDownloading && (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${downloadProgress}%` }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** Meeting mode (T-0252, auto-capture since T-0317): starting a meeting also
 * starts recording, and every transcribed utterance is appended to the
 * meeting's Markdown file (`voice_meeting.rs`, via the `voice:meeting-updated`
 * hook) — no hotkey presses needed mid-meeting. The hotkey still works as a
 * manual fallback. Structuring is on demand: the minutes prompt (transcript +
 * instructions for decisions / action items / open questions) is copied to
 * the clipboard and run in whatever agent is at hand (Claude Code /
 * OpenCode). */
function MeetingPanel() {
  const [active, setActive] = useState<VoiceMeeting | null>(null);
  const [meetings, setMeetings] = useState<VoiceMeeting[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [minutes, setMinutes] = useState("");
  const [minutesView, setMinutesView] = useState(false);
  const [struct, setStruct] = useState<MeetingStructStatus | null>(null);
  const [structSettings, setStructSettings] = useState<Config["settings"] | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setActive(await api.voiceMeetingStatus());
      setMeetings(await api.voiceMeetingList());
      setStruct(await api.structStatus());
      setStructSettings((await api.getConfig()).settings);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const unlisten = listen("voice:meeting-updated", () => void refresh());
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [refresh]);

  useEffect(() => {
    const unlisten = listen("voice:struct-updated", () => void refresh());
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [refresh]);

  const shownId = openId ?? active?.id ?? null;

  useEffect(() => {
    if (!shownId) {
      setTranscript("");
      setMinutes("");
      return;
    }
    void api
      .voiceMeetingRead(shownId)
      .then(setTranscript)
      .catch((e: unknown) => setError(String(e)));
    void api
      .voiceMeetingMinutes(shownId)
      .then(setMinutes)
      .catch((e: unknown) => setError(String(e)));
  }, [shownId, active?.entries, struct?.lastOkAt]);

  const handleStart = useCallback(async () => {
    setError("");
    try {
      const meeting = await api.voiceMeetingStart();
      setOpenId(null);
      setActive(meeting);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }, [refresh]);

  const handleStop = useCallback(async () => {
    setError("");
    try {
      await api.voiceMeetingFinish();
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }, [refresh]);

  const handleCopyPrompt = useCallback(
    async (id: string) => {
      setError("");
      try {
        await navigator.clipboard.writeText(await api.voiceMeetingPrompt(id));
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch (e) {
        setError(String(e));
      }
    },
    [],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      setError("");
      try {
        await api.voiceMeetingDelete(id);
        if (openId === id) setOpenId(null);
        await refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [openId, refresh],
  );

  const patchStructSettings = useCallback(async (patch: Partial<Config["settings"]>) => {
    setError("");
    try {
      setStructSettings((await api.patchSettings(patch)).settings);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const handleStructNow = useCallback(async () => {
    setError("");
    try {
      await api.runStructNow();
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }, [refresh]);

  const structLine = !active
    ? null
    : struct?.running
      ? "Structuring…"
      : struct?.lastError
        ? `Structure failed: ${struct.lastError}`
        : struct?.lastOkAt
          ? `Structured ${new Date(struct.lastOkAt * 1000).toLocaleString()} · every ${struct.intervalSecs}s`
          : struct && struct.intervalSecs === 0
            ? "Auto-structure off"
            : `Auto-structure every ${struct?.intervalSecs ?? 120}s`;

  return (
    <div className="flex shrink-0 flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <FileText className="size-4 text-muted-foreground" />
        <h3 className="text-xs font-medium">Meeting mode</h3>
        {active ? (
          <span className="flex items-center gap-1.5 text-xs text-red-500">
            <span className="size-2 animate-pulse rounded-full bg-red-500" />
            Recording · {active.entries} entr{active.entries === 1 ? "y" : "ies"}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            Recording runs on its own during the meeting; each utterance is appended here
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button size="icon-xs" variant="ghost" aria-label="Auto-structure settings">
                <Settings2 />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 space-y-3">
              <p className="flex items-center gap-2 text-sm font-medium">
                Auto-structure
                <VaultScopedBadge />
              </p>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Agent</label>
                <Select
                  value={structSettings?.meeting_struct_assignee ?? "claude-code"}
                  onValueChange={(v) => void patchStructSettings({ meeting_struct_assignee: v })}
                >
                  <SelectTrigger size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="claude-code">Claude Code</SelectItem>
                    <SelectItem value="opencode">OpenCode</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Model</label>
                <ModelCombobox
                  assignee={structSettings?.meeting_struct_assignee ?? "claude-code"}
                  value={structSettings?.meeting_struct_model ?? ""}
                  onChange={(v) => void patchStructSettings({ meeting_struct_model: v })}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Every (seconds, 0 = off)
                </label>
                <Input
                  type="number"
                  min={0}
                  value={structSettings?.meeting_struct_interval_secs ?? 120}
                  onChange={(e) =>
                    void patchStructSettings({
                      meeting_struct_interval_secs: Math.max(
                        0,
                        parseInt(e.target.value, 10) || 0,
                      ),
                    })
                  }
                  className="h-8 font-mono text-xs"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Only new transcript goes to the agent — a run with nothing new costs nothing.
              </p>
            </PopoverContent>
          </Popover>
          {shownId && (
            <Button
              size="xs"
              variant="outline"
              onClick={() => void handleCopyPrompt(shownId)}
            >
              {copied ? <Check className="text-emerald-500" /> : <Copy />}
              Minutes prompt
            </Button>
          )}
          {active && (
            <Button size="xs" variant="outline" onClick={() => void handleStructNow()}>
              <Sparkles />
              Structure now
            </Button>
          )}
          {active ? (
            <Button size="xs" variant="outline" onClick={() => void handleStop()}>
              <Square />
              Stop
            </Button>
          ) : (
            <Button size="xs" variant="outline" onClick={() => void handleStart()}>
              <Play />
              Start meeting
            </Button>
          )}
        </div>
      </div>

      {structLine && (
        <p className="text-[11px] text-muted-foreground">{structLine}</p>
      )}

      {shownId && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1">
            <Button
              size="xs"
              variant={minutesView ? "ghost" : "outline"}
              onClick={() => setMinutesView(false)}
            >
              Transcript
            </Button>
            <Button
              size="xs"
              variant={minutesView ? "outline" : "ghost"}
              onClick={() => setMinutesView(true)}
            >
              Minutes
            </Button>
          </div>
          <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-2 text-xs">
            {minutesView
              ? minutes || "Not structured yet…"
              : transcript || "Waiting for the first transcript…"}
          </pre>
        </div>
      )}

      {meetings.length > 0 && (
        <div className="flex flex-col gap-1">
          {meetings.map((m) => (
            <div key={m.id} className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => setOpenId((o) => (o === m.id ? null : m.id))}
                className="min-w-0 flex-1 truncate text-left text-muted-foreground hover:text-foreground"
              >
                {formatCreated(m.started)} · {m.entries} entr{m.entries === 1 ? "y" : "ies"}
                {m.id === active?.id && " (live)"}
              </button>
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => void handleDelete(m.id)}
                aria-label="Delete meeting"
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function VoiceView({ configVersion }: { configVersion: number }) {
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
        <h2 className="text-sm font-medium">Voice</h2>
        <span className="truncate text-xs text-muted-foreground">
          Dictate into any app with a hotkey, transcribed locally
        </span>
      </div>

      <VoiceSettings configVersion={configVersion} />

      <MeetingPanel />

      <div className="flex shrink-0 items-center gap-2">
        <h3 className="text-xs font-medium">History</h3>
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
