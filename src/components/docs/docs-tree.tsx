import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, File, FileText, Folder, FolderOpen } from "lucide-react";
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
  onError: (message: string) => void;
  /** Case-insensitive filter on file and folder names; "" shows everything. */
  filter: string;
  /**
   * Bumped by the toolbar's refresh button. Every cached listing is dropped
   * and re-fetched when it changes — the tab has no file watcher (a network
   * share is a bad thing to watch), so this is how a document added by a
   * colleague appears. **Which folders are open is deliberately kept**: a
   * refresh that collapsed the tree threw away the place you were reading.
   */
  refreshToken: number;
  /** Bumped by the toolbar's collapse button; closes every open folder. */
  collapseToken: number;
}

/**
 * The folder tree, loaded one directory at a time.
 *
 * Nothing is walked recursively: a folder's contents are fetched when it is
 * opened and cached until the next refresh. On a Google Drive share that is
 * the difference between a tab that opens instantly and one that stalls
 * pulling down a tree nobody asked to see.
 *
 * Each rendered level asks for its own listing rather than being fed one by
 * the level above, and remembers which refresh it was fetched under. That is
 * what lets a refresh keep the tree expanded: the token changes, and every
 * level still on screen re-fetches itself where it stands.
 */
export function DocsTree({
  rootPath,
  selected,
  onSelect,
  onError,
  filter,
  refreshToken,
  collapseToken,
}: Props) {
  const [dirs, setDirs] = useState<Record<string, DirState>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // Which refresh each folder was last fetched under. A ref rather than state
  // because the claim has to be synchronous: two levels mounting in the same
  // tick would both see an unclaimed folder if this went through setState,
  // and both would hit the share for it.
  const fetchedAt = useRef<Record<string, number>>({});

  // A different root is a different tree. A refresh is *not* — it re-reads the
  // same tree, and collapsing it would throw away the place you were reading.
  useEffect(() => {
    setOpen({});
  }, [rootPath]);

  useEffect(() => {
    if (collapseToken > 0) setOpen({});
  }, [collapseToken]);

  const ensureLoaded = useCallback((path: string, token: number) => {
    if (fetchedAt.current[path] === token) return;
    fetchedAt.current[path] = token;
    setDirs((prev) => ({ ...prev, [path]: { status: "loading" } }));
    api
      .docsListDir(path)
      .then((entries) => setDirs((prev) => ({ ...prev, [path]: { status: "ready", entries } })))
      .catch((e) =>
        setDirs((prev) => ({ ...prev, [path]: { status: "error", message: String(e) } })),
      );
  }, []);

  const toggle = useCallback((path: string) => {
    setOpen((prev) => ({ ...prev, [path]: !prev[path] }));
  }, []);

  const activate = useCallback(
    (entry: DocsEntry) => {
      if (entry.is_markdown) {
        onSelect(entry);
        return;
      }
      // Everything else is the share's own material — a PDF, a spreadsheet,
      // an image. The tab cannot render it, so the OS gets it.
      void api.docsOpenExternal(entry.path).catch((e) => onError(String(e)));
    },
    [onSelect, onError],
  );

  if (!rootPath) return null;

  return (
    <div className="py-1 text-xs">
      <DirListing
        path={rootPath}
        depth={0}
        dirs={dirs}
        open={open}
        ensureLoaded={ensureLoaded}
        onToggle={toggle}
        onActivate={activate}
        selected={selected}
        filter={filter.trim().toLowerCase()}
        refreshToken={refreshToken}
      />
    </div>
  );
}

function DirListing({
  path,
  depth,
  dirs,
  open,
  ensureLoaded,
  onToggle,
  onActivate,
  selected,
  filter,
  refreshToken,
}: {
  path: string;
  depth: number;
  dirs: Record<string, DirState>;
  open: Record<string, boolean>;
  ensureLoaded: (path: string, token: number) => void;
  onToggle: (path: string) => void;
  onActivate: (entry: DocsEntry) => void;
  selected: string;
  filter: string;
  refreshToken: number;
}) {
  // Every level on screen asks for its own listing, including after a refresh
  // has emptied the cache underneath it.
  useEffect(() => {
    ensureLoaded(path, refreshToken);
  }, [path, refreshToken, ensureLoaded]);

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
        {filter ? "Nothing matching here." : "This folder is empty."}
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
                ensureLoaded={ensureLoaded}
                onToggle={onToggle}
                onActivate={onActivate}
                selected={selected}
                filter={filter}
                refreshToken={refreshToken}
              />
            )}
          </div>
        ) : (
          <Hint
            key={entry.path}
            label={entry.is_markdown ? entry.name : `${entry.name} — opens outside workhub`}
          >
            <button
              type="button"
              onClick={() => onActivate(entry)}
              style={{ paddingLeft: `${depth * 12 + 24}px` }}
              className={cn(
                "flex w-full items-center gap-1 py-1 pr-2 text-left transition-colors",
                entry.path === selected ? "bg-muted font-medium" : "hover:bg-muted/50",
              )}
            >
              {entry.is_markdown ? (
                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <File className="size-3.5 shrink-0 text-muted-foreground/60" />
              )}
              <span className={cn("truncate", !entry.is_markdown && "text-muted-foreground")}>
                {entry.name}
              </span>
            </button>
          </Hint>
        ),
      )}
    </>
  );
}
