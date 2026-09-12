import { useState } from "react";
import { Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Settings } from "@/types";

/**
 * The Repos tab's own settings: the commands that open a repository (T-0304).
 *
 * `vscode_cmd` and `terminal_cmd` are read by this tab alone — its row actions
 * and the worktrees panel it owns — so they belong beside those buttons rather
 * than in the settings dialog, which is where the tab-owned settings of Voice,
 * Ink, Clips, Docs, Schedule, Mindmap, Inbox and Tasks already left
 * (`.claude/rules/settings-placement.md`). The agent launchers stay in the
 * dialog's Agents tab: those are read when a task is launched, not here.
 *
 * Both are free text, so each is edited locally and committed on blur — saving
 * per keystroke would write the config on every character. `onPatch` merges
 * onto a fresh read of the config (T-0281).
 */

interface Props {
  settings: Settings | null;
  onPatch: (patch: Partial<Settings>) => void;
}

export function ReposSettings({ settings, onPatch }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<Settings>>({});

  const ready = settings != null;
  const value = (key: "vscode_cmd" | "terminal_cmd") =>
    draft[key] ?? settings?.[key] ?? "";

  const commit = (key: "vscode_cmd" | "terminal_cmd") => {
    const next = draft[key];
    if (next === undefined || next === settings?.[key]) return;
    onPatch({ [key]: next });
  };

  const field = (label: string, key: "vscode_cmd" | "terminal_cmd", hint: string) => (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Input
        value={value(key)}
        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
        onBlur={() => commit(key)}
        className="h-8 font-mono text-xs"
      />
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        // Commit whatever is in the fields before closing, so a value typed and
        // then dismissed with Escape is not silently lost.
        if (!v) {
          commit("vscode_cmd");
          commit("terminal_cmd");
          setDraft({});
        }
        setOpen(v);
      }}
    >
      <Hint label="Repos settings" disabled={!ready}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="ghost" className="h-8" disabled={!ready}>
            <Settings2 className="size-3.5" />
          </Button>
        </PopoverTrigger>
      </Hint>
      <PopoverContent className="w-80 space-y-3 p-3 text-xs" align="end">
        <p className="text-[11px] text-muted-foreground">
          How a repository is opened from this tab. <code className="text-[11px]">{"{path}"}</code>{" "}
          is replaced with the repository path.
        </p>
        {field("VS Code command", "vscode_cmd", "Also used by the Worktrees panel.")}
        {field("Terminal command", "terminal_cmd", "Opened at the repository's folder.")}
      </PopoverContent>
    </Popover>
  );
}
