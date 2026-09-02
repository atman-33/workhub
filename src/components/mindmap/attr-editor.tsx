import { useState } from "react";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import { attrValueColor, moveChipKey, orderedAttrKeys, setAttr } from "@/lib/mindmap/attrs";
import { cn } from "@/lib/utils";
import {
  COLOR_HEX,
  formatTags,
  isAttrKey,
  parseTags,
  STICKY_FILL_HEX,
  STICKY_INK,
  TAGS_KEY,
  toAttrKeyInput,
} from "@/lib/mindmap/parse";

/**
 * The selected node's `key:value` attributes.
 *
 * Split out of `node-editor.tsx` because it is the one part of the panel that
 * needs state of its own — the half-typed key and value of a row that does not
 * exist yet. That draft is about the *form*, not about the node, which is why
 * it does not break the panel's rule that node fields are always rendered
 * straight from `node`.
 *
 * `tags` gets a chip editor and everything else a plain value field. The
 * asymmetry is deliberate and matches the rest of the feature: `tags` is the
 * one key whose value is a list, and typing commas into a text box is a worse
 * way to manage a list than adding and removing chips.
 */

interface Props {
  attrs: Record<string, string> | undefined;
  /** Keys already used anywhere in this map, offered as suggestions. */
  knownKeys: string[];
  /** Values already used for a given key, offered as suggestions. */
  valuesFor: (key: string) => string[];
  /**
   * The note's `attr_chips`. The rows are listed in this order, and dragging
   * one changes it — the order is the map's, not the node's, which is why it
   * is passed in rather than derived from `attrs`.
   */
  chips: "all" | string[];
  onChipsChange: (chips: "all" | string[]) => void;
  disabled?: boolean;
  onChange: (attrs: Record<string, string> | undefined) => void;
}

/**
 * One tag chip, draggable into a new position.
 *
 * The order is the user's: it is what the file stores and what the canvas
 * draws, so "most important first" is expressible without a second setting.
 * A 5px activation distance keeps the remove button clickable — a press that
 * does not travel is still a click.
 */
function SortableTag({
  tag,
  disabled,
  onRemove,
}: {
  tag: string;
  disabled?: boolean;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tag,
    disabled,
  });
  const color = attrValueColor(tag);

  return (
    <span
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className="flex cursor-grab items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 1000 : 0,
        opacity: isDragging ? 0.5 : 1,
        background: STICKY_FILL_HEX[color],
        borderColor: COLOR_HEX[color],
        color: STICKY_INK,
      }}
    >
      {tag}
      <button
        type="button"
        disabled={disabled}
        aria-label={`Remove tag ${tag}`}
        className="leading-none"
        onClick={onRemove}
        // The chip itself is a drag handle; without this the button's press
        // would start a drag instead of reaching the click.
        onPointerDown={(e) => e.stopPropagation()}
      >
        ×
      </button>
    </span>
  );
}

/**
 * One `key: value` row, draggable by the grip on its left.
 *
 * The grip is a handle rather than the whole row because the row is mostly a
 * text field: making the field itself draggable would cost the click that puts
 * the caret in it.
 *
 * What the drag reorders is the map's chip order, not anything on this node —
 * a node cannot draw its own attributes in its own sequence, and two nodes
 * showing the same keys in different orders would be unreadable.
 */
function SortableKeyRow({
  attrKey,
  value,
  values,
  draggable,
  disabled,
  onChange,
  onRemove,
}: {
  attrKey: string;
  value: string;
  values: string[];
  /** False for a key the map hides, which has no drawing order to change. */
  draggable: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: attrKey,
    disabled: disabled || !draggable,
  });

  return (
    <div
      ref={setNodeRef}
      className="flex items-center gap-1.5"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 1000 : 0,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      <span
        {...attributes}
        {...listeners}
        className={cn(
          "flex w-20 shrink-0 items-center gap-1 truncate font-mono text-[10px] text-muted-foreground",
          draggable && !disabled && "cursor-grab",
        )}
      >
        {/* The grip keeps its width when it is not shown, so the fields of a
            hidden key stay lined up with the rest. */}
        <GripVertical className={cn("size-3 shrink-0", !draggable && "invisible")} />
        <span className="truncate">{attrKey}</span>
      </span>
      <Input
        value={value}
        disabled={disabled}
        list={`mindmap-attr-${attrKey}`}
        className="h-7 text-xs"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <datalist id={`mindmap-attr-${attrKey}`}>
        {values.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
      <Hint label={`Remove ${attrKey}`} disabled={disabled}>
        <Button
          size="sm"
          variant="ghost"
          className="size-6 shrink-0 p-0"
          disabled={disabled}
          onClick={onRemove}
        >
          ×
        </Button>
      </Hint>
    </div>
  );
}

