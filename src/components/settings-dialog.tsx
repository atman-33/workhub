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
import { LOCALES, useT, type MessageKey } from "@/lib/i18n";
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

const LANGUAGES: { id: string; label: string }[] = [
  { id: "en", label: "English" },
  { id: "ja", label: "日本語" },
];

/** What "send to Claude Desktop" opens for a task. */
const CLAUDE_DESKTOP_MODES: { id: string; labelKey: MessageKey }[] = [
  { id: "code", labelKey: "settings.agents.claudeDesktop.modeCode" },
  { id: "chat", labelKey: "settings.agents.claudeDesktop.modeChat" },
];

const DEFAULTS: Settings = {
  // Managed from the Repos tab itself, not from this dialog (T-0304).
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
  voice_system_audio: false,
  clips_enabled: true,
  clips_gesture: "ctrl-double",
  clips_rect: null,
  language: "en",
  ui_locale: "en",
  response_language_inject: true,
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
  // Managed from the Mindmap tab itself, not from this dialog (T-0289).
  mindmap_assignee: "claude-code",
  mindmap_model: "",
  mindmap_confirm: false,
  // Managed from the Voice tab's meeting panel, not from this dialog (T-0318).
  meeting_struct_interval_secs: 120,
  meeting_struct_assignee: "claude-code",
  meeting_struct_model: "",
  // Managed from the Voice tab's meeting panel, not from this dialog (T-0338).
  voice_meetings_dir: "voice/meetings",
  recurring: [],
  // Managed from the Docs tab itself, not from this dialog (T-0259).
  docs_roots: [],
  notices_read: [],
  docs_plantuml_server: "",
  docs_shortcuts: [],
  docs_list_pane: false,
  docs_allow_remote_images: false,
  docs_show_hidden: false,
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
  const t = useT();
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
    key: "agent_cmd" | "opencode_cmd" | "herdr_cmd" | "worktree_root",
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
          <DialogTitle>{t("settings.title")}</DialogTitle>
          <DialogDescription>{t("settings.description")}</DialogDescription>
        </DialogHeader>
        {/* Above the tabs, not inside one: every feature in the app reads this
            one path, and a setting that important should not need a tab to be
            found (T-0300). */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            {t("settings.vaultFolder.label")}
          </label>
          <div className="flex gap-1.5">
            <Input
              value={draft.vault_path ?? ""}
              onChange={(e) => setDraft({ ...draft, vault_path: e.target.value || null })}
              placeholder={t("settings.vaultFolder.placeholder")}
              className="h-8 font-mono text-xs"
            />
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              onClick={async () => {
                const picked = await pickFolders({
                  directory: true,
                  title: t("settings.vaultFolder.chooseDialogTitle"),
                });
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
            <TabsTrigger value="general">{t("settings.tab.general")}</TabsTrigger>
            <TabsTrigger value="agents">{t("settings.tab.agents")}</TabsTrigger>
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
                <p className="flex items-center gap-2 text-sm font-medium">
                  {t("settings.general.language.title")}
                  <VaultScopedBadge />
                </p>
                <Select
                  value={draft.ui_locale}
                  onValueChange={(v) => setDraft({ ...draft, ui_locale: v })}
                >
                  <SelectTrigger size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LOCALES.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t("settings.general.language.description")}
                </p>
              </div>
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">{t("settings.general.startup.title")}</p>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={draft.autostart}
                    onCheckedChange={(v) => setDraft({ ...draft, autostart: v === true })}
                  />
                  {t("settings.general.startup.autostart")}
                </label>
                <p className="pl-6 text-xs text-muted-foreground">
                  {t("settings.general.startup.autostartDescription")}
                </p>
              </div>
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">{t("settings.general.startupChecks.title")}</p>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={draft.check_updates}
                    onCheckedChange={(v) => setDraft({ ...draft, check_updates: v === true })}
                  />
                  {t("settings.general.startupChecks.checkUpdates")}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={draft.check_template_updates}
                    onCheckedChange={(v) =>
                      setDraft({ ...draft, check_template_updates: v === true })
                    }
                  />
                  {t("settings.general.startupChecks.checkTemplate")}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={draft.auto_apply_template_updates}
                    disabled={!draft.check_template_updates}
                    onCheckedChange={(v) =>
                      setDraft({ ...draft, auto_apply_template_updates: v === true })
                    }
                  />
                  {t("settings.general.startupChecks.autoApply")}
                </label>
                <p className="pl-6 text-xs text-muted-foreground">
                  {t("settings.general.startupChecks.autoApplyDescription")}
                </p>
              </div>
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">{t("settings.general.features.title")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("settings.general.features.inkNotePrefix")}
                  <span className="font-medium"> {t("nav.ink")} </span>
                  {t("settings.general.features.inkNoteSuffix")}
                </p>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={draft.quick_capture_enabled}
                    onCheckedChange={(v) =>
                      setDraft({ ...draft, quick_capture_enabled: v === true })
                    }
                  />
                  {t("settings.general.features.quickCapture")}
                </label>
                {draft.quick_capture_enabled && (
                  <div className="space-y-1.5 pt-1">
                    <label className="text-xs font-medium text-muted-foreground">
                      {t("settings.general.features.quickCaptureHotkeyLabel")}
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
                    <p className="text-sm font-medium">{t("settings.general.appUpdate.title")}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("settings.general.appUpdate.currentVersion", { version })}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={check}
                    disabled={phase === "checking" || phase === "downloading"}
                  >
                    {phase === "checking" && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
                    {phase === "checking"
                      ? t("settings.general.appUpdate.checking")
                      : t("settings.general.appUpdate.check")}
                  </Button>
                </div>
                {phase === "ready" && (
                  <div className="flex items-center justify-between gap-3 rounded-md bg-muted p-2">
                    <span className="flex items-center gap-1.5 text-xs">
                      <Check className="size-3.5 text-green-500" />
                      {t("settings.general.appUpdate.installed")}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => api.restartApp()}
                    >
                      {t("banner.update.restartNow")}
                    </Button>
                  </div>
                )}
                {update && phase !== "ready" && (
                  <div className="flex items-center justify-between gap-3 rounded-md bg-muted p-2">
                    <span className="text-xs">
                      {t("settings.general.appUpdate.newVersion", { tag: update.tag })}
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
                      {phase === "downloading"
                        ? t("settings.general.appUpdate.downloading")
                        : t("settings.general.appUpdate.downloadInstall")}
                    </Button>
                  </div>
                )}
                {phase === "uptodate" && (
                  <p className="text-xs text-muted-foreground">
                    {t("settings.general.appUpdate.upToDate")}
                  </p>
                )}
                {phase === "failed" && (
                  <p className="text-xs text-destructive">
                    {t("settings.general.appUpdate.failed", { error })}
                  </p>
                )}
              </div>
            </TabsContent>
            <TabsContent value="agents" className="mt-0 space-y-3">
              <p className="text-xs text-muted-foreground">
                {t("settings.agents.introPrefix")} <code className="text-xs">{"{path}"}</code>{" "}
                {t("settings.agents.introSuffix")}
              </p>
              {field(t("settings.agents.claudeCodeCommand"), "agent_cmd")}
              {field(t("settings.agents.opencodeCommand"), "opencode_cmd")}
              <label className="flex items-center gap-2 pt-1 text-sm">
                <Checkbox
                  checked={draft.use_herdr}
                  onCheckedChange={(v) => setDraft({ ...draft, use_herdr: v === true })}
                />
                {t("settings.agents.herdrCheckbox")}
              </label>
              {draft.use_herdr && field(t("settings.agents.herdrCommand"), "herdr_cmd")}
              {field(t("settings.agents.worktreeRoot"), "worktree_root")}
              <div className="space-y-1.5 pt-1">
                <label className="text-xs font-medium text-muted-foreground">
                  {t("settings.agents.claudeDesktop.label")}
                </label>
                <p className="text-[10px] leading-tight text-muted-foreground/70">
                  {t("settings.agents.claudeDesktop.description")}
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
                        {t(m.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 pt-1">
                <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  {t("settings.agents.language.label")}
                  <VaultScopedBadge />
                </label>
                <p className="text-[10px] leading-tight text-muted-foreground/70">
                  {t("settings.agents.language.description")}
                </p>
                <Select
                  value={draft.language}
                  onValueChange={(v) => setDraft({ ...draft, language: v })}
                >
                  <SelectTrigger size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 pt-1">
                <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  {t("settings.agents.remindEveryTurn.label")}
                  <VaultScopedBadge />
                </label>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[10px] leading-tight text-muted-foreground/70">
                    {t("settings.agents.remindEveryTurn.description")}
                  </p>
                  <Switch
                    checked={draft.response_language_inject}
                    onCheckedChange={(v) => setDraft({ ...draft, response_language_inject: v })}
                  />
                </div>
              </div>
              <div className="space-y-1.5 pt-1">
                <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  {t("settings.agents.customPrompt.label")}
                  <VaultScopedBadge />
                </label>
                <p className="text-[10px] leading-tight text-muted-foreground/70">
                  {t("settings.agents.customPrompt.description")}
                </p>
                <Textarea
                  value={draft.custom_prompt}
                  onChange={(e) => setDraft({ ...draft, custom_prompt: e.target.value })}
                  placeholder={t("settings.agents.customPrompt.placeholder")}
                  className="min-h-20 text-xs"
                />
              </div>
              <div className="space-y-1.5 pt-1">
                <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  {t("settings.agents.lineBreaks.label")}
                  <VaultScopedBadge />
                </label>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[10px] leading-tight text-muted-foreground/70">
                    {t("settings.agents.lineBreaks.description")}
                  </p>
                  <Switch
                    checked={draft.prompt_copy_multiline}
                    onCheckedChange={(v) => setDraft({ ...draft, prompt_copy_multiline: v })}
                  />
                </div>
              </div>
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">{t("settings.agents.memory.title")}</p>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={draft.memory_claude_code}
                    onCheckedChange={(v) => setDraft({ ...draft, memory_claude_code: v === true })}
                  />
                  {t("settings.agents.memory.claudeCode")}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={draft.memory_opencode}
                    onCheckedChange={(v) => setDraft({ ...draft, memory_opencode: v === true })}
                  />
                  {t("settings.agents.memory.opencode")}
                </label>
                {/* Grouped with the two switches above rather than with the
                    other startup checks: it is about long-term memory, and a
                    reader looking for it looks here. */}
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={draft.check_memory_setup}
                    onCheckedChange={(v) => setDraft({ ...draft, check_memory_setup: v === true })}
                  />
                  {t("settings.agents.memory.notifyStartup")}
                </label>
              </div>
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">{t("settings.agents.secretary.title")}</p>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={draft.secretary_enabled}
                    onCheckedChange={(v) => setDraft({ ...draft, secretary_enabled: v === true })}
                  />
                  {t("settings.agents.secretary.checkbox")}
                </label>
                <p className="text-xs text-muted-foreground">
                  {t("settings.agents.secretary.descriptionPrefix")}
                  <code>memory/identity/decision-policy.md</code>
                  {t("settings.agents.secretary.descriptionMid")}{" "}
                  <code>_ai/comms/</code> {t("settings.agents.secretary.descriptionSuffix")}
                </p>
              </div>
            </TabsContent>
          </div>
        </Tabs>
        {saveError && (
          <p className="text-xs text-destructive">
            {t("settings.footer.saveFailed", { error: saveError })}
          </p>
        )}
        <DialogFooter>
          {/* Recurring rules are content the user authored (edited from the
              Tasks tab, not here), not a knob with a sensible default — a reset
              of the command templates must not delete them. */}
          <Button variant="ghost" onClick={() => setDraft({ ...DEFAULTS, recurring: draft.recurring })}>
            {t("settings.footer.resetToDefaults")}
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
            {saving ? t("settings.footer.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
