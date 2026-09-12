import { useEffect, useMemo, useRef } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Copy, ExternalLink, File, FileCode, FileText, FolderOpen, Star, StarOff } from "lucide-react";
import { Hint } from "@/components/ui/hint";
import type { EntryActions } from "@/components/docs/docs-tree";
import { isPreviewable } from "@/lib/docs/preview-kind";
import { baseName, type DirState } from "@/lib/docs/tree-nav";
import { cn } from "@/lib/utils";
import type { DocsEntry } from "@/types";

/**
 * The second sidebar (T-0276): the files directly inside the folder picked in
 * the tree, the way Obsidian's Notebook Navigator lays a vault out.
 *
 * It reads the same directory cache the tree does, so picking a folder that is
 * already expanded costs no second read of the share. Only files are listed —
 * sub-folders stay in the tree, which is the point of splitting the two.
 *
 * The arrow keys move a cursor and `Enter` opens, exactly as in the tree: on a
 * network share, reading a document on every keypress makes the list unusable.
 */
export function DocsFileList({
  dir,
  dirs,
  selected,
  cursor,
  onCursorChange,
  onSelect,
  filter,
  actions,
}: {
  /** The folder being listed; "" before one is picked. */
  dir: string;
  dirs: Record<string, DirState>;
  selected: string;
  cursor: string;
  onCursorChange: (path: string) => void;
  onSelect: (entry: DocsEntry) => void;
  filter: string;
  actions: EntryActions;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const state = dir ? dirs[dir] : undefined;

  const files = useMemo(() => {
    if (!state || state.status !== "ready") return [];
    const needle = filter.trim().toLowerCase();
    return state.entries.filter(
      (e) => !e.is_dir && (!needle || e.name.toLowerCase().includes(needle)),
    );
  }, [state, filter]);

  useEffect(() => {
    if (!cursor) return;
    const el = scroller.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(cursor)}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor, files]);

  const activate = (entry: DocsEntry) => {
    onCursorChange(entry.path);
    if (isPreviewable(entry)) onSelect(entry);
    else actions.openExternal(entry);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (files.length === 0) return;
    const at = files.findIndex((f) => f.path === cursor);
    if (e.key === "Enter" || e.key === " ") {
      if (at < 0) return;
      e.preventDefault();
      activate(files[at]);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      onCursorChange(files[at < 0 ? 0 : Math.min(at + 1, files.length - 1)].path);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      onCursorChange(files[at < 0 ? files.length - 1 : Math.max(at - 1, 0)].path);
    } else if (e.key === "Home") {
      e.preventDefault();
      onCursorChange(files[0].path);
    } else if (e.key === "End") {
      e.preventDefault();
      onCursorChange(files[files.length - 1].path);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="truncate border-b px-2 py-1.5 text-[11px] text-muted-foreground">
        {dir ? baseName(dir) : "No folder selected"}
      </div>
      <div
        ref={scroller}
        tabIndex={0}
        role="listbox"
        aria-label="Files in the selected folder"
        onKeyDown={onKeyDown}
        className="min-h-0 flex-1 overflow-auto py-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
      >
        {!dir ? (
          <p className="px-2 py-1 leading-relaxed text-muted-foreground">
            Pick a folder in the tree to list what is in it.
          </p>
        ) : !state || state.status === "loading" ? (
          <div className="px-2 py-1 text-muted-foreground">Loading…</div>
        ) : state.status === "error" ? (
          <div className="px-2 py-1 text-destructive">{state.message}</div>
        ) : files.length === 0 ? (
          <div className="px-2 py-1 text-muted-foreground">
            {filter.trim() ? "Nothing matching here." : "No files in this folder."}
          </div>
        ) : (
          files.map((entry) => (
            <FileRow
              key={entry.path}
              entry={entry}
              selected={entry.path === selected}
              cursored={entry.path === cursor}
              onActivate={activate}
              actions={actions}
            />
          ))
        )}
      </div>
    </div>
  );
}

function FileRow({
  entry,
  selected,
  cursored,
  onActivate,
  actions,
}: {
  entry: DocsEntry;
  selected: boolean;
  cursored: boolean;
  onActivate: (entry: DocsEntry) => void;
  actions: EntryActions;
}) {
  const previewable = isPreviewable(entry);
  const starred = actions.isShortcut(entry.path);
  return (
    <ContextMenu>
      <Hint label={previewable ? entry.name : `${entry.name} — opens outside workhub`}>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            data-path={entry.path}
            onClick={() => onActivate(entry)}
            className={cn(
              "flex w-full items-center gap-1 px-2 py-1 text-left transition-colors",
              selected ? "bg-muted font-medium" : "hover:bg-muted/50",
              cursored && "ring-1 ring-inset ring-primary/50",
            )}
          >
            {entry.is_markdown ? (
              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
            ) : entry.is_html || entry.is_text ? (
              <FileCode className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <File className="size-3.5 shrink-0 text-muted-foreground/60" />
            )}
            <span className={cn("truncate", !previewable && "text-muted-foreground")}>
              {entry.name}
            </span>
            {starred && <Star className="size-3 shrink-0 fill-current text-amber-500" />}
          </button>
        </ContextMenuTrigger>
      </Hint>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => actions.openExternal(entry)}>
          <ExternalLink />
          Open with default app
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => actions.reveal(entry)}>
          <FolderOpen />
          Show in Explorer
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => actions.toggleShortcut(entry)}>
          {starred ? <StarOff /> : <Star />}
          {starred ? "Remove from shortcuts" : "Add to shortcuts"}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => actions.copyPath(entry)}>
          <Copy />
          Copy path
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
