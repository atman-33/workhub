import { useState } from "react";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import { attrValueColor, setAttr } from "@/lib/mindmap/attrs";
import {
  COLOR_HEX,
  formatTags,
  isAttrKey,
  parseTags,
  STICKY_FILL_HEX,
  STICKY_INK,
  TAGS_KEY,
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

export function AttrEditor({ attrs, knownKeys, valuesFor, disabled, onChange }: Props) {
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newTag, setNewTag] = useState("");

  const tags = parseTags(attrs?.[TAGS_KEY]);
  const plainKeys = Object.keys(attrs ?? {})
    .filter((k) => k !== TAGS_KEY)
    .sort();

  const set = (key: string, value: string) => onChange(setAttr(attrs, key, value));

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const reorderTags = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = tags.indexOf(String(active.id));
    const to = tags.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    set(TAGS_KEY, formatTags(arrayMove(tags, from, to)));
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
    const key = newKey.trim().toLowerCase();
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

      {plainKeys.map((key) => (
        <div key={key} className="flex items-center gap-1.5">
          <span className="w-20 shrink-0 truncate font-mono text-[10px] text-muted-foreground">
            {key}
          </span>
          <Input
            value={attrs?.[key] ?? ""}
            disabled={disabled}
            list={`mindmap-attr-${key}`}
            className="h-7 text-xs"
            onChange={(e) => set(key, clean(e.target.value))}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <datalist id={`mindmap-attr-${key}`}>
            {valuesFor(key).map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <Hint label={`Remove ${key}`} disabled={disabled}>
            <Button
              size="sm"
              variant="ghost"
              className="size-6 shrink-0 p-0"
              disabled={disabled}
              onClick={() => set(key, "")}
            >
              ×
            </Button>
          </Hint>
        </div>
      ))}

      <div className="flex items-center gap-1.5">
        <Input
          value={newKey}
          placeholder="key"
          disabled={disabled}
          list="mindmap-attr-keys"
          className="h-7 w-20 shrink-0 text-xs"
          onChange={(e) => setNewKey(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
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
