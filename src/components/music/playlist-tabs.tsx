import { useEffect, useRef, useState } from "react";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import { horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Playlist } from "@/lib/music/types";
import { useMusicStore } from "@/stores/music";
import { PlaylistTransferMenu } from "./playlist-transfer-menu";

function TabRenameInput({
  initialName,
  onCommit,
}: {
  initialName: string;
  onCommit: (name: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const commit = () => onCommit(name.trim() || initialName);

  return (
    <input
      ref={inputRef}
      value={name}
      onChange={(e) => setName(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") onCommit(initialName);
      }}
      className="h-6 w-24 rounded border border-input bg-background px-1 text-xs outline-none"
    />
  );
}

function SortablePlaylistTab({
  playlist,
  isActive,
  canDelete,
  onSelect,
  onStartRename,
  onClear,
  onDelete,
}: {
  playlist: Playlist;
  isActive: boolean;
  canDelete: boolean;
  onSelect: () => void;
  onStartRename: () => void;
  onClear: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: playlist.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1000 : 0,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          ref={setNodeRef}
          style={style}
          onClick={onSelect}
          onDoubleClick={onStartRename}
          className={cn(
            "touch-none rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            isDragging ? "cursor-grabbing" : "cursor-grab",
            isActive
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          {...attributes}
          {...listeners}
        >
          {playlist.name}
          <span className="ml-1.5 text-[10px] text-muted-foreground">{playlist.items.length}</span>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onStartRename}>Rename</ContextMenuItem>
        <ContextMenuItem onSelect={onClear}>Clear items</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" disabled={!canDelete} onSelect={onDelete}>
          Delete playlist
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function PlaylistTabs() {
  const {
    playlists,
    activePlaylistId,
    canCreatePlaylist,
    setActivePlaylist,
    createPlaylist,
    renamePlaylist,
    removePlaylist,
    clearPlaylist,
    reorderPlaylists,
  } = useMusicStore();
  const [renamingId, setRenamingId] = useState<string | null>(null);

  // A small distance threshold keeps plain clicks (select) and double-clicks
  // (rename) working on tabs that are themselves the drag handle.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = playlists.findIndex((playlist) => playlist.id === active.id);
    const toIndex = playlists.findIndex((playlist) => playlist.id === over.id);
    if (fromIndex >= 0 && toIndex >= 0) {
      reorderPlaylists(fromIndex, toIndex);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToHorizontalAxis]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={playlists.map((playlist) => playlist.id)}
          strategy={horizontalListSortingStrategy}
        >
          {playlists.map((playlist) =>
            renamingId === playlist.id ? (
              <TabRenameInput
                key={playlist.id}
                initialName={playlist.name}
                onCommit={(name) => {
                  renamePlaylist(playlist.id, name);
                  setRenamingId(null);
                }}
              />
            ) : (
              <SortablePlaylistTab
                key={playlist.id}
                playlist={playlist}
                isActive={playlist.id === activePlaylistId}
                canDelete={playlists.length > 1}
                onSelect={() => {
                  if (playlist.id !== activePlaylistId) setActivePlaylist(playlist.id);
                }}
                onStartRename={() => setRenamingId(playlist.id)}
                onClear={() => clearPlaylist(playlist.id)}
                onDelete={() => removePlaylist(playlist.id)}
              />
            ),
          )}
        </SortableContext>
      </DndContext>
      <Button
        variant="ghost"
        size="icon"
        className="size-6"
        disabled={!canCreatePlaylist}
        onClick={() => createPlaylist()}
        title="New playlist"
      >
        <Plus className="size-3.5" />
      </Button>
      <div className="ml-auto">
        <PlaylistTransferMenu />
      </div>
    </div>
  );
}
