import { CornerDownRight, Plus, StickyNote, Trash2, X } from "lucide-react";
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
import { AttrEditor } from "./attr-editor";
import {
  COLOR_HEX,
  COLORS,
  STICKY_DEFAULT_COLOR,
  type Color,
  type MindmapNode,
  type Sticky,
} from "@/lib/mindmap/parse";
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
  /** Attribute keys used anywhere in this map, offered as suggestions. The
   * vocabulary is the map's own — keys are not configured anywhere. */
  attrKeys: string[];
  /** Values used for one key anywhere in this map. */
  attrValuesFor: (key: string) => string[];
  /** The note's chip order, which the attribute rows are listed in and which
   * dragging one of them changes. It belongs to the map, not to this node. */
  attrChips: "all" | string[];
  onAttrChipsChange: (chips: "all" | string[]) => void;
  disabled?: boolean;
  /** The sticky notes pinned to this node. */
  stickies: Sticky[];
  /** True while the note hides every sticky — an added one would land
   * somewhere invisible, so the panel says so. */
  stickiesHidden: boolean;
  onAddSticky: () => void;
  onChangeSticky: (id: string, patch: Partial<Sticky>) => void;
  onDeleteSticky: (id: string) => void;
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
  attrKeys,
  attrValuesFor,
  attrChips,
  onAttrChipsChange,
  disabled,
  stickies,
  stickiesHidden,
  onAddSticky,
  onChangeSticky,
  onDeleteSticky,
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
          <Hint key={color} label={color} disabled={disabled}>
            <button
              type="button"
              disabled={disabled}
              // Clicking the current colour clears it, so a branch can go back to
              // inheriting its parent's — otherwise the only way out of a colour
              // would be editing the file by hand.
              onClick={() =>
                onChange({ color: node.color === color ? undefined : (color as Color) })
              }
              style={{ background: COLOR_HEX[color as Color] }}
              className={cn(
                "size-5 rounded",
                node.color === color && "ring-2 ring-foreground ring-offset-1 ring-offset-background",
              )}
            />
          </Hint>
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

      <AttrEditor
        attrs={node.attrs}
        knownKeys={attrKeys}
        valuesFor={attrValuesFor}
        chips={attrChips}
        onChipsChange={onAttrChipsChange}
        disabled={disabled}
        onChange={(attrs) => onChange({ attrs })}
      />

      <div className="space-y-2 border-t pt-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">
            Sticky notes
            {stickiesHidden && stickies.length > 0 && " (hidden on the map)"}
          </span>
          <Hint label="Pin a sticky note to this node" disabled={disabled}>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px]"
              disabled={disabled}
              onClick={onAddSticky}
            >
              <StickyNote className="mr-1 size-3" />
              Add
            </Button>
          </Hint>
        </div>

        {stickies.map((sticky) => (
          <div key={sticky.id} className="space-y-1.5 rounded border p-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] text-muted-foreground">{sticky.id}</span>
              <Hint label="Remove this sticky" disabled={disabled}>
                <Button
                  size="sm"
                  variant="ghost"
                  className="size-5 p-0"
                  disabled={disabled}
                  onClick={() => onDeleteSticky(sticky.id)}
                >
                  <X className="size-3" />
                </Button>
              </Hint>
            </div>
            <Textarea
              value={sticky.text}
              placeholder="Sticky text"
              rows={2}
              disabled={disabled}
              className="resize-none text-xs"
              onChange={(e) => onChangeSticky(sticky.id, { text: e.target.value })}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <div className="flex flex-wrap gap-1">
              {COLORS.map((color) => (
                <Hint key={color} label={color} disabled={disabled}>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onChangeSticky(sticky.id, { color: color as Color })}
                    style={{ background: COLOR_HEX[color as Color] }}
                    className={cn(
                      "size-4 rounded",
                      (sticky.color ?? STICKY_DEFAULT_COLOR) === color &&
                        "ring-2 ring-foreground ring-offset-1 ring-offset-background",
                    )}
                  />
                </Hint>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Hint label="Add a child (Tab)" disabled={disabled}>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={disabled}
            onClick={onAddChild}
          >
            <CornerDownRight className="mr-1 size-3" />
            Child
          </Button>
        </Hint>
        <Hint label="Add a sibling (Enter)" disabled={disabled}>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={disabled}
            onClick={onAddSibling}
          >
            <Plus className="mr-1 size-3" />
            Sibling
          </Button>
        </Hint>
        <Hint
          label={
            childCount > 0
              ? `Delete this node and its ${childCount} descendant branch(es) (Delete)`
              : "Delete this node (Delete)"
          }
          disabled={disabled}
        >
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            disabled={disabled}
            onClick={onDelete}
          >
            <Trash2 className="mr-1 size-3" />
            Delete
          </Button>
        </Hint>
      </div>
    </div>
  );
}
