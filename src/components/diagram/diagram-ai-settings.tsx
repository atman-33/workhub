import { useState } from "react";
import { Settings2 } from "lucide-react";

import { AiEditSettings } from "@/components/ai-edit-settings";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT } from "@/lib/i18n";
import type { Settings } from "@/types";

/**
 * Which agent edits a diagram, on which model, and whether the result is
 * reviewed first (T-0289, unified in T-0685). One setting for every kind of
 * diagram, so it sits in the Diagrams tab's toolbar rather than in each
 * editor. Every change saves immediately through the caller's `onPatch`.
 */

interface Props {
  settings: Settings | null;
  disabled?: boolean;
  onPatch: (patch: Partial<Settings>) => void;
}

export function DiagramAiSettings({ settings, disabled, onPatch }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ready = settings != null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Hint label={t("diagram.aiPanel.settingsHint")} disabled={disabled || !ready}>
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
            assignee={settings.diagram_assignee}
            model={settings.diagram_model}
            confirm={settings.diagram_confirm}
            active={open}
            onAssigneeChange={(v) =>
              // Model ids are per-CLI: a claude id left behind on an opencode
              // run would be passed straight through to `--model` and fail.
              onPatch({ diagram_assignee: v, diagram_model: "" })
            }
            onModelChange={(model) => onPatch({ diagram_model: model })}
            onConfirmChange={(v) => onPatch({ diagram_confirm: v })}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
