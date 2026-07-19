import * as React from "react";
import { CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  MINUTE_STEP,
  applyDateTime,
  floorMinute,
  pad,
  roundToStep,
} from "@/lib/date-time";

interface DateTimePickerProps {
  /** Unix seconds, or null when unset. */
  value: number | null;
  onChange: (value: number | null) => void;
  placeholder?: string;
  className?: string;
  /**
   * Render the popover as its own modal layer. Needed when the picker lives
   * inside a modal Radix Dialog — otherwise the dialog's scroll-lock and
   * pointer-events guard swallow wheel and click on the portaled popup.
   */
  modal?: boolean;
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const MINUTES = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP);

const DISPLAY = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * A date **and time** picker built from Popover + Calendar + two Selects,
 * replacing the native `<input type="datetime-local">`. The native popup —
 * its calendar, and its Clear/Today buttons — renders in the OS display
 * language regardless of the page's `lang`, so a Japanese Windows shows a
 * Japanese picker. Everything here is hard-coded English, matching the
 * date-only `DatePicker` (see its header comment) and the rest of the UI.
 */
export function DateTimePicker({
  value,
  onChange,
  placeholder = "Pick a date and time",
  className,
  modal = false,
}: DateTimePickerProps) {
  const [open, setOpen] = React.useState(false);
  const selected = value ? new Date(value * 1000) : undefined;

  // The time selects need a concrete time even before a date is picked; fall
  // back to "now" so the dropdowns are never blank.
  const base = selected ?? roundToStep(new Date());

  /** Re-emit `base` with one field replaced. */
  const emit = (patch: { date?: Date; hour?: number; minute?: number }) => {
    onChange(applyDateTime(base, patch));
  };

  return (
    <Popover open={open} onOpenChange={setOpen} modal={modal}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(
            "h-8 w-full justify-start px-2 text-xs font-normal",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="size-3.5 shrink-0 opacity-50" />
          <span className="flex-1 truncate text-left">
            {selected ? DISPLAY.format(selected) : placeholder}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={base}
          onSelect={(date) => {
            if (date) emit({ date });
          }}
        />
        <div className="flex items-center gap-1.5 border-t p-3">
          <span className="mr-auto text-xs font-medium text-muted-foreground">Time</span>
          <Select
            value={String(base.getHours())}
            onValueChange={(v) => emit({ hour: Number(v) })}
          >
            <SelectTrigger size="sm" className="w-16">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOURS.map((h) => (
                <SelectItem key={h} value={String(h)}>
                  {pad(h)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">:</span>
          <Select
            value={String(floorMinute(base.getMinutes()))}
            onValueChange={(v) => emit({ minute: Number(v) })}
          >
            <SelectTrigger size="sm" className="w-16">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MINUTES.map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {pad(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex justify-end gap-1.5 border-t p-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            Clear
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-7 text-xs"
            onClick={() => {
              // Today at the currently shown time-of-day, matching what the
              // native picker's "Today" button did.
              emit({ date: new Date() });
              setOpen(false);
            }}
          >
            Today
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
