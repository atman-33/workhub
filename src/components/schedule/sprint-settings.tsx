import { useState } from "react";
import { Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { SprintConfig } from "@/lib/schedule/parse";
import { defaultSprintStart } from "@/lib/schedule/sprint";

/**
 * The note's sprint cadence: a first day and a length in weeks (T-0111).
 *
 * It is edited here rather than only in Obsidian because deciding the cadence
 * is part of the same sitting as laying out the phases — "if sprints started
 * here instead, does the release land inside one" is a question asked *while*
 * looking at the chart.
 *
 * Two numbers, and the sprint band appears; clear them and it disappears. The
 * cadence never moves an element: it draws boundaries the plan is read
 * against, and where the work actually falls stays the user's call.
 *
 * Dates use the app's `DatePicker` — a native date input renders its popup in
 * the OS display language (`.claude/rules/tauri-webview-gotchas.md`).
 */

interface Props {
  /** Current cadence, or undefined when the note declares none. */
  sprint?: SprintConfig;
  /** Start of the displayed window — the default cadence start is derived from
   * it, so enabling sprints puts sprint 1 where the user is looking. */
  windowStart: string;
  disabled?: boolean;
  onChange: (sprint: SprintConfig | undefined) => void;
}

/** Offered lengths. Anything is parseable up to a quarter, but these are the
 * cadences that exist in practice, and a free number field invites a typo that
 * silently repaints the whole header. */
const LENGTHS = [1, 2, 3, 4];

export function SprintSettings({ sprint, windowStart, disabled, onChange }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Hint
        label={sprint ? `Sprints: ${sprint.weeks} week(s) from ${sprint.start}` : "Number the timeline by sprint"}
        disabled={disabled}
      >
        <PopoverTrigger asChild>
          <Button size="sm" variant={sprint ? "secondary" : "ghost"} className="h-7 text-xs" disabled={disabled}>
            <Repeat className="mr-1 size-3" />
            {sprint ? `${sprint.weeks}w sprints` : "Sprints"}
          </Button>
        </PopoverTrigger>
      </Hint>
      <PopoverContent className="w-64 space-y-3 p-3 text-xs" align="start">
        {sprint ? (
          <>
            <div className="space-y-1">
              <div className="text-muted-foreground">Sprint 1 starts</div>
              <DatePicker
                value={sprint.start}
                onChange={(v) => v && onChange({ ...sprint, start: v })}
              />
            </div>
            <div className="space-y-1">
              <div className="text-muted-foreground">Length</div>
              <div className="flex items-center gap-1">
                {LENGTHS.map((weeks) => (
                  <Button
                    key={weeks}
                    size="sm"
                    variant={sprint.weeks === weeks ? "secondary" : "ghost"}
                    className="h-7 px-2 text-xs"
                    onClick={() => onChange({ ...sprint, weeks })}
                  >
                    {weeks}w
                  </Button>
                ))}
                <Input
                  type="number"
                  min={1}
                  max={13}
                  value={sprint.weeks}
                  className="h-7 w-14 text-xs"
                  onChange={(e) => {
                    const weeks = Number(e.target.value);
                    // Out-of-range input is ignored rather than clamped: a
                    // half-typed "1" on the way to "12" should not first snap
                    // the header to one-week sprints.
                    if (Number.isInteger(weeks) && weeks >= 1 && weeks <= 13) {
                      onChange({ ...sprint, weeks });
                    }
                  }}
                />
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-full text-xs text-muted-foreground"
              onClick={() => {
                onChange(undefined);
                setOpen(false);
              }}
            >
              Turn sprints off
            </Button>
          </>
        ) : (
          <>
            <p className="text-muted-foreground">
              Number the timeline by sprint. The cadence is stored in this note, so two plans can
              compare different ones.
            </p>
            <Button
              size="sm"
              className="h-7 w-full text-xs"
              onClick={() => onChange({ start: defaultSprintStart(windowStart), weeks: 2 })}
            >
              Use two-week sprints
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
