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
import type { Settings, UpdateInfo } from "@/types";

const DEFAULTS: Settings = {
  vscode_cmd: "code",
  terminal_cmd: "wt -d {path}",
  agent_cmd: "wt -d {path} pwsh -NoExit -Command claude",
  opencode_cmd: "wt -d {path} pwsh -NoExit -Command opencode",
  use_herdr: true,
  herdr_cmd: "herdr",
  check_updates: true,
  ink_enabled: true,
  vault_path: null,
  worktree_root: "C:/repos/.worktrees",
  terminal_embed: false,
};

interface Props {
  open: boolean;
  settings: Settings;
  onClose: () => void;
  onSave: (settings: Settings) => void;
}

export function SettingsDialog({ open, settings, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [version, setVersion] = useState("");
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [phase, setPhase] = useState<
    "idle" | "checking" | "uptodate" | "available" | "downloading" | "ready" | "failed"
  >("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setDraft(settings);
      setUpdate(null);
      setPhase("idle");
      setError("");
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Command templates — <code className="text-xs">{"{path}"}</code> is replaced with the
            project path.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
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
          <label className="flex items-center gap-2 pt-1 text-sm">
            <Checkbox
              checked={draft.check_updates}
              onCheckedChange={(v) => setDraft({ ...draft, check_updates: v === true })}
            />
            Check for updates on startup
          </label>
          <label className="flex items-center gap-2 pt-1 text-sm">
            <Checkbox
              checked={draft.ink_enabled}
              onCheckedChange={(v) => setDraft({ ...draft, ink_enabled: v === true })}
            />
            Screen annotation (double-press and hold Alt to draw)
          </label>
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
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setDraft(DEFAULTS)}>
            Reset to defaults
          </Button>
          <Button
            onClick={() => {
              onSave(draft);
              onClose();
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
