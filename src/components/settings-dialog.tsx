import { useEffect, useState } from "react";
import { open as pickFolders } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
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
import type { Settings } from "@/types";

const DEFAULTS: Settings = {
  vscode_cmd: "code",
  terminal_cmd: "wt -d {path}",
  agent_cmd: "wt -d {path} pwsh -NoExit -Command claude",
  opencode_cmd: "wt -d {path} pwsh -NoExit -Command opencode",
  use_herdr: true,
  herdr_cmd: "herdr",
  check_updates: true,
  vault_path: null,
  worktree_root: "C:/repos/.worktrees",
};

interface Props {
  open: boolean;
  settings: Settings;
  onClose: () => void;
  onSave: (settings: Settings) => void;
}

export function SettingsDialog({ open, settings, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<Settings>(settings);

  useEffect(() => {
    if (open) setDraft(settings);
  }, [open, settings]);

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
