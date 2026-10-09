import { useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Check, Copy, Trash2 } from "lucide-react";
import { StickyList } from "@/components/diagram/sticky-list";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { COLOR_HEX, COLORS, type Color } from "@/lib/diagram/colors";
import { formatUnit, type MatrixItem } from "@/lib/diagram/matrix2x2/parse";
import type { Sticky } from "@/lib/diagram/sticky";
import { useT } from "@/lib/i18n";
import { MINDMAP_COLOR_LABEL_KEY } from "@/lib/i18n/labels";
import { cn } from "@/lib/utils";
import type { Task } from "@/types";

/**
 * Edit panel for the selected item: the fields the canvas cannot express by
 * dragging or typing - colour, task link and the longer note.
 *
 * The item `id` is displayed but never editable: it is the handle the AI and
 * the file both use to identify the item.
 *
 * Like the Mindmap node editor, this panel holds **no draft state**: every
 * field renders straight from `item`, so a rename or a drag on the canvas is
 * reflected here immediately.
 */
interface Props {
  item: MatrixItem;
  /** Tasks offered for the `task:` link. */
  tasks: Task[];
  disabled?: boolean;
  /** The sticky notes pinned to this item. */
  stickies: Sticky[];
  stickiesHidden: boolean;
  onAddSticky: () => void;
  onChangeSticky: (id: string, patch: Partial<Sticky>) => void;
  onDeleteSticky: (id: string) => void;
  onChange: (patch: Partial<MatrixItem>) => void;
  onDelete: () => void;
}

/** Sentinel for the Select's "no value" option - Radix rejects an empty string. */
const NONE = "__none__";

/** Folds pasted line breaks into spaces. The title is the item's single
 * grammar line in the file, so a newline there would emit a second, unparsable
 * line; multi-line text belongs in the note. */
function collapseLines(value: string): string {
  return value.split(/\s*[\r\n]+\s*/).join(" ");
}

export function ItemEditor({
  item,
  tasks,
  disabled,
  stickies,
  stickiesHidden,
  onAddSticky,
  onChangeSticky,
  onDeleteSticky,
  onChange,
  onDelete,
}: Props) {
  const t = useT();
  const [idCopied, setIdCopied] = useState(false);
  const placed = item.x !== undefined && item.y !== undefined;
  // A linked task that is not in the list (another project's, or archived)
  // still has to show as the current value.
  const taskKnown = !item.task || tasks.some((task) => task.id === item.task);

  const copyId = async () => {
    try {
      await writeText(item.id);
      setIdCopied(true);
      setTimeout(() => setIdCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  };

  return (
    <div className="shrink-0 space-y-3 border-b p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate font-mono text-[11px] text-muted-foreground">{item.id}</span>
          <Hint label={t("diagram.matrix.copyIdHint")}>
            <Button size="icon" variant="ghost" className="size-5" onClick={copyId}>
              {idCopied ? <Check className="size-3" /> : <Copy className="size-3" />}
            </Button>
          </Hint>
        </span>
        {placed && (
          <span className="font-mono text-[11px] text-muted-foreground">
            {t("diagram.matrix.position", { x: formatUnit(item.x!), y: formatUnit(item.y!) })}
          </span>
        )}
      </div>
      {!placed && <p className="text-[11px] text-muted-foreground">{t("diagram.matrix.unplaced")}</p>}

      <Input
        value={item.title}
        placeholder={t("diagram.matrix.itemTitlePlaceholder")}
        disabled={disabled}
        className="h-8 text-xs"
        onChange={(e) => onChange({ title: collapseLines(e.target.value) })}
        // The canvas owns Delete and the arrows as item commands; inside a
        // text field they have to mean what they always mean.
        onKeyDown={(e) => e.stopPropagation()}
      />

      <Textarea
        value={item.note ?? ""}
        placeholder={t("diagram.matrix.itemNotePlaceholder")}
        rows={3}
        disabled={disabled}
        className="resize-none text-xs"
        onChange={(e) => onChange({ note: e.target.value })}
        onKeyDown={(e) => e.stopPropagation()}
      />

      <div className="flex flex-wrap gap-1.5">
        {COLORS.map((color) => (
          <Hint key={color} label={t(MINDMAP_COLOR_LABEL_KEY[color])} disabled={disabled}>
            <button
              type="button"
              disabled={disabled}
              // Clicking the current colour clears it.
              onClick={() => onChange({ color: item.color === color ? undefined : (color as Color) })}
              style={{ background: COLOR_HEX[color as Color] }}
              className={cn(
                "size-5 rounded",
                item.color === color && "ring-2 ring-foreground ring-offset-1 ring-offset-background",
              )}
            />
          </Hint>
        ))}
      </div>

      <Select
        value={item.task ?? NONE}
        disabled={disabled}
        onValueChange={(v) => onChange({ task: v === NONE ? undefined : v })}
      >
        <SelectTrigger className="h-7 text-xs">
          <SelectValue placeholder={t("schedule.itemEditor.noLinkedTask")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t("schedule.itemEditor.noLinkedTask")}</SelectItem>
          {!taskKnown && item.task && <SelectItem value={item.task}>{item.task}</SelectItem>}
          {tasks.map((task) => (
            <SelectItem key={task.id} value={task.id}>
              {task.id} {task.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <StickyList
        stickies={stickies}
        stickiesHidden={stickiesHidden}
        disabled={disabled}
        onAdd={onAddSticky}
        onChange={onChangeSticky}
        onDelete={onDeleteSticky}
      />

      <div className="flex flex-wrap gap-1.5">
        <Hint label={t("diagram.matrix.deleteItemHint")} disabled={disabled}>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            disabled={disabled}
            onClick={onDelete}
          >
            <Trash2 className="mr-1 size-3" />
            {t("common.delete")}
          </Button>
        </Hint>
      </div>
    </div>
  );
}
