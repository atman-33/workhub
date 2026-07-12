import { useEffect, useRef, useState } from "react";
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
import { useMusicStore } from "@/stores/music";

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
  } = useMusicStore();
  const [renamingId, setRenamingId] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-1">
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
          <ContextMenu key={playlist.id}>
            <ContextMenuTrigger asChild>
              <button
                onClick={() => {
                  if (playlist.id !== activePlaylistId) setActivePlaylist(playlist.id);
                }}
                onDoubleClick={() => setRenamingId(playlist.id)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  playlist.id === activePlaylistId
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {playlist.name}
                <span className="ml-1.5 text-[10px] text-muted-foreground">
                  {playlist.items.length}
                </span>
              </button>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => setRenamingId(playlist.id)}>Rename</ContextMenuItem>
              <ContextMenuItem onSelect={() => clearPlaylist(playlist.id)}>
                Clear items
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                disabled={playlists.length <= 1}
                onSelect={() => removePlaylist(playlist.id)}
              >
                Delete playlist
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ),
      )}
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
    </div>
  );
}
