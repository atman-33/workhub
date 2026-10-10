import { useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { DraftInput } from "@/components/diagram/ifdam/draft-field";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import { SECTION_KEYS, sectionItems, type IfdamNode, type SectionKey } from "@/lib/diagram/ifdam/parse";
import { useT, type MessageKey } from "@/lib/i18n";

/**
 * The three editors of a screen's contents (T-0704): display items, input
 * items and operation items. One text field per item with a delete button, and
 * an empty field at the end of each section that adds an item.
 *
 * Enter commits the field and moves to the next item of the section (the last
 * item's Enter lands in the add field; Enter there adds the item and stays, so
 * a list is typed in one go). Emptying an item and committing deletes it. There
 * is no reordering: the order is the order of the lines in the file.
 */
const SECTION_LABEL: Record<SectionKey, MessageKey> = {
  show: "diagram.ifdam.section.show",
  input: "diagram.ifdam.section.input",
  action: "diagram.ifdam.section.action",
};

const ADD_TAG = "add";

interface Props {
  node: IfdamNode;
  onAdd: (key: SectionKey, text: string) => void;
  /** An empty `text` deletes the item. */
  onSet: (key: SectionKey, index: number, text: string) => void;
}

/** Moves focus to the field after `current` among the section's fields. */
function focusNext(container: HTMLElement | null, current: HTMLElement, key: SectionKey) {
  if (!container) return;
  const fields = Array.from(
    container.querySelectorAll<HTMLInputElement>(`[data-ifdam-item^="${key}:"]`),
  );
  const next = fields[fields.indexOf(current as HTMLInputElement) + 1];
  next?.focus();
  next?.select();
}

function AddField({
  placeholder,
  itemAttr,
  onAdd,
}: {
  placeholder: string;
  itemAttr: string;
  onAdd: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const skipBlur = useRef(false);
  const commit = () => {
    if (text.trim()) onAdd(text);
    setText("");
  };
  return (
    <div className="flex items-center gap-1">
      <Input
        value={text}
        placeholder={placeholder}
        data-ifdam-item={itemAttr}
        className="h-7 flex-1 text-xs"
        onChange={(e) => {
          skipBlur.current = false;
          setText(e.target.value);
        }}
        onBlur={() => {
          if (skipBlur.current) {
            skipBlur.current = false;
            return;
          }
          if (text.trim()) commit();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            skipBlur.current = true;
            setText("");
            e.currentTarget.blur();
          }
        }}
      />
      <Plus className="size-3.5 shrink-0 text-muted-foreground" />
    </div>
  );
}

export function ScreenSections({ node, onAdd, onSet }: Props) {
  const t = useT();
  const container = useRef<HTMLDivElement>(null);
  return (
    <div ref={container} className="space-y-3">
      {SECTION_KEYS.map((key) => {
        const items = sectionItems(node, key);
        return (
          <div key={key} className="space-y-1">
            <div className="text-[11px] font-medium text-muted-foreground">{t(SECTION_LABEL[key])}</div>
            {items.map((text, index) => (
              <div key={index} className="flex items-center gap-1">
                <DraftInput
                  value={text}
                  itemAttr={`${key}:${index}`}
                  onCommit={(next) => onSet(key, index, next)}
                  onEnter={(input, committed) => {
                    // An emptied item is gone and its neighbour now sits in this
                    // field: stay, rather than skip it.
                    if (committed.trim()) focusNext(container.current, input, key);
                  }}
                />
                <Hint label={t("diagram.ifdam.deleteItemHint")}>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="size-6 shrink-0 p-0 text-muted-foreground"
                    onClick={() => onSet(key, index, "")}
                  >
                    <X className="size-3" />
                  </Button>
                </Hint>
              </div>
            ))}
            <AddField
              placeholder={t("diagram.ifdam.addItemPlaceholder")}
              itemAttr={`${key}:${ADD_TAG}`}
              onAdd={(text) => onAdd(key, text)}
            />
          </div>
        );
      })}
    </div>
  );
}
