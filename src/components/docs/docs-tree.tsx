import { useCallback, useEffect, useMemo, useRef } from "react";
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
  Star,
  StarOff,
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
import { type DirState, entryRows, flattenTree, navigate, type Row } from "@/lib/docs/tree-nav";
import { cn } from "@/lib/utils";
import type { DocsEntry } from "@/types";

/** What a tree row's context menu can do. Errors are reported by the tree. */
export interface EntryActions {
  openExternal: (entry: DocsEntry) => void;
  reveal: (entry: DocsEntry) => void;
  copyPath: (entry: DocsEntry) => void;
  /** Stars or unstars the row — the Shortcuts section above the tree. */
  toggleShortcut: (entry: DocsEntry) => void;
  /** Whether the row is starred right now. */
  isShortcut: (path: string) => boolean;
}

interface Props {
  /** Path of the root being browsed. */
  rootPath: string;
  /** Path of the document currently open in the preview. */
  selected: string;
  /** Path of the folder the file-list pane is showing, in split mode. */
  selectedDir?: string;
  onSelect: (entry: DocsEntry) => void;
  /** Called when a folder is picked in folders-only mode. */
  onSelectDir?: (path: string) => void;
  /** Case-insensitive filter on file names; "" shows everything. */
  filter: string;
  /**
   * Hide files, leaving folders only — the shape the sidebar takes when the
   * file-list pane is on (T-0276). A folder row then *selects* the folder and
   * the chevron is what expands it; with files in the tree there is nothing to
   * select, so the whole row toggles instead.
   */
  foldersOnly?: boolean;
  /** Every cached listing; see `useDocsDirs`. */
  dirs: Record<string, DirState>;
  /** Reports the folders this render needs listings for. */
  onNeededChange: (paths: string[]) => void;
  open: Record<string, boolean>;
  onOpenChange: (next: Record<string, boolean>) => void;
  /** The row the arrow keys are on. Lifted so a shortcut can move it. */
  cursor: string;
  onCursorChange: (path: string) => void;
  actions: EntryActions;
}

/**
 * The folder tree, loaded one directory at a time and rendered as a flat list.
 *
 * Flat because the arrow keys need a flat order (T-0276): `flattenTree` in
 * `@/lib/docs/tree-nav` turns the open folders into the rows on screen, and
 * `navigate` decides what each key does to the cursor. The recursive version
 * this replaces had no single place where "what is below this row" could be
 * answered — and no place to test it, either.
 *
 * Which listings to fetch is reported upward rather than fetched here: the
 * file-list pane reads the same cache, and one folder must not be pulled off a
 * Drive share twice.
 */
