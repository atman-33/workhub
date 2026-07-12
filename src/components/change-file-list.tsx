import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  List,
  ListTree,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buildFileTree, type TreeNode } from "@/lib/file-tree";
import { statusTone } from "@/lib/diff-format";
import { cn } from "@/lib/utils";
import type { CommitFileChange } from "@/types";

type ViewMode = "tree" | "flat";
const VIEW_KEY = "changes.fileView";

interface Props {
  /** Changed files, or null while loading. */
  files: CommitFileChange[] | null;
  loading?: boolean;
  error?: string;
  /** Message shown when there are zero changes. */
  emptyLabel?: string;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  /** When this changes (repo/commit switch), folder collapse state resets. */
  resetKey?: string;
}

/**
 * Left-pane list of changed files, shared by the Repos Changes panel and the
 * Git Graph diff panel. Toggles between a folder tree (default, with compacted
 * single-child folders) and a flat path list; the choice persists across the
 * app. Folders start fully expanded.
 */
export function ChangeFileList({
  files,
  loading,
  error,
  emptyLabel = "No changes.",
  selectedPath,
  onSelect,
  resetKey,
}: Props) {
  const [view, setView] = useState<ViewMode>(() =>
    localStorage.getItem(VIEW_KEY) === "flat" ? "flat" : "tree",
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    localStorage.setItem(VIEW_KEY, view);
  }, [view]);

  // Reset folder collapse state when the underlying subject changes.
  useEffect(() => {
    setCollapsed(new Set());
  }, [resetKey]);

  const toggleCollapse = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const tree = useMemo(() => (files ? buildFileTree(files) : []), [files]);
  const flat = useMemo(
    () => (files ? [...files].sort((a, b) => a.path.localeCompare(b.path)) : []),
    [files],
  );

  const renderNodes = (nodes: TreeNode[], depth: number): React.ReactNode =>
    nodes.map((node) => {
      if (node.type === "dir") {
        const isCollapsed = collapsed.has(node.path);
        return (
          <div key={`d:${node.path}`}>
            <button
              type="button"
              className="flex w-full items-center gap-1 py-1 pr-2 text-left text-muted-foreground hover:bg-accent/40"
              style={{ paddingLeft: 6 + depth * 12 }}
              onClick={() => toggleCollapse(node.path)}
            >
              {isCollapsed ? (
                <ChevronRight className="size-3.5 shrink-0" />
              ) : (
                <ChevronDown className="size-3.5 shrink-0" />
              )}
              <Folder className="size-3.5 shrink-0 text-sky-400/70" />
              <span className="min-w-0 truncate text-[11px]" title={node.path}>
                {node.name}
              </span>
            </button>
            {!isCollapsed && renderNodes(node.children, depth + 1)}
          </div>
        );
      }
      return (
        <FileRow
          key={`f:${node.path}`}
          change={node.change}
          label={node.name}
          indent={6 + depth * 12 + 18}
          selected={selectedPath === node.path}
          onSelect={onSelect}
        />
      );
    });

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* view toggle */}
      <div className="flex shrink-0 items-center gap-0.5 border-b px-1 py-0.5">
        <span className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
          Files
        </span>
        <div className="ml-auto flex items-center">
          <Button
            size="icon"
            variant="ghost"
            className={cn("size-6", view === "tree" && "text-primary")}
            title="Tree view"
            aria-pressed={view === "tree"}
            onClick={() => setView("tree")}
          >
            <ListTree className="size-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className={cn("size-6", view === "flat" && "text-primary")}
            title="Flat view"
            aria-pressed={view === "flat"}
            onClick={() => setView("flat")}
          >
            <List className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* body */}
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {error ? (
          <p className="px-3 py-2 text-[11px] text-red-400">{error}</p>
        ) : files === null && loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : files && files.length === 0 ? (
          <p className="px-3 py-2 text-[11px] text-muted-foreground">{emptyLabel}</p>
        ) : view === "tree" ? (
          renderNodes(tree, 0)
        ) : (
          flat.map((f) => (
            <FileRow
              key={f.path}
              change={f}
              label={f.path}
              indent={8}
              selected={selectedPath === f.path}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}

function FileRow({
  change,
  label,
  indent,
  selected,
  onSelect,
}: {
  change: CommitFileChange;
  label: string;
  indent: number;
  selected: boolean;
  onSelect: (path: string) => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-1.5 py-1 pr-2 text-left hover:bg-accent/40",
        selected && "bg-accent/60",
      )}
      style={{ paddingLeft: indent }}
      onClick={() => onSelect(change.path)}
    >
      <Badge
        variant="outline"
        className={cn("h-4 w-5 shrink-0 justify-center px-0 text-[10px]", statusTone(change.status))}
      >
        {change.status}
      </Badge>
      <span className="min-w-0 flex-1 truncate text-[11px]" title={change.path}>
        {label}
      </span>
      {change.additions !== null && (
        <span className="shrink-0 text-[10px] text-emerald-400">+{change.additions}</span>
      )}
      {change.deletions !== null && (
        <span className="shrink-0 text-[10px] text-red-400">−{change.deletions}</span>
      )}
    </button>
  );
}
