import { useEffect, useState } from "react";
import { open as pickFolders } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  FolderOpen,
  Loader2,
  Play,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { api, timeAgo } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { ModelCombobox } from "@/components/model-combobox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Settings, SttModelStatus, TidyRun, UpdateInfo } from "@/types";

const TIDY_DEFAULTS: Settings["tidy"] = {
  enabled: false,
  assignee: "claude-code",
  model: "",
  anchor: null,
  interval_hours: 24,
  stale_days: 7,
  exclude_dirs: ["_wip"],
  last_run: null,
  last_session_id: null,
};

/** Timestamps in this dialog are formatted in English rather than via
 * `toLocaleString()`, so the app reads the same on a Japanese Windows as it
 * does on an English one. */
const TIMESTAMP = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Next scheduled check time from anchor + interval (unix seconds). */
function nextCheck(tidy: Settings["tidy"]): number | null {
  if (!tidy.anchor) return null;
  const interval = Math.max(1, tidy.interval_hours) * 3600;
  const now = Math.floor(Date.now() / 1000);
  const elapsed = Math.max(0, now - tidy.anchor);
  return tidy.anchor + (Math.floor(elapsed / interval) + 1) * interval;
}

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

const TASK_LANGUAGES: { id: string; label: string }[] = [
  { id: "en", label: "English" },
  { id: "ja", label: "日本語" },
];

const DEFAULTS: Settings = {
  vscode_cmd: "code",
  terminal_cmd: "wt -d {path}",
  agent_cmd: "wt -d {path} pwsh -NoExit -Command claude",
  opencode_cmd: "wt -d {path} pwsh -NoExit -Command opencode",
  use_herdr: true,
  herdr_cmd: "herdr",
  check_updates: true,
  check_template_updates: true,
  check_memory_setup: true,
  memory_claude_code: true,
  memory_opencode: true,
  ink_enabled: true,
  vault_path: null,
  worktree_root: "C:/repos/.worktrees",
  terminal_embed: false,
  quick_capture_enabled: true,
  quick_capture_shortcut: "Ctrl+Alt+N",
  quick_capture_rect: null,
  voice_enabled: true,
  voice_hotkey: "Ctrl+Shift+Space",
  voice_model: "small",
  voice_language: "auto",
  voice_indicator_position: null,
  task_language: "en",
  custom_prompt: "",
  tidy: TIDY_DEFAULTS,
  schedule_assignee: "claude-code",
  schedule_model: "",
  schedule_confirm: false,
  schedule_export_dir: "",
};

interface Props {
  open: boolean;
  settings: Settings;
  onClose: () => void;
  /** Persists the settings; rejects (with a message) on failure so the
   * dialog can report it and stay open instead of closing on a save that
   * silently didn't happen (T-0064). */
  onSave: (settings: Settings) => Promise<void>;
}

