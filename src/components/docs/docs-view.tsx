import { useCallback, useEffect, useMemo, useState } from "react";
import { useDefaultLayout } from "react-resizable-panels";
import { ChevronsDownUp, RefreshCw, Search } from "lucide-react";
import { DocsFileList } from "@/components/docs/docs-file-list";
import { DocsPreview } from "@/components/docs/docs-preview";
import { DocsRootsBar } from "@/components/docs/docs-roots-bar";
import { DocsSettingsDialog } from "@/components/docs/docs-settings-dialog";
import { RecentSection, ShortcutsSection } from "@/components/docs/docs-sidebar-sections";
import { DocsTree, useEntryActions } from "@/components/docs/docs-tree";
import { useDocsDirs } from "@/components/docs/use-docs-dirs";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { api } from "@/lib/api";
import { clearRecent, pushRecent, readRecent, removeRecent } from "@/lib/docs/recent";
import { reorderWithinRoot, shortcutsInRoot } from "@/lib/docs/shortcuts";
import { ancestorsWithin, baseName, parentPath } from "@/lib/docs/tree-nav";
import { cn } from "@/lib/utils";
import type { DocsEntry, DocsRootStatus, DocsShortcut } from "@/types";

/** localStorage keys — machine-local UI state, like the other views' (view-state.ts). */
const LAST_ROOT = "docs.lastRoot";
const LAST_DOC = "docs.lastDoc";

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable — restoring the last document is a convenience
  }
}

