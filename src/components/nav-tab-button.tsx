import type { ComponentType, Ref } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Hint } from "@/components/ui/hint";
import { cn } from "@/lib/utils";

/**
 * One tab of the top bar (T-0684). Draggable among its siblings; the drag only
 * starts after the pointer travels a few pixels (see the sensor in `app.tsx`),
 * so a plain click still selects the tab.
 */
export function NavTabButton({
  tabKey,
  label,
  icon: Icon,
  active,
  sortable,
  onSelect,
  buttonRef,
}: {
  tabKey: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  active: boolean;
  /** False for the transient entry of a hidden tab that is currently open. */
  sortable: boolean;
  onSelect: () => void;
  buttonRef: (el: HTMLButtonElement | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tabKey,
    disabled: !sortable,
  });
  const setRefs: Ref<HTMLButtonElement> = (el) => {
    setNodeRef(el);
    buttonRef(el);
  };
  return (
    <Hint label={label}>
      <button
        ref={setRefs}
        data-tab-key={tabKey}
        onClick={onSelect}
        style={{
          transform: CSS.Translate.toString(transform),
          transition,
        }}
        className={cn(
          "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors",
          active
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
          isDragging && "relative z-10 opacity-80 shadow-md",
        )}
        {...attributes}
        {...listeners}
      >
        <Icon className="size-3.5" />
        <span className={cn(active ? "inline" : "hidden xl:inline")}>{label}</span>
      </button>
    </Hint>
  );
}
