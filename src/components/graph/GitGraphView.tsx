import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  ArrowLeft,
  Download,
  GitBranch,
  Loader2,
  RefreshCw,
  Upload,
} from "lucide-react";
import { CommitRow, type DialogRequest } from "@/components/graph/CommitRow";
import { ConfirmDialog } from "@/components/graph/ConfirmDialog";
import { NameDialog } from "@/components/graph/NameDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { computeGraphLayout, ROW_H } from "@/lib/gitGraph";
import type { CommitEntry, GitLog, GraphOp } from "@/types";

const PAGE = 500;
const WORKTREE_HASH = "WORKTREE";

interface Props {
  path: string;
  name: string;
  onClose: () => void;
  onRepoChanged: (path: string) => void;
}

export function GitGraphView({ path, name, onClose, onRepoChanged }: Props) {
  const [log, setLog] = useState<GitLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [opBusy, setOpBusy] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [dialog, setDialog] = useState<DialogRequest | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef(0);

  const load = useCallback(
    async (limit: number, skip: number, append: boolean) => {
      setLoading(true);
      try {
        const next = await api.gitLog(path, limit, skip);
        setLog((prev) =>
          append && prev
            ? { ...next, commits: [...prev.commits, ...next.commits] }
            : next,
        );
      } catch (e) {
        setStatus(`git log failed — ${e}`);
      } finally {
        setLoading(false);
      }
    },
    [path],
  );

  useEffect(() => {
    void load(PAGE, 0, false);
  }, [load]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewportH(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const reload = useCallback(() => {
    const count = log?.commits.length ?? 0;
    return load(Math.max(PAGE, count), 0, false);
  }, [load, log]);

  const runOp = useCallback(
    async (label: string, op: GraphOp) => {
      setDialog(null);
      setOpBusy(label);
      try {
        const msg = await api.gitGraphOp(path, op);
        setStatus(`${label} ok — ${msg}`);
      } catch (e) {
        setStatus(`${label} failed — ${e}`);
      } finally {
        setOpBusy(null);
        await reload();
        onRepoChanged(path);
      }
    },
    [path, reload, onRepoChanged],
  );

  const deleteBranch = useCallback(
    async (branch: string) => {
      setDialog(null);
      setOpBusy("Delete branch");
      try {
        const msg = await api.gitGraphOp(path, {
          kind: "delete_branch",
          name: branch,
          force: false,
        });
        setStatus(`Delete branch ok — ${msg}`);
        setOpBusy(null);
        await reload();
        onRepoChanged(path);
      } catch (e) {
        setOpBusy(null);
        if (String(e).includes("not fully merged")) {
          setStatus(`Delete branch failed — ${e}`);
          setDialog({
            kind: "confirm",
            title: "Force delete branch",
            description: `Branch "${branch}" is not fully merged. Delete it anyway? Unmerged commits may be lost.`,
            confirmLabel: "Force delete",
            destructive: true,
            onConfirm: () =>
              void runOp("Force delete branch", {
                kind: "delete_branch",
                name: branch,
                force: true,
              }),
          });
        } else {
          setStatus(`Delete branch failed — ${e}`);
          await reload();
        }
      }
    },
    [path, reload, onRepoChanged, runOp],
  );

  const copy = useCallback((text: string, what: string) => {
    void writeText(text).then(() => setStatus(`Copied ${what}`));
  }, []);

  const onScroll = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) setScrollTop(el.scrollTop);
    });
  }, []);

  const detached = (log?.current_branch ?? "") === "";

  const rows = useMemo<CommitEntry[]>(() => {
    if (!log) return [];
    if (log.uncommitted === 0 || !log.head) return log.commits;
    const worktree: CommitEntry = {
      hash: WORKTREE_HASH,
      parents: [log.head],
      author: "",
      date: 0,
      refs: [],
      subject: `${log.uncommitted} uncommitted change${log.uncommitted > 1 ? "s" : ""}`,
    };
    return [worktree, ...log.commits];
  }, [log]);

  const layout = useMemo(() => computeGraphLayout(rows), [rows]);

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - 20);
  const end = Math.min(rows.length, start + Math.ceil(viewportH / ROW_H) + 40);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* header */}
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <Button size="icon" variant="ghost" className="size-8" onClick={onClose}>
          <ArrowLeft className="size-4" />
        </Button>
        <span className="text-[13px] font-semibold">{name}</span>
        <Badge
          variant="outline"
          className="h-5 gap-1 border-violet-500/30 bg-violet-500/10 px-1.5 text-[11px] font-medium text-violet-300"
        >
          <GitBranch className="size-3" />
          <span className="max-w-40 truncate">
            {detached ? "detached HEAD" : log?.current_branch}
          </span>
        </Badge>
        {(loading || opBusy) && <Loader2 className="size-3.5 animate-spin text-primary" />}
        {opBusy && <span className="text-[11px] text-muted-foreground">{opBusy}…</span>}

        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            disabled={!!opBusy}
            onClick={() => void runOp("Fetch", { kind: "fetch" })}
          >
            <RefreshCw className="size-3.5" /> Fetch
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            disabled={!!opBusy || detached}
            onClick={() => void runOp("Pull", { kind: "pull" })}
          >
            <Download className="size-3.5" /> Pull
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            disabled={!!opBusy || detached}
            onClick={() => void runOp("Push", { kind: "push" })}
          >
            <Upload className="size-3.5" /> Push
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            disabled={loading || !!opBusy}
            onClick={() => void reload()}
          >
            <RefreshCw className="size-3.5" /> Refresh
          </Button>
        </div>
      </header>

      {/* commit list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-2 py-1" onScroll={onScroll}>
        {!log && loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <p className="mt-16 text-center text-sm text-muted-foreground">
            No commits yet.
          </p>
        ) : (
          <>
            <div style={{ height: start * ROW_H }} />
            {rows.slice(start, end).map((entry, i) => (
              <CommitRow
                key={entry.hash}
                entry={entry}
                layout={layout[start + i]}
                isHead={entry.hash === log?.head}
                isWorktree={entry.hash === WORKTREE_HASH}
                detached={detached}
                currentBranch={log?.current_branch ?? ""}
                opBusy={opBusy}
                onOp={(label, op) => void runOp(label, op)}
                onCopy={copy}
                onRequestDialog={setDialog}
                onDeleteBranch={(b) => void deleteBranch(b)}
              />
            ))}
            <div style={{ height: (rows.length - end) * ROW_H }} />
            {log?.has_more && (
              <div className="flex justify-center py-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  disabled={loading}
                  onClick={() => void load(PAGE, log.commits.length, true)}
                >
                  {loading ? <Loader2 className="size-3.5 animate-spin" /> : "Load more"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* status bar */}
      <footer className="flex items-center border-t px-4 py-1.5 text-[11px] text-muted-foreground">
        <span className="truncate">{status}</span>
        <span className="ml-auto shrink-0">
          {log ? `${log.commits.length}${log.has_more ? "+" : ""} commits` : ""}
        </span>
      </footer>

      {/* dialogs */}
      <ConfirmDialog
        open={dialog?.kind === "confirm"}
        title={dialog?.kind === "confirm" ? dialog.title : ""}
        description={dialog?.kind === "confirm" ? dialog.description : ""}
        confirmLabel={dialog?.kind === "confirm" ? dialog.confirmLabel : ""}
        destructive={dialog?.kind === "confirm" ? dialog.destructive : false}
        onConfirm={() => {
          if (dialog?.kind === "confirm") dialog.onConfirm();
        }}
        onClose={() => setDialog(null)}
      />
      <NameDialog
        open={dialog?.kind === "name"}
        title={dialog?.kind === "name" ? dialog.title : ""}
        placeholder={dialog?.kind === "name" ? dialog.placeholder : ""}
        withCheckout={dialog?.kind === "name" ? dialog.withCheckout : false}
        onSubmit={(n, c) => {
          if (dialog?.kind === "name") dialog.onSubmit(n, c);
        }}
        onClose={() => setDialog(null)}
      />
    </div>
  );
}
