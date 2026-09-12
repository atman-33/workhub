import { useState } from "react";
import { Settings2 } from "lucide-react";

import { AiEditSettings } from "@/components/ai-edit-settings";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Settings } from "@/types";

/**
 * The Mindmap tab's own settings (T-0289) — the counterpart of
 * `schedule-settings.tsx`, and for the same reason: the agent that edits the
 * map is chosen beside the map rather than in a modal over it.
 */

interface Props {
  settings: Settings | null;
  disabled?: boolean;
  onPatch: (patch: Partial<Settings>) => void;
}

export function MindmapSettings({ settings, disabled, onPatch }: Props) {
  const [open, setOpen] = useState(false);
  const ready = settings != null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Hint label="Mindmap settings" disabled={disabled || !ready}>
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
      <PopoverContent className="w-72 p-3 text-xs" align="end">
        {settings && (
          <AiEditSettings
            subject="mindmap"
            assignee={settings.mindmap_assignee}
            model={settings.mindmap_model}
            confirm={settings.mindmap_confirm}
            active={open}
            onAssigneeChange={(v) =>
              // Model ids are per-CLI — see the same note in the Schedule tab.
              onPatch({ mindmap_assignee: v, mindmap_model: "" })
            }
            onModelChange={(model) => onPatch({ mindmap_model: model })}
            onConfirmChange={(v) => onPatch({ mindmap_confirm: v })}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
