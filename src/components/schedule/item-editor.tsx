import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { COLOR_HEX, COLORS, type Color, type ScheduleItem } from "@/lib/schedule/parse";
import { cn } from "@/lib/utils";
import type { Task } from "@/types";

/**
 * Edit panel for one element: title, dates, color, task link — the fields
 * dragging cannot express.
 *
 * Dates use the app's `DatePicker` rather than `<input type="date">` on
 * purpose: the native popup renders in the OS display language, which turns
 * this pane Japanese-or-English depending on the machine
 * (`.claude/rules/tauri-webview-gotchas.md`).
 *
 * The element `id` is displayed but never editable. It is the handle the AI
 * and the file both use to identify the element; reassigning it would silently
 * break the link between a note's history and the thing it describes.
 *
 * `Details` is the element's body — the indented continuation lines under it
 * in the file. A note shows it on hover in the grid; a bar or milestone shows
 * it in its tooltip, where it reads as a remark about the element.
 */

interface Props {
  item: ScheduleItem;
  /** Tasks of the current project, offered for the `task:` link. */
  tasks: Task[];
  onChange: (next: ScheduleItem) => void;
  onDelete: () => void;
  onClose: () => void;
}

/** Sentinel for the Select's "no value" option — Radix rejects an empty
 * string as an item value. */
const NONE = "__none__";

/** Folds pasted line breaks into spaces. The title is the element's single
 * grammar line in the file, so a newline there would emit a second,
 * unparsable line; multi-line text belongs in the body. */
function collapseLines(value: string): string {
  return value.split(/\s*[\r\n]+\s*/).join(" ");
}

export function ItemEditor({ item, tasks, onChange, onDelete, onClose }: Props) {
  const [draft, setDraft] = useState(item);

  // Re-seed when the grid selects a different element (the panel is reused).
  useEffect(() => setDraft(item), [item]);

  const commit = (patch: Partial<ScheduleItem>) => {
    const next = { ...draft, ...patch };
    // A bar cannot end before it starts; pushing the far edge along is less
    // surprising than rejecting the edit the user just made.
    if (next.kind === "bar" && next.end < next.start) {
      if (patch.start) next.end = next.start;
      else next.start = next.end;
    }
    if (next.kind !== "bar") next.end = next.start;
    setDraft(next);
    onChange(next);
  };

  return (
    // Width comes from the sidebar column, not from here — see schedule-view.
    <div className="shrink-0 space-y-3 border-b p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] text-muted-foreground">{draft.id}</span>
        <Select
          value={draft.kind}
          onValueChange={(v) => commit({ kind: v as ScheduleItem["kind"] })}
        >
          <SelectTrigger className="h-7 w-28 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="bar">Bar</SelectItem>
            <SelectItem value="milestone">Milestone</SelectItem>
            <SelectItem value="note">Note</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Input
        value={draft.title}
        placeholder="Title"
        className="h-8 text-xs"
        onChange={(e) => commit({ title: collapseLines(e.target.value) })}
      />

      <Textarea
        value={draft.body ?? ""}
        placeholder={draft.kind === "note" ? "Note text (shown on hover)" : "Details"}
        rows={draft.kind === "note" ? 4 : 2}
        className="resize-none text-xs"
        onChange={(e) => commit({ body: e.target.value })}
      />

      <div className="space-y-1.5">
        <DatePicker value={draft.start} onChange={(v) => v && commit({ start: v })} />
        {draft.kind === "bar" && (
          <DatePicker value={draft.end} onChange={(v) => v && commit({ end: v })} />
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {COLORS.map((color) => (
          <button
            key={color}
            type="button"
            title={color}
            onClick={() => commit({ color })}
            style={{ background: COLOR_HEX[color as Color] }}
            className={cn(
              "size-5 rounded",
              draft.color === color && "ring-2 ring-foreground ring-offset-1 ring-offset-background",
            )}
          />
        ))}
      </div>

      <Select
        value={draft.task ?? NONE}
        onValueChange={(v) => commit({ task: v === NONE ? undefined : v })}
      >
        <SelectTrigger className="h-7 text-xs">
          <SelectValue placeholder="No linked task" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>No linked task</SelectItem>
          {tasks.map((task) => (
            <SelectItem key={task.id} value={task.id}>
              {task.id} {task.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex justify-between pt-1">
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onDelete}>
          <Trash2 className="mr-1 size-3" />
          Delete
        </Button>
        <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
