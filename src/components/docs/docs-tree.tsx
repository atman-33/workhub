import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen } from "lucide-react";
import { Hint } from "@/components/ui/hint";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { DocsEntry } from "@/types";

/** What one folder's listing is doing, keyed by that folder's path. */
type DirState =
  | { status: "loading" }
  | { status: "ready"; entries: DocsEntry[] }
  | { status: "error"; message: string };

interface Props {
  /** Path of the root being browsed. */
  rootPath: string;
  /** Path of the document currently open in the preview. */
  selected: string;
  onSelect: (entry: DocsEntry) => void;
  /** Case-insensitive filter on file and folder names; "" shows everything. */
  filter: string;
  /**
   * Bumped by the toolbar's refresh button. Every cached listing is dropped
   * when it changes — the tab has no file watcher (a network share is a bad
   * thing to watch), so this is how a document added by a colleague appears.
   */
  refreshToken: number;
}

/**
 * The folder tree, loaded one directory at a time.
 *
 * Nothing is walked recursively: a folder's contents are fetched when it is
 * opened and cached until the next refresh. On a Google Drive share that is
 * the difference between a tab that opens instantly and one that stalls
 * pulling down a tree nobody asked to see.
 */
export function DocsTree({ rootPath, selected, onSelect, filter, refreshToken }: Props) {
  const [dirs, setDirs] = useState<Record<string, DirState>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});

  // A new root, or a refresh, invalidates every cached listing.
  useEffect(() => {
    setDirs({});
    setOpen({});
  }, [rootPath, refreshToken]);

  const load = useCallback(async (path: string) => {
    setDirs((prev) => ({ ...prev, [path]: { status: "loading" } }));
    try {
      const entries = await api.docsListDir(path);
      setDirs((prev) => ({ ...prev, [path]: { status: "ready", entries } }));
    } catch (e) {
      setDirs((prev) => ({ ...prev, [path]: { status: "error", message: String(e) } }));
    }
  }, []);

  // The root itself is always listed; everything below it waits to be opened.
  useEffect(() => {
    if (rootPath) void load(rootPath);
  }, [rootPath, refreshToken, load]);

  const toggle = (path: string) => {
    const nowOpen = !open[path];
    setOpen((prev) => ({ ...prev, [path]: nowOpen }));
    if (nowOpen && !dirs[path]) void load(path);
  };

  if (!rootPath) return null;

  return (
    <div className="py-1 text-xs">
      <DirListing
        path={rootPath}
        depth={0}
        dirs={dirs}
        open={open}
        onToggle={toggle}
        onSelect={onSelect}
        selected={selected}
        filter={filter.trim().toLowerCase()}
      />
    </div>
  );
}

function DirListing({
  path,
  depth,
  dirs,
  open,
  onToggle,
  onSelect,
  selected,
  filter,
}: {
  path: string;
  depth: number;
  dirs: Record<string, DirState>;
  open: Record<string, boolean>;
  onToggle: (path: string) => void;
  onSelect: (entry: DocsEntry) => void;
  selected: string;
  filter: string;
}) {
  const state = dirs[path];
  const indent = { paddingLeft: `${depth * 12 + 8}px` };

  if (!state || state.status === "loading") {
    return (
      <div style={indent} className="py-1 text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div style={indent} className="py-1 text-destructive">
        {state.message}
      </div>
    );
  }

  // Folders are never filtered out: a match may be inside one, and this tree
  // only knows what has been opened. Filtering files is enough to make a
  // long folder usable without pretending to search the whole share.
  const entries = filter
    ? state.entries.filter((e) => e.is_dir || e.name.toLowerCase().includes(filter))
    : state.entries;

  if (entries.length === 0) {
    return (
      <div style={indent} className="py-1 text-muted-foreground">
        {filter ? "No matching documents here." : "No documents here."}
      </div>
    );
  }

  return (
    <>
      {entries.map((entry) =>
        entry.is_dir ? (
          <div key={entry.path}>
            <button
              type="button"
              onClick={() => onToggle(entry.path)}
              style={indent}
              className="flex w-full items-center gap-1 py-1 pr-2 text-left hover:bg-muted/50"
            >
              {open[entry.path] ? (
                <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
              )}
              {open[entry.path] ? (
                <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <Folder className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{entry.name}</span>
            </button>
            {open[entry.path] && (
              <DirListing
                path={entry.path}
                depth={depth + 1}
                dirs={dirs}
                open={open}
                onToggle={onToggle}
                onSelect={onSelect}
                selected={selected}
                filter={filter}
              />
            )}
          </div>
        ) : (
          <Hint key={entry.path} label={entry.name}>
            <button
              type="button"
              onClick={() => onSelect(entry)}
              style={{ paddingLeft: `${depth * 12 + 24}px` }}
              className={cn(
                "flex w-full items-center gap-1 py-1 pr-2 text-left transition-colors",
                entry.path === selected ? "bg-muted font-medium" : "hover:bg-muted/50",
              )}
            >
              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{entry.name.replace(/\.(md|markdown)$/i, "")}</span>
            </button>
          </Hint>
        ),
      )}
    </>
  );
}