export function DocsTree({
  rootPath,
  selected,
  selectedDir,
  onSelect,
  onSelectDir,
  filter,
  foldersOnly = false,
  dirs,
  onNeededChange,
  open,
  onOpenChange,
  cursor,
  onCursorChange,
  actions,
}: Props) {
  const scroller = useRef<HTMLDivElement>(null);

  const { rows, needed } = useMemo(
    () =>
      flattenTree({
        rootPath,
        dirs,
        open,
        filter: filter.trim().toLowerCase(),
        foldersOnly,
      }),
    [rootPath, dirs, open, filter, foldersOnly],
  );

  // The array's identity changes every render; its contents do not. Keying on
  // the joined paths is what stops the effect firing forever.
  const neededKey = needed.join("\n");
  useEffect(() => {
    onNeededChange(neededKey ? neededKey.split("\n") : []);
  }, [neededKey, onNeededChange]);

  const toggle = useCallback(
    (path: string) => onOpenChange({ ...open, [path]: !open[path] }),
    [open, onOpenChange],
  );

  const activate = useCallback(
    (entry: DocsEntry) => {
      onCursorChange(entry.path);
      if (entry.is_dir) {
        if (foldersOnly) onSelectDir?.(entry.path);
        else toggle(entry.path);
        return;
      }
      if (entry.is_markdown || entry.is_html) {
        onSelect(entry);
        return;
      }
      // Everything else is the share's own material — a PDF, a spreadsheet,
      // an image. The tab cannot render it, so the OS gets it.
      actions.openExternal(entry);
    },
    [onSelect, onSelectDir, onCursorChange, actions, foldersOnly, toggle],
  );

  // Keep the cursor visible when a key moved it rather than a click.
  useEffect(() => {
    if (!cursor) return;
    const el = scroller.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(cursor)}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor, rows]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      const row = entryRows(rows).find((r) => r.entry.path === cursor);
      if (!row) return;
      e.preventDefault();
      activate(row.entry);
      return;
    }
    if (
      e.key !== "ArrowDown" &&
      e.key !== "ArrowUp" &&
      e.key !== "ArrowRight" &&
      e.key !== "ArrowLeft" &&
      e.key !== "Home" &&
      e.key !== "End"
    ) {
      return;
    }
    e.preventDefault();
    const action = navigate(e.key, rows, cursor, open);
    switch (action.type) {
      case "move":
        onCursorChange(action.path);
        break;
      case "open":
        onOpenChange({ ...open, [action.path]: true });
        break;
      case "close":
        onOpenChange({ ...open, [action.path]: false });
        break;
      case "none":
        break;
    }
  };

  if (!rootPath) return null;

  return (
    <div
      ref={scroller}
      // One tab stop for the whole tree, with the arrows moving inside it —
      // the pattern a tree widget is supposed to use, and the only way Up/Down
      // can mean "previous/next row" rather than "scroll".
      tabIndex={0}
      role="tree"
      aria-label="Documents"
      onKeyDown={onKeyDown}
      className="min-h-0 flex-1 overflow-auto py-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
    >
      {rows.map((row) =>
        row.kind === "message" ? (
          <div
            key={row.key}
            style={{ paddingLeft: `${row.depth * 12 + 8}px` }}
            className={cn(
              "py-1",
              row.tone === "error" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {row.text}
          </div>
        ) : (
          <TreeRow
            key={row.entry.path}
            row={row}
            open={!!open[row.entry.path]}
            selected={
              row.entry.is_dir ? row.entry.path === selectedDir : row.entry.path === selected
            }
            cursored={row.entry.path === cursor}
            foldersOnly={foldersOnly}
            onToggle={toggle}
            onActivate={activate}
            actions={actions}
          />
        ),
      )}
    </div>
  );
}

function TreeRow({
  row,
  open,
  selected,
  cursored,
  foldersOnly,
  onToggle,
  onActivate,
  actions,
}: {
  row: Extract<Row, { kind: "entry" }>;
  open: boolean;
  selected: boolean;
  cursored: boolean;
  foldersOnly: boolean;
  onToggle: (path: string) => void;
  onActivate: (entry: DocsEntry) => void;
  actions: EntryActions;
}) {
  const { entry, depth } = row;
  const previewable = entry.is_markdown || entry.is_html;
  const starred = actions.isShortcut(entry.path);

  const rowClass = cn(
    "flex w-full items-center gap-1 py-1 pr-2 text-left transition-colors",
    selected ? "bg-muted font-medium" : "hover:bg-muted/50",
    // The cursor is not the selection: it says where the keys are, which on a
    // freshly focused tree is usually not what the preview has open.
    cursored && "ring-1 ring-inset ring-primary/50",
  );

  if (entry.is_dir) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            data-path={entry.path}
            className={rowClass}
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
          >
            {/* The chevron is its own target: in folders-only mode the row
                selects the folder, so expanding has to be a separate intent. */}
            <button
              type="button"
              aria-label={open ? "Collapse" : "Expand"}
              className="shrink-0 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onToggle(entry.path);
              }}
            >
              {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            </button>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1 text-left"
              onClick={() => (foldersOnly ? onActivate(entry) : onToggle(entry.path))}
            >
              {open ? (
                <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <Folder className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{entry.name}</span>
              {starred && <Star className="size-3 shrink-0 fill-current text-amber-500" />}
            </button>
          </div>
        </ContextMenuTrigger>
        <EntryMenu entry={entry} actions={actions} starred={starred} />
      </ContextMenu>
    );
  }

  return (
    <ContextMenu>
      <Hint label={previewable ? entry.name : `${entry.name} — opens outside workhub`}>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            data-path={entry.path}
            onClick={() => onActivate(entry)}
            style={{ paddingLeft: `${depth * 12 + 24}px` }}
            className={rowClass}
          >
            {entry.is_markdown ? (
              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
            ) : entry.is_html ? (
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
      <EntryMenu entry={entry} actions={actions} starred={starred} />
    </ContextMenu>
  );
}

/**
 * A row's right-click menu (T-0271).
 *
 * Ordered the way file managers order it: opening first, then showing where it
 * lives, then — after a separator — the two that do nothing visible, starring
 * and copying. A folder has no "open with default app": expanding it is what a
 * click on it already does, and the backend refuses to hand a folder to the OS
 * anyway.
 *
 * The preview is the default way into a file, not the only one: an HTML report
 * that needs its scripts, or a note someone wants in their own editor, still
 * goes to the OS from here.
 */
function EntryMenu({
  entry,
  actions,
  starred,
}: {
  entry: DocsEntry;
  actions: EntryActions;
  starred: boolean;
}) {
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
      <ContextMenuItem onSelect={() => actions.toggleShortcut(entry)}>
        {starred ? <StarOff /> : <Star />}
        {starred ? "Remove from shortcuts" : "Add to shortcuts"}
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => actions.copyPath(entry)}>
        <Copy />
        Copy path
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

/** The row actions, built once per view and shared with the shortcut list. */
export function useEntryActions(
  onError: (message: string) => void,
  toggleShortcut: (entry: DocsEntry) => void,
  isShortcut: (path: string) => boolean,
): EntryActions {
  return useMemo(
    () => ({
      openExternal: (entry: DocsEntry) =>
        void api.docsOpenExternal(entry.path).catch((e) => onError(String(e))),
      reveal: (entry: DocsEntry) => void api.docsReveal(entry.path).catch((e) => onError(String(e))),
      copyPath: (entry: DocsEntry) =>
        void writeText(toWindowsPath(entry.path)).catch((e) => onError(String(e))),
      toggleShortcut,
      isShortcut,
    }),
    [onError, toggleShortcut, isShortcut],
  );
}
