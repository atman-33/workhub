// Voice tab: the voice-input settings (T-0277 moved them here from the
// Settings dialog, matching the Ink and Clips tabs), the meeting mode
// (T-0252: finalized transcripts accumulate into a file while a meeting is
// active), and the history of past transcripts, split into Dictate / Meeting /
// History sub-tabs (T-0334) so meeting work and dictation history stop sharing
// one scroll. The history is recorded as a safety net in
// `src-tauri/src/voice.rs` regardless of whether the auto-paste succeeded (see
// the `voice:history-updated` hook), so a lost-focus paste is never lost — the
// text is still here to copy manually. Capped at 50 entries server-side
// (oldest dropped first).
import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Check, Copy, Download, FileText, Loader2, Maximize2, Mic, Play, Settings2, Sparkles, Square, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/graph/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ModelCombobox } from "@/components/model-combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { useT, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Config, MeetingStructStatus, SttModelStatus, VoiceCaptureStatus, VoiceHistoryEntry, VoiceMeeting } from "@/types";

const MAX_ENTRIES = 50;

// Model names are what whisper.cpp calls them upstream — not translated.
const VOICE_MODELS: { id: string; label: string; size: string }[] = [
  { id: "tiny", label: "Tiny", size: "75MB" },
  { id: "base", label: "Base", size: "142MB" },
  { id: "small", label: "Small", size: "466MB" },
  { id: "small-q5_1", label: "Small (quantized)", size: "182MB" },
  { id: "large-v3-turbo-q5_0", label: "Large v3 Turbo (quantized)", size: "547MB" },
];

