import { useState } from "react";
import { Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Hint } from "@/components/ui/hint";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * The Tasks tab's terminal setting (T-0300).
 *
 * `terminal_embed` decides whether an AI task runs in a herdr pane inside the
 * app or in an external window, and nothing outside this tab reads it. It used
 * to sit in the settings dialog, two clicks from the Terminal toggle it
 * governs; this puts it beside that toggle instead
 * (`.claude/rules/settings-placement.md`).
 *
 * Rendered only when herdr is the launcher — without it there is no embedded
 * terminal to show, which is the same condition the dialog applied.
 */

interface Props {
  embed: boolean;
  onEmbedChange: (embed: boolean) => void;
}

export function TerminalSettings({ embed, onEmbedChange }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Hint label="Terminal settings">
        <PopoverTrigger asChild>
          <Button size="icon-sm" variant="ghost" className="h-8">
            <Settings2 className="size-3.5" />
          </Button>
        </PopoverTrigger>
      </Hint>
      <PopoverContent className="w-72 space-y-2 p-3 text-xs" align="end">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={embed} onCheckedChange={(v) => onEmbedChange(v === true)} />
          Embed terminal
        </label>
        <p className="pl-6 text-[11px] text-muted-foreground">
          Show herdr inside the app instead of launching an external window. Off hides the
          Terminal toggle beside this button.
        </p>
      </PopoverContent>
    </Popover>
  );
}
