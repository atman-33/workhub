import { useEffect, useState } from "react";
import { open as pickFolders } from "@tauri-apps/plugin-dialog";
import { Check, FolderOpen, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
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
import { DiagnosticLogPanel } from "@/components/diagnostic-log-panel";
import { InputListenerPanel } from "@/components/input-listener-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { VaultScopedBadge } from "@/components/vault-scoped-badge";
import type { Settings, UpdateInfo } from "@/types";

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

const TASK_LANGUAGES: { id: string; label: string }[] = [
  { id: "en", label: "English" },
  { id: "ja", label: "日本語" },
];

/** What "send to Claude Desktop" opens for a task. */
const CLAUDE_DESKTOP_MODES: { id: string; label: string }[] = [
  { id: "code", label: "Code session (vault as folder)" },
  { id: "chat", label: "Chat (consultation only)" },
];

const DEFAULTS: Settings = {
  vscode_cmd: "code",
  terminal_cmd: "wt -d {path}",
  agent_cmd: "wt -d {path} pwsh -NoExit -Command claude",
  opencode_cmd: "wt -d {path} pwsh -NoExit -Command opencode",
  use_herdr: true,
  herdr_cmd: "herdr",
  autostart: false,
  check_updates: true,
  check_template_updates: true,
  auto_apply_template_updates: true,
  check_memory_setup: true,
  memory_claude_code: true,
  memory_opencode: true,
  secretary_enabled: false,
  ink_enabled: true,
  ink_dir: "",
  vault_path: null,
  worktree_root: "C:/repos/.worktrees",
  // Managed from the Tasks tab itself, not from this dialog (T-0300).
  terminal_embed: false,
  quick_capture_enabled: true,
  quick_capture_shortcut: "Ctrl+Alt+N",
  quick_capture_rect: null,
  ink_preview_rect: null,
  task_editor_rect: null,
  task_editor_maximized: false,
  // Managed from the Voice tab itself, not from this dialog (T-0277).
  voice_enabled: true,
  voice_hotkey: "Ctrl+Shift+Space",
  voice_model: "small",
  voice_language: "auto",
  voice_indicator_placement: "caret",
  voice_indicator_position: null,
  clips_enabled: true,
  clips_gesture: "ctrl-double",
  clips_rect: null,
  task_language: "en",
  custom_prompt: "",
  prompt_copy_multiline: true,
  claude_desktop_mode: "code",
  // Managed from the Inbox tab itself, not from this dialog (T-0300).
  tidy: TIDY_DEFAULTS,
  // Managed from the Schedule tab itself, not from this dialog (T-0289).
  schedule_assignee: "claude-code",
  schedule_model: "",
  schedule_confirm: false,
  schedule_export_dir: "",
  schedule_locale: "en",
  // Managed from the Mindmap tab itself, not from this dialog (T-0289).
  mindmap_assignee: "claude-code",
  mindmap_model: "",
  mindmap_confirm: false,
  recurring: [],
  // Managed from the Docs tab itself, not from this dialog (T-0259).
  docs_roots: [],
  docs_plantuml_server: "",
  docs_shortcuts: [],
  docs_list_pane: false,
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
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (open) {
      setDraft(settings);
      setUpdate(null);
      setPhase("idle");
      setError("");
      setSaveError("");
      void api.appVersion().then(setVersion);
    }
  }, [open, settings]);

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
      <DialogContent draggable className="flex max-h-[90vh] flex-col gap-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            The vault this app works in, how the app behaves, and how it launches AI agents.
            Settings a single tab owns live in that tab.
          </DialogDescription>
        </DialogHeader>
        {/* Above the tabs, not inside one: every feature in the app reads this
            one path, and a setting that important should not need a tab to be
            found (T-0300). */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Vault folder</label>
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
        <Tabs defaultValue="general" className="flex flex-col gap-3">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="agents">Agents</TabsTrigger>
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
                <p className="text-sm font-medium">Startup</p>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={draft.autostart}
                    onCheckedChange={(v) => setDraft({ ...draft, autostart: v === true })}
                  />
                  Start workhub when I sign in to Windows
                </label>
                <p className="pl-6 text-xs text-muted-foreground">
                  Starts minimized, so global hotkeys, the vault watcher and the tidy
                  routine are running without a window in your way. Open it from the
                  taskbar when you need it.
                </p>
              </div>
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
                    checked={draft.auto_apply_template_updates}
                    disabled={!draft.check_template_updates}
                    onCheckedChange={(v) =>
                      setDraft({ ...draft, auto_apply_template_updates: v === true })
                    }
                  />
                  Apply safe template updates without asking
                </label>
                <p className="pl-6 text-xs text-muted-foreground">
                  New files and files you have not edited are updated silently. Files you
                  edited yourself still ask before anything is changed.
                </p>
              </div>
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">Features</p>
                <p className="text-xs text-muted-foreground">
                  Screen annotation (double-press and hold Alt to draw) is configured in the
                  <span className="font-medium"> Ink</span> tab, next to the captures it saves.
                </p>
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
              <InputListenerPanel />
              <DiagnosticLogPanel />
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
            <TabsContent value="agents" className="mt-0 space-y-3">
              <p className="text-xs text-muted-foreground">
                How workhub launches an agent for a task, and what it hands one. Command
                templates take <code className="text-xs">{"{path}"}</code> in place of the
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
              {field("Worktree root", "worktree_root")}
              <div className="space-y-1.5 pt-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Send to Claude Desktop
                </label>
                <p className="text-[10px] leading-tight text-muted-foreground/70">
                  What the Claude Desktop button on a task opens. A code session runs in the
                  vault and carries the same prompt a terminal launch does, so skills like
                  task-start and task-report work. A chat has no skills or vault access and
                  receives the task's Description instead — for consulting, not for working the
                  task. Claude Desktop asks you to confirm the folder the first time.
                </p>
                <Select
                  value={draft.claude_desktop_mode}
                  onValueChange={(v) => setDraft({ ...draft, claude_desktop_mode: v })}
                >
                  <SelectTrigger size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CLAUDE_DESKTOP_MODES.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 pt-1">
                <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  Task file language
                  <VaultScopedBadge />
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
                <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  Custom prompt
                  <VaultScopedBadge />
                </label>
                <p className="text-[10px] leading-tight text-muted-foreground/70">
                  Appended to the end of every task prompt, both when launching an agent and when
                  copying the prompt. Line breaks are collapsed into spaces unless the copy below
                  keeps them.
                </p>
                <Textarea
                  value={draft.custom_prompt}
                  onChange={(e) => setDraft({ ...draft, custom_prompt: e.target.value })}
                  placeholder="e.g. Respond to me in Japanese."
                  className="min-h-20 text-xs"
                />
              </div>
              <div className="space-y-1.5 pt-1">
                <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  Line breaks in copied prompt
                  <VaultScopedBadge />
                </label>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[10px] leading-tight text-muted-foreground/70">
                    Copy prompt puts each instruction on its own line. Off copies it as one line.
                    Launching an agent always uses one line — a command line cannot carry a break.
                  </p>
                  <Switch
                    checked={draft.prompt_copy_multiline}
                    onCheckedChange={(v) => setDraft({ ...draft, prompt_copy_multiline: v })}
                  />
                </div>
              </div>
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">Long-term memory</p>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={draft.memory_claude_code}
                    onCheckedChange={(v) => setDraft({ ...draft, memory_claude_code: v === true })}
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
                {/* Grouped with the two switches above rather than with the
                    other startup checks: it is about long-term memory, and a
                    reader looking for it looks here. */}
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={draft.check_memory_setup}
                    onCheckedChange={(v) => setDraft({ ...draft, check_memory_setup: v === true })}
                  />
                  Notify at startup when it is not set up on this machine
                </label>
              </div>
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">Secretary agent</p>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={draft.secretary_enabled}
                    onCheckedChange={(v) => setDraft({ ...draft, secretary_enabled: v === true })}
                  />
                  Consult the secretary before asking me
                </label>
                <p className="text-xs text-muted-foreground">
                  Agents check your decision policy (
                  <code>profile/decision-policy.md</code>) through a secretary subagent
                  and file what it cannot decide into <code>_ai/comms/</code> instead of
                  interrupting you. Consulting costs tokens, so this is off by default; turn it on
                  to enable it in both Claude Code and OpenCode sessions. With it off, agents
                  still read the policy and still bring you a recommended answer — they just
                  ask you directly.
                </p>
              </div>
            </TabsContent>
          </div>
        </Tabs>
        {saveError && (
          <p className="text-xs text-destructive">Save failed: {saveError}</p>
        )}
        <DialogFooter>
          {/* Recurring rules are content the user authored (edited from the
              Tasks tab, not here), not a knob with a sensible default — a reset
              of the command templates must not delete them. */}
          <Button variant="ghost" onClick={() => setDraft({ ...DEFAULTS, recurring: draft.recurring })}>
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