function recall(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

/**
 * The Docs tab (T-0259): read-only browsing of Markdown on a folder the team
 * shares — a Google Drive network drive, typically.
 *
 * Obsidian could open such a folder, but doing so writes `.obsidian/` into it
 * and every member's workspace state then collides. This tab reads and never
 * writes: there is no save path here, and the backend exposes no command that
 * could create one.
 *
 * The sidebar follows Obsidian's Notebook Navigator (T-0276): curated
 * shortcuts and a recent-files list above the folder tree, and — when the
 * setting is on — the tree's files moved into a second pane beside it.
 *
 * The tree's expansion, the keyboard cursor and the selected folder all live
 * here rather than inside `DocsTree`, because a shortcut has to be able to
 * open the tree down to what it points at.
 */
/** Shortest time the refresh button spins, so a fast re-read is still visible. */
const MIN_SPIN_MS = 600;

export function DocsView() {
  const [roots, setRoots] = useState<DocsRootStatus[]>([]);
  const [rootId, setRootId] = useState("");
  const [doc, setDoc] = useState("");
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  // Bumped by the refresh button. There is no file watcher — watching a
  // network share is unreliable and expensive — so this is how a colleague's
  // new document shows up. It re-reads the tree without collapsing it.
  const [refreshToken, setRefreshToken] = useState(0);
  // The refresh button spins from the click until the tree and the open
  // document have both been re-read — on a streamed Drive share that can take
  // seconds, and a button that gives no sign it did anything gets clicked
  // again. It spins for at least `MIN_SPIN_MS` so a fast local folder still
  // shows the click registered.
  const [treeBusy, setTreeBusy] = useState(false);
  const [docBusy, setDocBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [minSpinDone, setMinSpinDone] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [cursor, setCursor] = useState("");
  const [selectedDir, setSelectedDir] = useState("");
  const [shortcuts, setShortcuts] = useState<DocsShortcut[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [listPane, setListPane] = useState(false);

  // The tree / preview split survives a restart (T-0279), like the Repos
  // tab's panels; the sidebar's own split does too (T-0276).
  const splitLayout = useDefaultLayout({ id: "docs-split", storage: localStorage });
  const sidebarLayout = useDefaultLayout({ id: "docs-sidebar-split", storage: localStorage });

  const busyChange = useCallback((busy: boolean) => setTreeBusy(busy), []);
  const { dirs, ensureLoaded } = useDocsDirs(busyChange);

  // The folders the tree is drawing, plus the one the file list is showing —
  // usually one the tree already asked for, which is why both read the same
  // cache instead of fetching their own.
  const [neededDirs, setNeededDirs] = useState<string[]>([]);
  const onNeededChange = useCallback((paths: string[]) => setNeededDirs(paths), []);
  const neededKey = useMemo(
    // Only the split layout has a selected folder; in one-tree mode there is
    // nothing extra to read off the share.
    () => [...neededDirs, listPane ? selectedDir : ""].filter(Boolean).join("\n"),
    [neededDirs, selectedDir, listPane],
  );
  useEffect(() => {
    for (const path of neededKey ? neededKey.split("\n") : []) ensureLoaded(path, refreshToken);
  }, [neededKey, ensureLoaded, refreshToken]);

  useEffect(() => {
    if (refreshing && minSpinDone && !treeBusy && !docBusy) setRefreshing(false);
  }, [refreshing, minSpinDone, treeBusy, docBusy]);

  const refresh = useCallback(() => {
    setRefreshToken((n) => n + 1);
    setError("");
    setRefreshing(true);
    setMinSpinDone(false);
    setTimeout(() => setMinSpinDone(true), MIN_SPIN_MS);
  }, []);

  // Whether a root is reachable is decided by the backend when the list is
  // read, so a share that was offline at startup stayed "not reachable" until
  // the app restarted (T-0279). Re-reading the list is what re-asks.
  const recheckRoots = useCallback(async () => {
    try {
      setRoots(await api.docsRoots());
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const loadDocsSettings = useCallback(async () => {
    try {
      const [list, pane] = await Promise.all([api.docsShortcuts(), api.docsListPane()]);
      setShortcuts(list);
      setListPane(pane);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void loadDocsSettings();
  }, [loadDocsSettings]);

  useEffect(() => {
    void (async () => {
      try {
        const list = await api.docsRoots();
        setRoots(list);
        const remembered = recall(LAST_ROOT);
        const initial = list.find((r) => r.id === remembered) ?? list[0];
        if (initial) {
          setRootId(initial.id);
          setRecent(readRecent(initial.id));
          // Only restore the document when it belongs to the root being
          // restored; otherwise the preview would open a file the tree has
          // no way to show.
          const lastDoc = recall(LAST_DOC);
          if (lastDoc.startsWith(initial.path)) {
            setDoc(lastDoc);
            setSelectedDir(parentPath(lastDoc));
          }
        }
      } catch (e) {
        setError(String(e));
      }
    })();
  }, []);

  // Picking a folder reads it afresh (T-0279): its reachability, its tree, and
  // nothing left over from the last attempt. A folder whose read failed once
  // used to show that failure until the app restarted — its listing was
  // cached under the same refresh, and the error banner never cleared.
  const selectRoot = useCallback(
    (id: string) => {
      setRootId(id);
      setDoc("");
      setSelectedDir("");
      setCursor("");
      // A different root is a different tree. A refresh is *not* — it re-reads
      // the same one, and collapsing it would throw away the place you were
      // reading.
      setOpen({});
      setRecent(readRecent(id));
      remember(LAST_ROOT, id);
      remember(LAST_DOC, "");
      refresh();
      void recheckRoots();
    },
    [refresh, recheckRoots],
  );

  const onRootsChanged = useCallback(
    (list: DocsRootStatus[]) => {
      setRoots(list);
      // A removed root leaves the selection dangling; a newly added one is
      // what the user is about to look at.
      if (!list.some((r) => r.id === rootId)) {
        const next = list[list.length - 1];
        if (next) selectRoot(next.id);
        else {
          setRootId("");
          setDoc("");
        }
      }
    },
    [rootId, selectRoot],
  );

  const selected = roots.find((r) => r.id === rootId);

  // With the file list on, the root's own files would otherwise be
  // unreachable: the tree lists a root's children, so the root itself has no
  // row to select. Start on it.
  useEffect(() => {
    if (listPane && !selectedDir && selected?.path) setSelectedDir(selected.path);
  }, [listPane, selectedDir, selected?.path]);

  /** Opens a document in the preview and records it as recently read. */
  const openDoc = useCallback(
    (path: string) => {
      setDoc(path);
      setCursor(path);
      remember(LAST_DOC, path);
      if (rootId) setRecent(pushRecent(rootId, path));
    },
    [rootId],
  );

  const onSelectEntry = useCallback((entry: DocsEntry) => openDoc(entry.path), [openDoc]);

  const saveShortcuts = useCallback(
    (next: DocsShortcut[]) => {
      setShortcuts(next);
      void api.setDocsShortcuts(next).catch((e) => {
        setError(String(e));
        // Put the stored list back on screen rather than leaving a star that
        // did not survive the save.
        void loadDocsSettings();
      });
    },
    [loadDocsSettings],
  );

  const isShortcut = useCallback(
    (path: string) => shortcuts.some((s) => s.path === path),
    [shortcuts],
  );

  // Only the picked root's shortcuts are listed (T-0296). One stored list, a
  // root at a time on screen: a path means nothing outside the root it belongs
  // to, and a row that cannot be revealed in the tree only half works. The
  // star itself still reads the whole list — a file is starred or it is not.
  const visibleShortcuts = useMemo(
    () => shortcutsInRoot(shortcuts, selected?.path ?? ""),
    [shortcuts, selected],
  );

  const toggleShortcut = useCallback(
    (entry: DocsEntry) => {
      saveShortcuts(
        shortcuts.some((s) => s.path === entry.path)
          ? shortcuts.filter((s) => s.path !== entry.path)
          : [...shortcuts, { path: entry.path, is_dir: entry.is_dir }],
      );
    },
    [shortcuts, saveShortcuts],
  );

  const actions = useEntryActions(setError, toggleShortcut, isShortcut);

  /** Expands the tree down to `path` and puts the cursor on it. */
  const reveal = useCallback(
    (path: string) => {
      if (!selected) return;
      const toOpen = ancestorsWithin(selected.path, path);
      if (toOpen.length === 0) return;
      setOpen((prev) => {
        const next = { ...prev };
        for (const folder of toOpen) next[folder] = true;
        return next;
      });
      setCursor(path);
    },
    [selected],
  );

  const openShortcut = useCallback(
    (shortcut: DocsShortcut) => {
      reveal(shortcut.path);
      if (shortcut.is_dir) {
        setSelectedDir(shortcut.path);
        setOpen((prev) => ({ ...prev, [shortcut.path]: true }));
      } else {
        setSelectedDir(parentPath(shortcut.path));
        openDoc(shortcut.path);
      }
    },
    [reveal, openDoc],
  );

  const openRecent = useCallback(
    (path: string) => {
      reveal(path);
      setSelectedDir(parentPath(path));
      openDoc(path);
    },
    [reveal, openDoc],
  );

  const sidebarTree = (
    <DocsTree
      rootPath={selected?.path ?? ""}
      rootName={selected?.name || (selected ? baseName(selected.path) : "")}
      selected={doc}
      selectedDir={listPane ? selectedDir : ""}
      filter={filter}
      foldersOnly={listPane}
      dirs={dirs}
      onNeededChange={onNeededChange}
      open={open}
      onOpenChange={setOpen}
      cursor={cursor}
      onCursorChange={setCursor}
      actions={actions}
      onSelect={onSelectEntry}
      onSelectDir={setSelectedDir}
    />
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <DocsRootsBar
        roots={roots}
        selectedId={rootId}
        onSelect={selectRoot}
        onRootsChanged={onRootsChanged}
        onError={setError}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {/* A new server re-renders the open document's diagrams; a changed
          sidebar layout is picked up the same way. */}
      <DocsSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => {
          void loadDocsSettings();
          refresh();
        }}
      />

      {error && (
        <div className="border-b bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive">
          {error}
        </div>
      )}

      {roots.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <p className="max-w-md text-center text-xs leading-relaxed text-muted-foreground">
            No folders registered yet. Add the shared folder your team keeps its Markdown in —
            a Google Drive network drive, for instance — and its documents can be read here
            without opening it as an Obsidian vault. Nothing is ever written into the folder.
          </p>
        </div>
      ) : !selected?.available ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="flex max-w-md flex-col items-center gap-3">
            <p className="text-center text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium">{selected?.path}</span> is not reachable on this PC.
              Check that the drive is mounted and, if it lives somewhere else now, correct the
              path with the pencil button above.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setError("");
                void recheckRoots();
              }}
            >
              <RefreshCw />
              Try again
            </Button>
          </div>
        </div>
      ) : (
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1" {...splitLayout}>
          {/* The lower bound is deliberately small (T-0276): with the file
              list beside it, the tree is often wanted as a narrow strip. */}
          <ResizablePanel id="tree" defaultSize="28%" minSize="6%" className="min-h-0">
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex items-center gap-1 border-b px-2 py-1.5">
                <Search className="size-3.5 shrink-0 text-muted-foreground" />
                <Input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter by name"
                  className="h-7 border-0 px-1 text-xs shadow-none focus-visible:ring-0"
                />
                <Hint label="Collapse every folder">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Collapse all"
                    onClick={() => setOpen({})}
                  >
                    <ChevronsDownUp />
                  </Button>
                </Hint>
                <Hint label="Re-read the folder (keeps the tree open)">
                  <Button size="icon-sm" variant="ghost" aria-label="Refresh" onClick={refresh}>
                    <RefreshCw className={cn(refreshing && "animate-spin")} />
                  </Button>
                </Hint>
              </div>

              <ShortcutsSection
                shortcuts={visibleShortcuts}
                elsewhere={shortcuts.length - visibleShortcuts.length}
                activePath={doc || selectedDir}
                onOpen={openShortcut}
                onReveal={(shortcut) => reveal(shortcut.path)}
                onRemove={(path) => saveShortcuts(shortcuts.filter((s) => s.path !== path))}
                onReorder={(next) =>
                  saveShortcuts(reorderWithinRoot(shortcuts, selected?.path ?? "", next))
                }
              />
              <RecentSection
                paths={recent}
                activePath={doc}
                onOpen={openRecent}
                onForget={(path) => setRecent(removeRecent(rootId, path))}
                onClear={() => setRecent(clearRecent(rootId))}
              />

              {listPane ? (
                <ResizablePanelGroup
                  orientation="horizontal"
                  className="min-h-0 flex-1"
                  {...sidebarLayout}
                >
                  <ResizablePanel id="folders" defaultSize="45%" minSize="15%" className="min-h-0">
                    <div className="flex h-full min-h-0 flex-col">{sidebarTree}</div>
                  </ResizablePanel>
                  <ResizableHandle />
                  <ResizablePanel id="files" minSize="20%" className="min-h-0 min-w-0">
                    <DocsFileList
                      dir={selectedDir}
                      dirs={dirs}
                      selected={doc}
                      cursor={cursor}
                      onCursorChange={setCursor}
                      onSelect={onSelectEntry}
                      filter={filter}
                      actions={actions}
                    />
                  </ResizablePanel>
                </ResizablePanelGroup>
              ) : (
                sidebarTree
              )}
            </div>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id="preview" minSize="30%" className="min-h-0 min-w-0">
            <DocsPreview
              path={doc}
              refreshToken={refreshToken}
              onError={setError}
              onBusyChange={setDocBusy}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  );
}
