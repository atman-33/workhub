import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  File,
  FileCode,
  FileText,
  Folder,
  FolderOpen,
} from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Hint } from "@/components/ui/hint";
import { api } from "@/lib/api";
import { toWindowsPath } from "@/lib/docs/markdown";
import { cn } from "@/lib/utils";
import type { DocsEntry } from "@/types";

/** What a tree row's context menu can do. Errors are reported by the tree. */
interface EntryActions {
  openExternal: (entry: DocsEntry) => void;
  reveal: (entry: DocsEntry) => void;
  copyPath: (entry: DocsEntry) => void;
}

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
  /** Told whether any folder listing is being fetched right now. */
  onBusyChange?: (busy: boolean) => void;
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
  onBusyChange,
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

  // How many listings are in flight. A count rather than a flag because a
  // refresh re-reads every open folder at once; the callback sits in a ref so
  // `ensureLoaded` can stay stable.
  const inFlight = useRef(0);
  const busyChange = useRef(onBusyChange);
  busyChange.current = onBusyChange;

  const ensureLoaded = useCallback((path: string, token: number) => {
    if (fetchedAt.current[path] === token) return;
    fetchedAt.current[path] = token;
    setDirs((prev) => ({ ...prev, [path]: { status: "loading" } }));
    if (inFlight.current++ === 0) busyChange.current?.(true);
    // A slow read answering after a newer one was started (a refresh, or the
    // folder picked again) must not paint its stale result over the fresh one.
    const current = () => fetchedAt.current[path] === token;
    api
      .docsListDir(path)
      .then((entries) => {
        if (current()) setDirs((prev) => ({ ...prev, [path]: { status: "ready", entries } }));
      })
      .catch((e) => {
        if (current()) {
          setDirs((prev) => ({ ...prev, [path]: { status: "error", message: String(e) } }));
        }
      })
      .finally(() => {
        if (--inFlight.current === 0) busyChange.current?.(false);
      });
  }, []);

  const toggle = useCallback((path: string) => {
    setOpen((prev) => ({ ...prev, [path]: !prev[path] }));
  }, []);

  const actions = useMemo<EntryActions>(
    () => ({
      openExternal: (entry) =>
        void api.docsOpenExternal(entry.path).catch((e) => onError(String(e))),
      reveal: (entry) => void api.docsReveal(entry.path).catch((e) => onError(String(e))),
      copyPath: (entry) =>
        void writeText(toWindowsPath(entry.path)).catch((e) => onError(String(e))),
    }),
    [onError],
  );

  const activate = useCallback(
    (entry: DocsEntry) => {
      if (isPreviewable(entry)) {
        onSelect(entry);
        return;
      }
      // Everything else is the share's own material — a PDF, a spreadsheet,
      // an image. The tab cannot render it, so the OS gets it.
      actions.openExternal(entry);
    },
    [onSelect, actions],
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
        actions={actions}
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
  actions,
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
  actions: EntryActions;
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
            <ContextMenu>
              <ContextMenuTrigger asChild>
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
              </ContextMenuTrigger>
              <EntryMenu entry={entry} actions={actions} />
            </ContextMenu>
            {open[entry.path] && (
              <DirListing
                path={entry.path}
                depth={depth + 1}
                dirs={dirs}
                open={open}
                ensureLoaded={ensureLoaded}
                onToggle={onToggle}
                onActivate={onActivate}
                actions={actions}
                selected={selected}
                filter={filter}
                refreshToken={refreshToken}
              />
            )}
          </div>
        ) : (
          <ContextMenu key={entry.path}>
            <Hint
              label={isPreviewable(entry) ? entry.name : `${entry.name} — opens outside workhub`}
            >
              <ContextMenuTrigger asChild>
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
                  ) : entry.is_html ? (
                    <FileCode className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <File className="size-3.5 shrink-0 text-muted-foreground/60" />
                  )}
                  <span
                    className={cn("truncate", !isPreviewable(entry) && "text-muted-foreground")}
                  >
                    {entry.name}
                  </span>
                </button>
              </ContextMenuTrigger>
            </Hint>
            <EntryMenu entry={entry} actions={actions} />
          </ContextMenu>
        ),
      )}
    </>
  );
}

/**
 * A row's right-click menu (T-0271).
 *
 * Ordered the way file managers order it: opening first, then showing where
 * it lives, then — after a separator — copying, which does nothing visible.
 * A folder has no "open with default app": expanding it is what a click on it
 * already does, and the backend refuses to hand a folder to the OS anyway.
 *
 * The preview is the default way into a file, not the only one: an HTML
 * report that needs its scripts, or a note someone wants in their own editor,
 * still goes to the OS from here.
 */
function EntryMenu({ entry, actions }: { entry: DocsEntry; actions: EntryActions }) {
  return (
    <ContextMenuContent>
      {!entry.is_dir && (
        <ContextMenuItem onSelect={() => actions.openExternal(entry)}>
          <ExternalLink />
          Open with default app
        </ContextMenuItem>
      )}
      <ContextMenuItem onSelect={() => actions.reveal(entry)}>
        <FolderOpen />
        Show in Explorer
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => actions.copyPath(entry)}>
        <Copy />
        Copy path
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

/** True for a file the preview pane renders itself rather than handing to the OS. */
function isPreviewable(entry: DocsEntry): boolean {
  return entry.is_markdown || entry.is_html;
}
