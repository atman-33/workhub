import { useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { DraftInput } from "@/components/diagram/draft-field";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import { actionsOf, type UsecaseNode } from "@/lib/diagram/usecase/parse";
import { useT } from "@/lib/i18n";

/**
 * The editor of a person's actions - the lines of their speech bubble (T-0707).
 * One text field per action with a delete button, and an empty field at the end
 * that adds one. Same behaviour as the IFDAM screen sections: Enter commits and
 * moves to the next action (the last one lands in the add field, where Enter
 * adds and stays, so a list is typed in one go); emptying an action and
 * committing deletes it. The order is the order of the lines in the file.
 */
const ADD_TAG = "add";
const ITEM_PREFIX = "action:";

interface Props {
  node: UsecaseNode;
  onAdd: (text: string) => void;
  /** An empty `text` deletes the action. */
  onSet: (index: number, text: string) => void;
}

/** Moves focus to the field after `current` among the list's fields. */
function focusNext(container: HTMLElement | null, current: HTMLElement) {
  if (!container) return;
  const fields = Array.from(
    container.querySelectorAll<HTMLInputElement>(`[data-draft-item^="${ITEM_PREFIX}"]`),
  );
  const next = fields[fields.indexOf(current as HTMLInputElement) + 1];
  next?.focus();
  next?.select();
}

function AddField({ placeholder, onAdd }: { placeholder: string; onAdd: (text: string) => void }) {
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
        data-draft-item={`${ITEM_PREFIX}${ADD_TAG}`}
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

export function ActionList({ node, onAdd, onSet }: Props) {
  const t = useT();
  const container = useRef<HTMLDivElement>(null);
  return (
    <div ref={container} className="space-y-1">
      <div className="text-[11px] font-medium text-muted-foreground">
        {t("diagram.usecase.actionsTitle")}
      </div>
      {actionsOf(node).map((text, index) => (
        <div key={index} className="flex items-center gap-1">
          <DraftInput
            value={text}
            itemAttr={`${ITEM_PREFIX}${index}`}
            onCommit={(next) => onSet(index, next)}
            onEnter={(input, committed) => {
              // An emptied action is gone and its neighbour now sits in this
              // field: stay, rather than skip it.
              if (committed.trim()) focusNext(container.current, input);
            }}
          />
          <Hint label={t("diagram.usecase.deleteActionHint")}>
            <Button
              size="sm"
              variant="ghost"
              className="size-6 shrink-0 p-0 text-muted-foreground"
              onClick={() => onSet(index, "")}
            >
              <X className="size-3" />
            </Button>
          </Hint>
        </div>
      ))}
      <AddField placeholder={t("diagram.usecase.addActionPlaceholder")} onAdd={onAdd} />
    </div>
  );
}
