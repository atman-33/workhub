import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PlaylistItem } from "@/lib/music/types";
import { useMusicStore } from "@/stores/music";

const getThumbnailUrl = (videoId: string) => `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;

function SortableItem({
  item,
  index,
  isCurrent,
}: {
  item: PlaylistItem;
  index: number;
  isCurrent: boolean;
}) {
  const { play, removeFromPlaylist } = useMusicStore();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1000 : 0,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center rounded-md border text-sm",
        isCurrent ? "border-primary/50 bg-primary/10" : "border-transparent hover:bg-muted/50",
        isDragging && "ring-2 ring-primary/50",
      )}
      {...attributes}
    >
      <button
        type="button"
        className={cn(
          "p-2 text-muted-foreground hover:text-foreground",
          isDragging ? "cursor-grabbing" : "cursor-grab",
        )}
        {...listeners}
      >
        <GripVertical className="size-4" />
        <span className="sr-only">Drag to reorder</span>
      </button>
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 py-1 pr-1 text-left"
        onClick={() => play(item.id)}
        title={item.title}
      >
        <img
          src={getThumbnailUrl(item.id)}
          alt=""
          className="h-9 w-16 shrink-0 rounded object-cover"
          loading="lazy"
        />
        <span className="min-w-0 flex-1 truncate text-xs">
          {item.title || `Video ${index + 1}`}
        </span>
      </button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
        onClick={() => removeFromPlaylist(index)}
      >
        <Trash2 className="size-3.5" />
        <span className="sr-only">Remove</span>
      </Button>
    </li>
  );
}

export function PlaylistItems() {
  const { currentIndex, reorderPlaylist, getActivePlaylist } = useMusicStore();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const items = getActivePlaylist()?.items ?? [];

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = items.findIndex((item) => item.id === active.id);
    const toIndex = items.findIndex((item) => item.id === over.id);
    if (fromIndex >= 0 && toIndex >= 0) {
      reorderPlaylist(fromIndex, toIndex);
    }
  };

  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
        The playlist is empty. Add YouTube URLs above.
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <ul className="flex flex-col gap-1">
          {items.map((item, index) => (
            <SortableItem
              key={item.id}
              item={item}
              index={index}
              isCurrent={currentIndex === index}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
