import { useState } from "react";
import { Settings2 } from "lucide-react";

import { AiEditSettings } from "@/components/ai-edit-settings";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Settings } from "@/types";

/**
 * The Schedule tab's own settings (T-0289).
 *
 * They used to live in ⚙ Settings → Vault, which meant opening a modal over
 * the calendar to change them. (The calendar's language is no longer one of
 * them: it follows the app-wide display language since T-0409.) The Voice,
 * Ink, Clips and Docs tabs already own their settings; this is the same move
 * for Schedule (`.claude/rules/settings-placement.md`).
 *
 * Every change saves immediately through the caller's `onPatch`, which merges
 * onto a fresh read of the config so a value another tab changed meanwhile is
 * not reverted (T-0281).
 */

interface Props {
  settings: Settings | null;
  disabled?: boolean;
  onPatch: (patch: Partial<Settings>) => void;
}

export function ScheduleSettings({ settings, disabled, onPatch }: Props) {
  const [open, setOpen] = useState(false);
  // The export folder is free text, so it is edited locally and committed on
  // blur — saving per keystroke would write the config on every character.
  const [exportDir, setExportDir] = useState<string | null>(null);

  const ready = settings != null;
  const currentExportDir = exportDir ?? settings?.schedule_export_dir ?? "";

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        // Drop the local draft when the popover closes, so the next open shows
        // whatever is actually stored.
        if (!v) setExportDir(null);
      }}
    >
      <Hint label="Schedule settings" disabled={disabled || !ready}>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={disabled || !ready}
          >
            <Settings2 className="size-3.5" />
          </Button>
        </PopoverTrigger>
      </Hint>
      <PopoverContent className="w-72 space-y-4 p-3 text-xs" align="end">
        {settings && (
          <>
            <AiEditSettings
              subject="schedule"
              assignee={settings.schedule_assignee}
              model={settings.schedule_model}
              confirm={settings.schedule_confirm}
              active={open}
              onAssigneeChange={(v) =>
                // Clear the model when the agent changes: model ids are
                // per-CLI, so a claude id left behind on an opencode run would
                // be passed straight through to `--model` and fail.
                onPatch({ schedule_assignee: v, schedule_model: "" })
              }
              onModelChange={(model) => onPatch({ schedule_model: model })}
              onConfirmChange={(v) => onPatch({ schedule_confirm: v })}
            />

            <div className="space-y-1.5 border-t pt-3">
              <label className="text-xs font-medium text-muted-foreground">
                HTML export folder
              </label>
              <Input
                value={currentExportDir}
                onChange={(e) => setExportDir(e.target.value)}
                onBlur={() => {
                  if (exportDir != null && exportDir !== settings.schedule_export_dir) {
                    onPatch({ schedule_export_dir: exportDir });
                  }
                }}
                placeholder="blank = the project's attachments/"
                className="h-8 font-mono text-xs"
              />
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
