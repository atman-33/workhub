import { CornerDownRight, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { COLOR_HEX, COLORS, type Color, type MindmapNode } from "@/lib/mindmap/parse";
import { cn } from "@/lib/utils";
import type { Task } from "@/types";

/**
 * Edit panel for the selected node: the fields the canvas cannot express by
 * dragging or typing — colour, task link, and the longer note.
 *
 * The node `id` is displayed but never editable. It is the handle the AI and
 * the file both use to identify the node; reassigning it would silently break
 * the link between a map's history and the thing it describes.
 *
 * Like the schedule's item editor, this panel holds **no draft state**: every
 * field renders straight from `node`, so an inline rename or a re-parent on
 * the canvas is reflected here immediately rather than being served stale from
 * a local copy.
 */

interface Props {
  node: MindmapNode;
  /** Tasks of the current project, offered for the `task:` link. */
  tasks: Task[];
  disabled?: boolean;
  onChange: (patch: Partial<MindmapNode>) => void;
  onAddChild: () => void;
  onAddSibling: () => void;
  onDelete: () => void;
}

/** Sentinel for the Select's "no value" option — Radix rejects an empty
 * string as an item value. */
const NONE = "__none__";

/** Folds pasted line breaks into spaces. The title is the node's single
 * grammar line in the file, so a newline there would emit a second, unparsable
 * line; multi-line text belongs in the note. */
function collapseLines(value: string): string {
  return value.split(/\s*[\r\n]+\s*/).join(" ");
}

export function NodeEditor({
  node,
  tasks,
  disabled,
  onChange,
  onAddChild,
  onAddSibling,
  onDelete,
}: Props) {
  const childCount = node.children.length;

  return (
    // Width comes from the sidebar column, not from here — see mindmap-view.
    <div className="shrink-0 space-y-3 border-b p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="truncate font-mono text-[11px] text-muted-foreground">{node.id}</span>
        {childCount > 0 && (
          <span className="text-[11px] text-muted-foreground">
            {childCount} {childCount === 1 ? "child" : "children"}
          </span>
        )}
      </div>

      <Input
        value={node.title}
        placeholder="Title"
        disabled={disabled}
        className="h-8 text-xs"
        onChange={(e) => onChange({ title: collapseLines(e.target.value) })}
        // The canvas owns Tab/Enter as tree commands; inside a text field they
        // have to mean what they always mean.
        onKeyDown={(e) => e.stopPropagation()}
      />

      <Textarea
        value={node.note ?? ""}
        placeholder="Note (shown on hover)"
        rows={3}
        disabled={disabled}
        className="resize-none text-xs"
        onChange={(e) => onChange({ note: e.target.value })}
        onKeyDown={(e) => e.stopPropagation()}
      />

      <div className="flex flex-wrap gap-1.5">
        {COLORS.map((color) => (
          <button
            key={color}
            type="button"
            title={color}
            disabled={disabled}
            // Clicking the current colour clears it, so a branch can go back to
            // inheriting its parent's — otherwise the only way out of a colour
            // would be editing the file by hand.
            onClick={() => onChange({ color: node.color === color ? undefined : (color as Color) })}
            style={{ background: COLOR_HEX[color as Color] }}
            className={cn(
              "size-5 rounded",
              node.color === color && "ring-2 ring-foreground ring-offset-1 ring-offset-background",
            )}
          />
        ))}
      </div>

      <Select
        value={node.task ?? NONE}
        disabled={disabled}
        onValueChange={(v) => onChange({ task: v === NONE ? undefined : v })}
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

      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={disabled}
          onClick={onAddChild}
          title="Add a child (Tab)"
        >
          <CornerDownRight className="mr-1 size-3" />
          Child
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={disabled}
          onClick={onAddSibling}
          title="Add a sibling (Enter)"
        >
          <Plus className="mr-1 size-3" />
          Sibling
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          disabled={disabled}
          onClick={onDelete}
          title={
            childCount > 0
              ? `Delete this node and its ${childCount} descendant branch(es) (Delete)`
              : "Delete this node (Delete)"
          }
        >
          <Trash2 className="mr-1 size-3" />
          Delete
        </Button>
      </div>
    </div>
  );
}
