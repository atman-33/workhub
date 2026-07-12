import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileDiff, FolderGit2, Loader2, RefreshCw, X } from "lucide-react";
import { useDefaultLayout } from "react-resizable-panels";
import { ChangeFileList } from "@/components/change-file-list";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { diffLineClass } from "@/lib/diff-format";
import { cn } from "@/lib/utils";
import type { CommitFileChange } from "@/types";

/** Pseudo-hash the backend maps to the uncommitted working tree. */
const WORKTREE_HASH = "WORKTREE";
/** How often to re-scan the active repo's working tree, in ms. */
const POLL_MS = 4000;

interface Props {
  /** Active repo path, or null when no repo row is selected for viewing. */
  path: string | null;
  name: string;
  /** Whether the Repos tab is the visible one; pauses polling when false. */
  active: boolean;
  onClose: () => void;
}

/**
 * Always-on view of a single repo's uncommitted working-tree changes
 * (tracked edits + untracked files), refreshed on an interval so an agent's
 * edits appear as they happen. File list on the left, unified diff on the
 * right. Read-only — no staging/discard.
 */
export function ChangesPanel({ path, name, active, onClose }: Props) {
  const [files, setFiles] = useState<CommitFileChange[] | null>(null);
  const [error, setError] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Persist the file-list / diff split across restarts (localStorage-backed).
  const innerLayout = useDefaultLayout({ id: "repos-changes-inner", storage: localStorage });

  // Keep the selected file across polls without re-deriving from a stale closure.
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedPath;

  const loadFiles = useCallback(async () => {
    if (!path) return;
    setRefreshing(true);
    try {
      const list = await api.gitCommitFiles(path, WORKTREE_HASH);
      setFiles(list);
      setError("");
      // Preserve the current selection if it still exists; otherwise pick the
      // first file (only when nothing is selected yet).
      const cur = selectedRef.current;
      if (cur && !list.some((f) => f.path === cur)) {
        setSelectedPath(list[0]?.path ?? null);
      } else if (!cur) {
        setSelectedPath(list[0]?.path ?? null);
      }
    } catch (e) {
      setError(String(e));
      setFiles([]);
    } finally {
      setRefreshing(false);
    }
  }, [path]);

  // Clear state when the active repo changes; loading is handled by the poll
  // effect below (which also fires an immediate load).
  useEffect(() => {
    setFiles(null);
    setError("");
    setSelectedPath(null);
    setDiff(null);
  }, [path]);

  // Poll the active repo while the Repos tab is shown and the window is
  // focused; also refresh immediately on (re)activation and on regaining focus.
  useEffect(() => {
    if (!path || !active) return;
    void loadFiles();
    const timer = window.setInterval(() => {
      if (!document.hidden) void loadFiles();
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void loadFiles();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [path, active, loadFiles]);

  const selected = useMemo(
    () => files?.find((f) => f.path === selectedPath) ?? null,
    [files, selectedPath],
  );

  // (Re)load the diff whenever the selection changes or the file list refreshes
  // (its content may have changed under an active agent).
  useEffect(() => {
    if (!path || !selected) {
      setDiff(null);
      return;
    }
    let cancelled = false;
    setDiffLoading(true);
    void api
      .gitCommitFileDiff(path, WORKTREE_HASH, selected.path, selected.old_path)
      .then((text) => {
        if (!cancelled) setDiff(text);
      })
      .catch((e) => {
        if (!cancelled) setDiff(`diff failed — ${e}`);
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, selected]);

  const diffLines = useMemo(() => (diff === null ? null : diff.split("\n")), [diff]);

  return (
    <div className="flex h-full min-h-0 flex-col border-t bg-background">
      {/* panel header */}
      <div className="flex shrink-0 items-center gap-2 border-b bg-muted/30 px-3 py-1.5">
        <FolderGit2 className="size-3.5 text-muted-foreground" />
        <span className="text-[12px] font-semibold">Changes</span>
        {path && (
          <span className="min-w-0 truncate text-[11px] text-muted-foreground">{name}</span>
        )}
        {(refreshing || diffLoading) && (
          <Loader2 className="size-3 animate-spin text-primary" />
        )}
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
          {files ? `${files.length} file${files.length === 1 ? "" : "s"}` : ""}
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="size-6 shrink-0"
          disabled={!path}
          title="Refresh"
          onClick={() => void loadFiles()}
        >
          <RefreshCw className="size-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-6 shrink-0"
          title="Hide changes panel"
          onClick={onClose}
        >
          <X className="size-3.5" />
        </Button>
      </div>

      {!path ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
          <FileDiff className="size-8 opacity-40" />
          <p className="text-xs">Click a repository to see its working-tree changes.</p>
        </div>
      ) : (
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-h-0 flex-1"
          {...innerLayout}
        >
          {/* file list */}
          <ResizablePanel id="files" defaultSize="32%" minSize="18%" className="min-w-0">
            <ChangeFileList
              files={files}
              loading
              error={error || undefined}
              emptyLabel="Working tree clean."
              selectedPath={selectedPath}
              onSelect={setSelectedPath}
              resetKey={path ?? undefined}
            />
          </ResizablePanel>

          <ResizableHandle />

          {/* diff view */}
          <ResizablePanel id="diff" defaultSize="68%" className="min-w-0">
            <div className="h-full overflow-auto">
              {diffLines === null ? (
                <p className="px-3 py-2 text-[11px] text-muted-foreground">
                  {files && files.length > 0
                    ? "Select a file to see its diff."
                    : ""}
                </p>
              ) : diff === "" ? (
                <p className="px-3 py-2 text-[11px] text-muted-foreground">
                  No textual diff (binary file or no content change).
                </p>
              ) : (
                <pre className="min-w-max px-2 py-1 font-mono text-[11px] leading-[1.5]">
                  {diffLines.map((line, i) => (
                    <div key={i} className={cn("px-1", diffLineClass(line))}>
                      {line || " "}
                    </div>
                  ))}
                </pre>
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  );
}