export function AttrEditor({
  attrs,
  knownKeys,
  valuesFor,
  chips,
  onChipsChange,
  disabled,
  onChange,
}: Props) {
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newTag, setNewTag] = useState("");

  const tags = parseTags(attrs?.[TAGS_KEY]);
  const plainKeys = orderedAttrKeys(
    Object.keys(attrs ?? {}).filter((k) => k !== TAGS_KEY),
    chips,
    knownKeys,
  );
  /** A key the map does not draw has no drawing order, so it does not drag. */
  const drawn = chips === "all" ? knownKeys : chips;

  const set = (key: string, value: string) => onChange(setAttr(attrs, key, value));

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const reorderTags = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = tags.indexOf(String(active.id));
    const to = tags.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    set(TAGS_KEY, formatTags(arrayMove(tags, from, to)));
  };

  const reorderKeys = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    onChipsChange(moveChipKey(chips, knownKeys, String(active.id), String(over.id)));
  };

  const addTag = (raw: string) => {
    // Commas separate tags in the file, so one typed here means "next tag"
    // rather than a character of this one.
    const parts = raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...tags];
    for (const part of parts) if (!next.includes(part)) next.push(part);
    set(TAGS_KEY, formatTags(next));
    setNewTag("");
  };

  const addAttr = () => {
    const key = toAttrKeyInput(newKey.trim());
    const value = newValue.trim();
    if (!isAttrKey(key) || !value) return;
    if (key === TAGS_KEY) addTag(value);
    else set(key, value);
    setNewKey("");
    setNewValue("");
  };

  // A value may not contain whitespace: the node line is whitespace-tokenized,
  // so a space would split the attribute in two on the next save.
  const clean = (value: string) => value.replace(/\s+/g, "_");

  return (
    <div className="space-y-2 border-t pt-3">
      <span className="text-[11px] text-muted-foreground">Attributes</span>

      {tags.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={reorderTags}
        >
          <SortableContext items={tags} strategy={rectSortingStrategy}>
            <div className="flex flex-wrap gap-1">
              {tags.map((tag) => (
                <SortableTag
                  key={tag}
                  tag={tag}
                  disabled={disabled}
                  onRemove={() => set(TAGS_KEY, formatTags(tags.filter((t) => t !== tag)))}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <Input
        value={newTag}
        placeholder="Add a tag"
        disabled={disabled}
        list="mindmap-tag-values"
        className="h-7 text-xs"
        onChange={(e) => setNewTag(clean(e.target.value))}
        onBlur={() => addTag(newTag)}
        onKeyDown={(e) => {
          e.stopPropagation();
          // The Enter that confirms an IME conversion is not the Enter that
          // ends the tag: without this, typing a Japanese tag files it half
          // converted and starts the next one.
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            addTag(newTag);
          }
        }}
      />
      <datalist id="mindmap-tag-values">
        {valuesFor(TAGS_KEY).map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>

      {plainKeys.length > 0 && (
        <>
        <span className="block text-[10px] text-muted-foreground">
          Drag to reorder the chips on every node
        </span>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={reorderKeys}>
          <SortableContext items={plainKeys} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {plainKeys.map((key) => (
                <SortableKeyRow
                  key={key}
                  attrKey={key}
                  value={attrs?.[key] ?? ""}
                  values={valuesFor(key)}
                  draggable={drawn.includes(key)}
                  disabled={disabled}
                  onChange={(v) => set(key, clean(v))}
                  onRemove={() => set(key, "")}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
        </>
      )}

      <div className="flex items-center gap-1.5">
        <Input
          value={newKey}
          placeholder="key"
          disabled={disabled}
          list="mindmap-attr-keys"
          className="h-7 w-20 shrink-0 text-xs"
          onChange={(e) => setNewKey(toAttrKeyInput(e.target.value))}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <datalist id="mindmap-attr-keys">
          {knownKeys.map((k) => (
            <option key={k} value={k} />
          ))}
        </datalist>
        <Input
          value={newValue}
          placeholder="value"
          disabled={disabled}
          className="h-7 text-xs"
          onChange={(e) => setNewValue(clean(e.target.value))}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter") addAttr();
          }}
        />
        <Hint label="Add this attribute" disabled={disabled || !isAttrKey(newKey) || !newValue}>
          <Button
            size="sm"
            variant="outline"
            className="h-7 shrink-0 px-2 text-[11px]"
            disabled={disabled || !isAttrKey(newKey) || !newValue}
            onClick={addAttr}
          >
            Add
          </Button>
        </Hint>
      </div>
    </div>
  );
}
