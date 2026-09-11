import { useCallback, useEffect, useState } from "react";
import { useDefaultLayout } from "react-resizable-panels";
import { ChevronsDownUp, RefreshCw, Search } from "lucide-react";
import { DocsPreview } from "@/components/docs/docs-preview";
import { DocsRootsBar } from "@/components/docs/docs-roots-bar";
import { DocsSettingsDialog } from "@/components/docs/docs-settings-dialog";
import { DocsTree } from "@/components/docs/docs-tree";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { DocsRootStatus } from "@/types";

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
  // Bumped by the collapse button; closes every folder the tree has open.
  const [collapseToken, setCollapseToken] = useState(0);
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
  // The tree / preview split survives a restart (T-0279), like the Repos
  // tab's panels.
  const splitLayout = useDefaultLayout({ id: "docs-split", storage: localStorage });

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

  useEffect(() => {
    void (async () => {
      try {
        const list = await api.docsRoots();
        setRoots(list);
        const remembered = recall(LAST_ROOT);
        const initial = list.find((r) => r.id === remembered) ?? list[0];
        if (initial) {
          setRootId(initial.id);
          // Only restore the document when it belongs to the root being
          // restored; otherwise the preview would open a file the tree has
          // no way to show.
          const lastDoc = recall(LAST_DOC);
          if (lastDoc.startsWith(initial.path)) setDoc(lastDoc);
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

      {/* A new server re-renders the open document's diagrams. */}
      <DocsSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={refresh}
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
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-h-0 flex-1"
          {...splitLayout}
        >
          <ResizablePanel id="tree" defaultSize="28%" minSize="16%" className="min-h-0">
            <div className="flex h-full flex-col">
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
                    onClick={() => setCollapseToken((n) => n + 1)}
                  >
                    <ChevronsDownUp />
                  </Button>
                </Hint>
                <Hint label="Re-read the folder (keeps the tree open)">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Refresh"
                    onClick={refresh}
                  >
                    <RefreshCw className={cn(refreshing && "animate-spin")} />
                  </Button>
                </Hint>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                <DocsTree
                  rootPath={selected.path}
                  selected={doc}
                  filter={filter}
                  refreshToken={refreshToken}
                  collapseToken={collapseToken}
                  onError={setError}
                  onBusyChange={setTreeBusy}
                  onSelect={(entry) => {
                    setDoc(entry.path);
                    remember(LAST_DOC, entry.path);
                  }}
                />
              </div>
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