export function SettingsDialog({ open, settings, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [version, setVersion] = useState("");
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [phase, setPhase] = useState<
    "idle" | "checking" | "uptodate" | "available" | "downloading" | "ready" | "failed"
  >("idle");
  const [error, setError] = useState("");
  const [modelStatus, setModelStatus] = useState<SttModelStatus[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadError, setDownloadError] = useState("");
  const [tidyRun, setTidyRun] = useState<TidyRun | null>(null);
  const [tidyMsg, setTidyMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // A tidy config helper so the many nested fields stay readable.
  const setTidy = (patch: Partial<Settings["tidy"]>) =>
    setDraft((d) => ({ ...d, tidy: { ...d.tidy, ...patch } }));

  const refreshModelStatus = () => void api.sttModelStatus().then(setModelStatus);

  useEffect(() => {
    if (open) {
      setDraft(settings);
      setUpdate(null);
      setPhase("idle");
      setError("");
      setDownloadError("");
      setSaveError("");
      void api.appVersion().then(setVersion);
      void api.tidyStatus().then(setTidyRun);
      setTidyMsg("");
      refreshModelStatus();
    }
    // refreshModelStatus is stable enough for this effect's purpose (only
    // depends on api, which never changes); omitting it avoids a re-run loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, settings]);

  useEffect(() => {
    if (!open) return;
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
      refreshModelStatus();
    });
    const unlistenError = listen<{ model: string; message: string }>("stt:download-error", (event) => {
      setDownloading(null);
      setDownloadError(event.payload.message);
    });
    const unlistenTidy = listen<TidyRun>("tidy:status", (event) => {
      setTidyRun(event.payload);
    });
    return () => {
      void unlistenProgress.then((fn) => fn());
      void unlistenDone.then((fn) => fn());
      void unlistenError.then((fn) => fn());
      void unlistenTidy.then((fn) => fn());
    };
  }, [open]);

  const downloadModel = async (model: string) => {
    setDownloading(model);
    setDownloadProgress(0);
    setDownloadError("");
    try {
      await api.sttDownloadModel(model);
    } catch (e) {
      setDownloading(null);
      setDownloadError(String(e));
    }
  };

  const deleteModel = async (model: string) => {
    await api.sttDeleteModel(model);
    refreshModelStatus();
  };

  const runTidy = async (force: boolean) => {
    setTidyMsg("");
    try {
      setTidyMsg(await api.runVaultTidyNow(force));
      setTidyRun(await api.tidyStatus());
    } catch (e) {
      setTidyMsg(String(e));
    }
  };

  const resumeTidy = async () => {
    setTidyMsg("");
    try {
      setTidyMsg(await api.resumeTidySession());
    } catch (e) {
      setTidyMsg(String(e));
    }
  };

  /** Live run first, then the id persisted in settings — the latter is all
   * that survives an app restart. */
  const tidySessionId = tidyRun?.session_id || draft.tidy.last_session_id || "";

  const copySessionId = async () => {
    if (!tidySessionId) return;
    try {
      await writeText(tidySessionId);
      setTidyMsg("Session id copied.");
    } catch (e) {
      setTidyMsg(String(e));
    }
  };

  const check = async () => {
    setPhase("checking");
    setError("");
    const info = await api.checkUpdate();
    if (info) {
      setUpdate(info);
      setPhase("available");
    } else {
      setUpdate(null);
      setPhase("uptodate");
    }
  };

  const save = async () => {
    setSaveError("");
    setSaving(true);
    try {
      await onSave(draft);
      onClose();
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const install = async () => {
    if (!update) return;
    setPhase("downloading");
    try {
      await api.applyUpdate(update.url);
      setPhase("ready");
    } catch (e) {
      setError(String(e));
      setPhase("failed");
    }
  };

  const field = (
    label: string,
    key: "vscode_cmd" | "terminal_cmd" | "agent_cmd" | "opencode_cmd" | "herdr_cmd" | "worktree_root",
  ) => (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Input
        value={draft[key]}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        className="h-8 font-mono text-xs"
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Configure workhub commands, vault, and behavior.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="general" className="flex flex-col gap-3">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="commands">Commands</TabsTrigger>
            <TabsTrigger value="voice">Voice</TabsTrigger>
            <TabsTrigger value="vault">Vault</TabsTrigger>
          </TabsList>
          {/* Fixed-height scroll area so the tab bar stays put when switching
              tabs, regardless of how much content each tab holds. The bottom
              padding is part of the scrollable content, so the last section
              does not sit flush against the edge at the end of the scroll. */}
          <div className="-mx-6 h-[min(65vh,520px)] overflow-y-auto px-6 pb-4">
            <TabsContent value="general" className="mt-0 space-y-3">
              {/* Every group on this tab is a titled bordered section, so no
                  checkbox sits loose next to a framed one. */}
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">Startup checks</p>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={draft.check_updates}
                    onCheckedChange={(v) => setDraft({ ...draft, check_updates: v === true })}
                  />
                  Check for app updates
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={draft.check_template_updates}
                    onCheckedChange={(v) =>
                      setDraft({ ...draft, check_template_updates: v === true })
                    }
                  />
                  Check for vault template updates
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={draft.check_memory_setup}
                    onCheckedChange={(v) => setDraft({ ...draft, check_memory_setup: v === true })}
                  />
                  Notify when long-term memory is not set up on this machine
                </label>
              </div>
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">Long-term memory</p>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={draft.memory_claude_code}
                    onCheckedChange={(v) =>
                      setDraft({ ...draft, memory_claude_code: v === true })
                    }
                  />
                  Enabled in Claude Code sessions
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={draft.memory_opencode}
                    onCheckedChange={(v) => setDraft({ ...draft, memory_opencode: v === true })}
                  />
                  Enabled in OpenCode sessions
                </label>
              </div>
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">Features</p>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={draft.ink_enabled}
                    onCheckedChange={(v) => setDraft({ ...draft, ink_enabled: v === true })}
                  />
                  Screen annotation (double-press and hold Alt to draw)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={draft.quick_capture_enabled}
                    onCheckedChange={(v) =>
                      setDraft({ ...draft, quick_capture_enabled: v === true })
                    }
                  />
                  Quick capture (hotkey turns the clipboard into an inbox task)
                </label>
                {draft.quick_capture_enabled && (
                  <div className="space-y-1.5 pt-1">
                    <label className="text-xs font-medium text-muted-foreground">
                      Quick capture hotkey
                    </label>
                    <Input
                      value={draft.quick_capture_shortcut}
                      onChange={(e) =>
                        setDraft({ ...draft, quick_capture_shortcut: e.target.value })
                      }
                      placeholder="Ctrl+Alt+N"
                      className="h-8 font-mono text-xs"
                    />
                  </div>
                )}
              </div>
              <div className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">App update</p>
                    <p className="text-xs text-muted-foreground">Current version: v{version}</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={check}
                    disabled={phase === "checking" || phase === "downloading"}
                  >
                    {phase === "checking" && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
                    {phase === "checking" ? "Checking…" : "Check for updates"}
                  </Button>
                </div>
                {phase === "ready" && (
                  <div className="flex items-center justify-between gap-3 rounded-md bg-muted p-2">
                    <span className="flex items-center gap-1.5 text-xs">
                      <Check className="size-3.5 text-green-500" />
                      Update installed
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => api.restartApp()}
                    >
                      Restart now
                    </Button>
                  </div>
                )}
                {update && phase !== "ready" && (
                  <div className="flex items-center justify-between gap-3 rounded-md bg-muted p-2">
                    <span className="text-xs">
                      New version <span className="font-medium">{update.tag}</span> is available
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      onClick={install}
                      disabled={phase === "downloading"}
                    >
                      {phase === "downloading" && (
                        <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                      )}
                      {phase === "downloading" ? "Downloading…" : "Download & install"}
                    </Button>
                  </div>
                )}
                {phase === "uptodate" && (
                  <p className="text-xs text-muted-foreground">You are up to date.</p>
                )}
                {phase === "failed" && (
                  <p className="text-xs text-destructive">Update failed: {error}</p>
                )}
              </div>
            </TabsContent>
            <TabsContent value="commands" className="mt-0 space-y-3">
              <p className="text-xs text-muted-foreground">
                Command templates — <code className="text-xs">{"{path}"}</code> is replaced with the
                project path.
              </p>
              {field("VS Code command", "vscode_cmd")}
              {field("Terminal command", "terminal_cmd")}
              {field("Claude Code command", "agent_cmd")}
              {field("OpenCode command", "opencode_cmd")}
              <label className="flex items-center gap-2 pt-1 text-sm">
                <Checkbox
                  checked={draft.use_herdr}
                  onCheckedChange={(v) => setDraft({ ...draft, use_herdr: v === true })}
                />
                Open AI tasks in a fresh herdr workspace
              </label>
              {draft.use_herdr && field("herdr command", "herdr_cmd")}
              {draft.use_herdr && (
                <label className="flex items-center gap-2 pt-1 text-sm">
                  <Checkbox
                    checked={draft.terminal_embed}
                    onCheckedChange={(v) => setDraft({ ...draft, terminal_embed: v === true })}
                  />
                  Embed terminal (show herdr inside the app)
                </label>
              )}
              <div className="space-y-1.5 pt-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Task file language
                </label>
                <p className="text-[10px] leading-tight text-muted-foreground/70">
                  Language an AI agent writes a task's Plan and Results sections in, plus the
                  title and Description of tasks an automatic vault tidy creates. Never affects
                  code, comments, or commit messages.
                </p>
                <Select
                  value={draft.task_language}
                  onValueChange={(v) => setDraft({ ...draft, task_language: v })}
                >
                  <SelectTrigger size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_LANGUAGES.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 pt-1">
                <label className="text-xs font-medium text-muted-foreground">Custom prompt</label>
                <p className="text-[10px] leading-tight text-muted-foreground/70">
                  Appended to the end of every task prompt, both when launching an agent and when
                  copying the prompt. Line breaks are collapsed into spaces.
                </p>
                <Textarea
                  value={draft.custom_prompt}
                  onChange={(e) => setDraft({ ...draft, custom_prompt: e.target.value })}
                  placeholder="e.g. Respond to me in Japanese."
                  className="min-h-20 text-xs"
                />
              </div>
            </TabsContent>
            <TabsContent value="voice" className="mt-0 space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={draft.voice_enabled}
                  onCheckedChange={(v) => setDraft({ ...draft, voice_enabled: v === true })}
                />
                Voice input (hotkey dictates into the focused app)
              </label>
              {draft.voice_enabled && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Voice input hotkey
                    </label>
                    <Input
                      value={draft.voice_hotkey}
                      onChange={(e) => setDraft({ ...draft, voice_hotkey: e.target.value })}
                      placeholder="Ctrl+Shift+Space"
                      className="h-8 font-mono text-xs"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="min-w-0 space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Model</label>
                      <Select
                        value={draft.voice_model}
                        onValueChange={(v) => setDraft({ ...draft, voice_model: v })}
                      >
                        <SelectTrigger size="sm" className="w-full">
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
                    <div className="min-w-0 space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Language</label>
                      <Select
                        value={draft.voice_language}
                        onValueChange={(v) => setDraft({ ...draft, voice_language: v })}
                      >
                        <SelectTrigger size="sm" className="w-full">
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
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Local models</p>
                    {VOICE_MODELS.map((m) => {
                      const status = modelStatus.find((s) => s.model === m.id);
                      const isDownloading = downloading === m.id;
                      return (
                        <div key={m.id} className="space-y-1 rounded-md border p-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-1.5 text-xs">
                              {m.label} <span className="text-muted-foreground">({m.size})</span>
                              {status?.active && (
                                <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">
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
                    {downloadError && <p className="text-xs text-destructive">{downloadError}</p>}
                  </div>
                </>
              )}
            </TabsContent>
            <TabsContent value="vault" className="mt-0 space-y-3">
              {field("Worktree root", "worktree_root")}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Tasks vault path</label>
                <div className="flex gap-1.5">
                  <Input
                    value={draft.vault_path ?? ""}
                    onChange={(e) => setDraft({ ...draft, vault_path: e.target.value || null })}
                    placeholder="C:/obsidian/workhub-vault"
                    className="h-8 font-mono text-xs"
                  />
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    onClick={async () => {
                      const picked = await pickFolders({ directory: true, title: "Choose vault folder" });
                      if (typeof picked === "string") {
                        setDraft({ ...draft, vault_path: picked.replaceAll("\\", "/") });
                      }
                    }}
                  >
                    <FolderOpen className="size-3.5" />
                  </Button>
                </div>
              </div>

              {/* Schedule AI edits (T-0091) */}
              <div className="space-y-3 rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">Schedule</p>
                  <p className="text-xs text-muted-foreground">
                    Agent used when you edit a schedule with a natural-language instruction.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Agent</label>
                    <Select
                      value={draft.schedule_assignee}
                      // Clear the model when the agent changes: model ids are
                      // per-CLI, so a claude id left behind on an opencode run
                      // would be passed straight through to `--model` and fail.
                      onValueChange={(v) =>
                        setDraft({ ...draft, schedule_assignee: v, schedule_model: "" })
                      }
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
                      assignee={draft.schedule_assignee}
                      value={draft.schedule_model}
                      onChange={(model) => setDraft({ ...draft, schedule_model: model })}
                      active={open}
                      // Lives inside a modal Radix Dialog — see the prop's doc
                      // comment.
                      modal
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    Show the diff and wait for approval instead of applying immediately.
                  </p>
                  <Switch
                    checked={draft.schedule_confirm}
                    onCheckedChange={(v) => setDraft({ ...draft, schedule_confirm: v })}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    HTML export folder
                  </label>
                  <Input
                    value={draft.schedule_export_dir}
                    onChange={(e) => setDraft({ ...draft, schedule_export_dir: e.target.value })}
                    placeholder="blank = the project's attachments/"
                    className="h-8 font-mono text-xs"
                  />
                </div>
              </div>

              {/* Vault tidy (T-0050) */}
              <div className="space-y-3 rounded-md border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Vault tidy</p>
                    <p className="text-xs text-muted-foreground">
                      File stale inbox notes and refresh the archive index with a headless agent.
                    </p>
                  </div>
                  <Switch
                    checked={draft.tidy.enabled}
                    onCheckedChange={(v) => setTidy({ enabled: v })}
                  />
                </div>

                {tidyRun && (
                  <div className="rounded-md bg-muted p-2 text-xs">
                    {tidyRun.state === "running" ? (
                      <span className="flex items-center gap-1.5">
                        <Loader2 className="size-3.5 animate-spin" />
                        {tidyRun.stalled ? "Running — may be stuck" : "Running…"}
                      </span>
                    ) : tidyRun.state === "failed" ? (
                      <span className="flex items-start gap-1.5 text-destructive">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                        <span>Failed{tidyRun.error ? `: ${tidyRun.error}` : ""}</span>
                      </span>
                    ) : tidyRun.state === "completed" ? (
                      <span className="flex items-start gap-1.5">
                        <Check className="mt-0.5 size-3.5 shrink-0 text-green-500" />
                        <span>{tidyRun.summary ?? "Completed"}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Idle</span>
                    )}
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {tidyRun.at
                        ? `Last run ${timeAgo(tidyRun.at)}. `
                        : draft.tidy.last_run
                          ? `Last run ${timeAgo(draft.tidy.last_run)}. `
                          : "Not run yet. "}
                      {draft.tidy.enabled && nextCheck(draft.tidy)
                        ? `Next check ${TIMESTAMP.format(new Date((nextCheck(draft.tidy) as number) * 1000))}.`
                        : ""}
                    </div>
                    {tidySessionId && (
                      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className="shrink-0">Session</span>
                        <code className="truncate font-mono">{tidySessionId}</code>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-5 shrink-0"
                          title="Copy session id"
                          onClick={() => void copySessionId()}
                        >
                          <Copy className="size-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Agent</label>
                    <Select
                      value={draft.tidy.assignee}
                      onValueChange={(v) => setTidy({ assignee: v })}
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
                      assignee={draft.tidy.assignee}
                      value={draft.tidy.model}
                      onChange={(model) => setTidy({ model })}
                      active={open}
                      // Lives inside a modal Radix Dialog — see the prop's doc
                      // comment.
                      modal
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">First run at</label>
                    <DateTimePicker
                      value={draft.tidy.anchor}
                      onChange={(anchor) => setTidy({ anchor })}
                      placeholder="not scheduled"
                      modal
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Run every (hours)
                    </label>
                    <Input
                      type="number"
                      min={1}
                      value={draft.tidy.interval_hours}
                      onChange={(e) =>
                        setTidy({ interval_hours: Math.max(1, Number(e.target.value) || 1) })
                      }
                      className="h-8 text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Inbox age (days)
                    </label>
                    <Input
                      type="number"
                      min={0}
                      value={draft.tidy.stale_days}
                      onChange={(e) =>
                        setTidy({ stale_days: Math.max(0, Number(e.target.value) || 0) })
                      }
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Exclude folders
                    </label>
                    <Input
                      value={draft.tidy.exclude_dirs.join(", ")}
                      onChange={(e) =>
                        setTidy({
                          exclude_dirs: e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="_wip"
                      className="h-8 font-mono text-xs"
                    />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  24 = daily, 168 = weekly. Save to apply schedule changes.
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void runTidy(false)}
                    disabled={tidyRun?.state === "running"}
                  >
                    <Play className="mr-1.5 size-3.5" />
                    Run now
                  </Button>
                  {/* Any known session id is resumable — a run that was killed
                      mid-way never reports a failure, but is exactly the one
                      worth picking up by hand. */}
                  {(tidySessionId || tidyRun?.state === "failed" || tidyRun?.stalled) && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => void resumeTidy()}
                    >
                      <RotateCcw className="mr-1.5 size-3.5" />
                      Resume session
                    </Button>
                  )}
                </div>
                {tidyMsg && <p className="text-xs text-muted-foreground">{tidyMsg}</p>}
              </div>
            </TabsContent>
          </div>
        </Tabs>
        {saveError && (
          <p className="text-xs text-destructive">Save failed: {saveError}</p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setDraft(DEFAULTS)}>
            Reset to defaults
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