const VOICE_LANGUAGES: { id: string; labelKey: MessageKey }[] = [
  { id: "auto", labelKey: "voice.settings.language.auto" },
  { id: "ja", labelKey: "voice.settings.language.ja" },
  { id: "en", labelKey: "voice.settings.language.en" },
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
  const t = useT();
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
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => void handleCopy()}
            aria-label={t("voice.history.copyAria")}
          >
            {copied ? <Check className="text-emerald-500" /> : <Copy />}
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => onDelete(entry.id)}
            aria-label={t("voice.history.deleteAria")}
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
  const t = useT();
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
        <span className="text-xs">{t("voice.settings.enable")}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t("voice.settings.hotkey")}</span>
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
          <span className="text-xs text-muted-foreground">{t("voice.settings.model")}</span>
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
          <span className="text-xs text-muted-foreground">{t("voice.settings.language")}</span>
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
                  {t(l.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t("voice.settings.indicator")}</span>
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
              <SelectItem value="caret">{t("voice.settings.indicatorCaret")}</SelectItem>
              <SelectItem value="fixed">{t("voice.settings.indicatorFixed")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={settings?.voice_system_audio ?? false}
            disabled={!config || !enabled}
            onCheckedChange={(v) => void patchSettings({ voice_system_audio: v })}
          />
          <span className="text-xs">{t("voice.settings.includeSystemAudio")}</span>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {t("voice.settings.hintPrefix")}{" "}
        {settings?.voice_indicator_placement === "fixed"
          ? t("voice.settings.hintIndicatorFixed")
          : t("voice.settings.hintIndicatorCaret")}{" "}
        {t("voice.settings.hintSystemAudioPrefix")} <b>{t("voice.settings.hintSystemAudioBold")}</b>{" "}
        {t("voice.settings.hintSystemAudioSuffix")}
      </p>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">{t("voice.models.title")}</p>
        {noModel && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            {t("voice.models.none")}
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
                        {t("voice.models.active")}
                      </span>
                    )}
                  </span>
                  {status?.downloaded ? (
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      aria-label={t("voice.models.deleteAria", { model: m.label })}
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
                      aria-label={t("voice.models.downloadAria", { model: m.label })}
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
function MeetingPanel({ onActiveChange }: { onActiveChange?: (isActive: boolean) => void }) {
  const t = useT();
  const [active, setActive] = useState<VoiceMeeting | null>(null);
  const [meetings, setMeetings] = useState<VoiceMeeting[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [minutes, setMinutes] = useState("");
  const [minutesView, setMinutesView] = useState(false);
  const [struct, setStruct] = useState<MeetingStructStatus | null>(null);
  const [capture, setCapture] = useState<VoiceCaptureStatus | null>(null);
  const [notice, setNotice] = useState("");
  const [showLog, setShowLog] = useState(false);
  const [structLog, setStructLog] = useState("");
  const [structSettings, setStructSettings] = useState<Config["settings"] | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedBody, setCopiedBody] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  /** Meeting waiting for delete confirmation — deletion is permanent (T-0336). */
  const [deleteTarget, setDeleteTarget] = useState<VoiceMeeting | null>(null);

  const refresh = useCallback(async () => {
    try {
      setActive(await api.voiceMeetingStatus());
      setMeetings(await api.voiceMeetingList());
      setStruct(await api.structStatus());
      setCapture(await api.captureStatus());
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

  // Capture phase changes (indicator stop/start, auto-restart) emit no
  // meeting event of their own — mirror them so the badge never lies (T-0333).
  useEffect(() => {
    const unlisten = listen("voice:state", () => void refresh());
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [refresh]);

  // Report meeting start/end to the tab owner once per transition (T-0334).
  const prevActive = useRef(false);
  useEffect(() => {
    const isActive = active !== null;
    if (isActive !== prevActive.current) {
      prevActive.current = isActive;
      onActiveChange?.(isActive);
    }
  }, [active, onActiveChange]);

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

  // Struct run log for the debug viewer below (T-0333). Re-read whenever a
  // run starts or lands, so handoff and progress stay visible.
  useEffect(() => {
    if (!showLog || !shownId) {
      setStructLog("");
      return;
    }
    void api
      .structLog(shownId)
      .then(setStructLog)
      .catch((e: unknown) => setStructLog(String(e)));
  }, [showLog, shownId, struct?.running, struct?.lastOkAt, struct?.lastError]);

  const handleStart = useCallback(async () => {
    setError("");
    setNotice("");
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
    setNotice("");
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

  /** Copy the currently shown transcript/minutes body (T-0352). */
  const handleCopyBody = useCallback(async () => {
    setError("");
    try {
      const text = minutesView ? minutes : transcript;
      if (!text) return;
      await navigator.clipboard.writeText(text);
      setCopiedBody(true);
      setTimeout(() => setCopiedBody(false), 1500);
    } catch (e) {
      setError(String(e));
    }
  }, [minutes, minutesView, transcript]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleteTarget(null);
    setError("");
    try {
      await api.voiceMeetingDelete(id);
      if (openId === id) setOpenId(null);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }, [deleteTarget, openId, refresh]);

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
    setNotice("");
    try {
      // The backend runs asynchronously — show its acknowledgement ("Started"
      // vs "Nothing new") until the run reports back (T-0333).
      setNotice(await api.runStructNow());
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }, [refresh]);

  // A finished run (or a fresh failure) supersedes the acknowledgement above.
  useEffect(() => {
    setNotice("");
  }, [struct?.lastOkAt, struct?.lastError]);

  // Debug repro in a visible terminal (T-0337): fire-and-forget, so the
  // acknowledgement stays until the next headless run reports back.
  const handleRepro = useCallback(async () => {
    setError("");
    setNotice("");
    try {
      setNotice(await api.structRepro());
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const structLine = !active
    ? null
    : struct?.running
      ? t("voice.meeting.structuring")
      : struct?.lastError
        ? t("voice.meeting.structureFailed", { error: struct.lastError })
        : struct?.lastOkAt
          ? t("voice.meeting.structured", {
              when: new Date(struct.lastOkAt * 1000).toLocaleString(),
              seconds: struct.intervalSecs,
            })
          : struct && struct.intervalSecs === 0
            ? t("voice.meeting.autoStructureOff")
            : t("voice.meeting.autoStructureEvery", { seconds: struct?.intervalSecs ?? 120 });

  return (
    <div className="flex shrink-0 flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <FileText className="size-4 text-muted-foreground" />
        <h3 className="text-xs font-medium">{t("voice.meeting.title")}</h3>
        {active ? (
          capture?.recording ? (
            <span className="flex items-center gap-1.5 text-xs text-red-500">
              <span className="size-2 animate-pulse rounded-full bg-red-500" />
              {t("voice.meeting.recording", { count: active.entries })}
            </span>
          ) : capture?.transcribing ? (
            <span className="text-xs text-muted-foreground">
              {t("voice.meeting.transcribing")}
            </span>
          ) : (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              {t("voice.meeting.paused")}
            </span>
          )
        ) : (
          <span className="text-xs text-muted-foreground">{t("voice.meeting.idleHint")}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={t("voice.meeting.autoStructureSettingsAria")}
              >
                <Settings2 />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 space-y-3">
              <p className="flex items-center gap-2 text-sm font-medium">
                {t("voice.meeting.autoStructure")}
                <VaultScopedBadge />
              </p>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  {t("voice.meeting.agent")}
                </label>
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
                <label className="text-xs font-medium text-muted-foreground">
                  {t("voice.meeting.model")}
                </label>
                <ModelCombobox
                  assignee={structSettings?.meeting_struct_assignee ?? "claude-code"}
                  value={structSettings?.meeting_struct_model ?? ""}
                  onChange={(v) => void patchStructSettings({ meeting_struct_model: v })}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  {t("voice.meeting.intervalLabel")}
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
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  {t("voice.meeting.folderLabel")}
                </label>
                <Input
                  value={structSettings?.voice_meetings_dir ?? "voice/meetings"}
                  placeholder={t("voice.meeting.folderPlaceholder")}
                  onChange={(e) =>
                    void patchStructSettings({
                      voice_meetings_dir: e.target.value,
                    })
                  }
                  className="h-8 font-mono text-xs"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {t("voice.meeting.autoStructureHint")}
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
              {t("voice.meeting.minutesPrompt")}
            </Button>
          )}
          {active && (
            <Button size="xs" variant="outline" onClick={() => void handleStructNow()}>
              <Sparkles />
              {t("voice.meeting.structureNow")}
            </Button>
          )}
          {active && (
            <Button size="xs" variant="ghost" onClick={() => void handleRepro()}>
              {t("voice.meeting.terminal")}
            </Button>
          )}
          {shownId && (
            <Button
              size="xs"
              variant={showLog ? "outline" : "ghost"}
              onClick={() => setShowLog((v) => !v)}
            >
              {t("voice.meeting.runLog")}
            </Button>
          )}
          {active && capture && !capture.recording && !capture.transcribing && (
            <Button size="xs" variant="outline" onClick={() => void handleStart()}>
              <Play />
              {t("voice.meeting.resume")}
            </Button>
          )}
          {active ? (
            <Button size="xs" variant="outline" onClick={() => void handleStop()}>
              <Square />
              {t("voice.meeting.stopMeeting")}
            </Button>
          ) : (
            <Button size="xs" variant="outline" onClick={() => void handleStart()}>
              <Play />
              {t("voice.meeting.startMeeting")}
            </Button>
          )}
        </div>
      </div>

      {structLine && (
        <p className="text-[11px] text-muted-foreground">{structLine}</p>
      )}

      {notice && (
        <p className="text-[11px] text-muted-foreground">{notice}</p>
      )}

      {shownId && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1">
            <Button
              size="xs"
              variant={minutesView ? "ghost" : "outline"}
              onClick={() => setMinutesView(false)}
            >
              {t("voice.meeting.transcriptTab")}
            </Button>
            <Button
              size="xs"
              variant={minutesView ? "outline" : "ghost"}
              onClick={() => setMinutesView(true)}
            >
              {t("voice.meeting.minutesTab")}
            </Button>
            <div className="ml-auto flex items-center gap-1">
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => void handleCopyBody()}
                aria-label={
                  minutesView
                    ? t("voice.meeting.copyMinutesAria")
                    : t("voice.meeting.copyTranscriptAria")
                }
              >
                {copiedBody ? <Check className="text-emerald-500" /> : <Copy />}
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => setExpanded(true)}
                aria-label={
                  minutesView
                    ? t("voice.meeting.expandMinutesAria")
                    : t("voice.meeting.expandTranscriptAria")
                }
              >
                <Maximize2 />
              </Button>
            </div>
          </div>
          <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-2 text-xs select-text">
            {minutesView
              ? minutes || t("voice.meeting.notStructuredYet")
              : transcript || t("voice.meeting.waitingForFirstTranscript")}
          </pre>
          <Dialog open={expanded} onOpenChange={(o) => !o && setExpanded(false)}>
            <DialogContent className="sm:max-w-3xl" draggable>
              <DialogHeader>
                <DialogTitle>
                  {minutesView ? t("voice.meeting.minutesTab") : t("voice.meeting.transcriptTab")}
                </DialogTitle>
              </DialogHeader>
              <div className="flex justify-end">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => void handleCopyBody()}
                >
                  {copiedBody ? <Check className="text-emerald-500" /> : <Copy />}
                  {t("voice.meeting.copy")}
                </Button>
              </div>
              <pre className="max-h-[60dvh] overflow-y-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-3 text-xs select-text">
                {minutesView
                  ? minutes || t("voice.meeting.notStructuredYet")
                  : transcript || t("voice.meeting.waitingForFirstTranscript")}
              </pre>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {showLog && shownId && (
        <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-2 font-mono text-[11px] select-text">
          {structLog || t("voice.meeting.noRunsLogged")}
        </pre>
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
                {t("voice.meeting.listRow", { when: formatCreated(m.started), count: m.entries })}
                {m.id === active?.id && t("voice.meeting.listRowLive")}
              </button>
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => setDeleteTarget(m)}
                aria-label={t("voice.meeting.deleteAria")}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("voice.meeting.deleteTitle")}
        description={
          deleteTarget
            ? t("voice.meeting.deleteDescription", {
                when: formatCreated(deleteTarget.started),
                count: deleteTarget.entries,
              })
            : ""
        }
        confirmLabel={t("voice.meeting.deleteConfirm")}
        destructive
        onConfirm={() => void confirmDelete()}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export function VoiceView({ configVersion }: { configVersion: number }) {
  const t = useT();
  const [entries, setEntries] = useState<VoiceHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearOpen, setClearOpen] = useState(false);
  /** History entry waiting for delete confirmation (T-0336). */
  const [deleteTarget, setDeleteTarget] = useState<VoiceHistoryEntry | null>(null);
  const [tab, setTab] = useState("dictate");
  const [meetingLive, setMeetingLive] = useState(false);

  // Auto-select the Meeting tab on meeting start only (T-0334) — never yank
  // the user back once they have chosen elsewhere.
  const handleMeetingActiveChange = useCallback((isActive: boolean) => {
    setMeetingLive(isActive);
    if (isActive) setTab("meeting");
  }, []);

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

  const confirmDelete = useCallback(() => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleteTarget(null);
    setEntries((prev) => prev.filter((e) => e.id !== id));
    void api.voiceHistoryDelete(id);
  }, [deleteTarget]);

  const confirmClear = useCallback(() => {
    setClearOpen(false);
    setEntries([]);
    void api.voiceHistoryClear();
  }, []);

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden p-4">
      <div className="flex shrink-0 items-center gap-2">
        <Mic className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">{t("voice.header.title")}</h2>
        <span className="truncate text-xs text-muted-foreground">
          {t("voice.header.subtitle")}
        </span>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1">
        <TabsList className="shrink-0">
          <TabsTrigger value="dictate">{t("voice.tab.dictate")}</TabsTrigger>
          <TabsTrigger value="meeting">
            {t("voice.tab.meeting")}
            {meetingLive && <span className="size-1.5 rounded-full bg-red-500" />}
          </TabsTrigger>
          <TabsTrigger value="history">{t("voice.tab.history")}</TabsTrigger>
        </TabsList>

        <TabsContent value="dictate" className="min-h-0 flex-1 overflow-y-auto">
          <VoiceSettings configVersion={configVersion} />
        </TabsContent>

        <TabsContent value="meeting" className="min-h-0 flex-1 overflow-y-auto">
          <MeetingPanel onActiveChange={handleMeetingActiveChange} />
        </TabsContent>

        <TabsContent
          value="history"
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden"
        >
          <div className="flex shrink-0 items-center gap-2">
            <h3 className="text-xs font-medium">{t("voice.history.title")}</h3>
            <span className="text-xs text-muted-foreground">
              {t("voice.history.count", { count: entries.length, max: MAX_ENTRIES })}
            </span>
            <Button
              size="xs"
              variant="outline"
              className="ml-auto"
              disabled={entries.length === 0}
              onClick={() => setClearOpen(true)}
            >
              {t("voice.history.clearAll")}
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <p className="text-sm text-muted-foreground">{t("voice.history.loading")}</p>
            ) : entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("voice.history.empty")}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {entries.map((entry) => (
                  <HistoryRow
                    key={entry.id}
                    entry={entry}
                    onDelete={(id) =>
                      setDeleteTarget(entries.find((e) => e.id === id) ?? null)
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={clearOpen}
        title={t("voice.history.clearTitle")}
        description={t("voice.history.clearDescription", { count: entries.length })}
        confirmLabel={t("voice.history.clearConfirm")}
        destructive
        onConfirm={confirmClear}
        onClose={() => setClearOpen(false)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("voice.history.deleteTranscriptTitle")}
        description={
          deleteTarget
            ? t("voice.history.deleteTranscriptDescription", {
                when: formatCreated(deleteTarget.created),
              })
            : ""
        }
        confirmLabel={t("voice.history.deleteConfirm")}
        destructive
        onConfirm={confirmDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
