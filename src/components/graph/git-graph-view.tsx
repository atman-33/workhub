import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useDefaultLayout } from "react-resizable-panels";
import {
  ChevronsUpDown,
  Download,
  GitBranch,
  Loader2,
  Maximize2,
  Minimize2,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import { CommitDiffPanel } from "@/components/graph/commit-diff-panel";
import {
  CommitRow,
  type DialogRequest,
  refTone,
} from "@/components/graph/commit-row";
import { ConfirmDialog } from "@/components/graph/confirm-dialog";
import { NameDialog } from "@/components/graph/name-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BranchCombobox } from "@/components/ui/branch-combobox";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { computeGraphLayout, ROW_H } from "@/lib/git-graph";
import { cn } from "@/lib/utils";
import type { CommitEntry, GitLog, GraphOp } from "@/types";

const PAGE = 500;
const WORKTREE_HASH = "WORKTREE";
/** Minimum gap between two automatic fetches of the same repository. */
const AUTO_FETCH_COOLDOWN_MS = 60_000;

/**
 * When the graph was last auto-fetched, per repository path. Module scope on
 * purpose: the view unmounts every time the sheet closes, and reopening it a
 * few seconds later should not fire another fetch.
 */
const lastAutoFetchAt = new Map<string, number>();

interface Props {
  path: string;
  name: string;
  onClose: () => void;
  onRepoChanged: (path: string) => void;
  /** Whether the containing sheet is expanded to the full window width. */
  maximized: boolean;
  onToggleMaximize: () => void;
}

export function GitGraphView({
  path,
  name,
  onClose,
  onRepoChanged,
  maximized,
  onToggleMaximize,
}: Props) {
  const [log, setLog] = useState<GitLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [opBusy, setOpBusy] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [dialog, setDialog] = useState<DialogRequest | null>(null);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [autoFetching, setAutoFetching] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const scrollTopRef = useRef(0);
  const rafRef = useRef(0);

  // Persist the commit-list / diff-panel split across restarts, the same way
  // the repos list persists its own vertical split.
  const diffLayout = useDefaultLayout({
    id: "git-graph-vertical",
    storage: localStorage,
  });

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

  // Opening/closing the diff panel moves the commit list into (and out of) a
  // resizable panel, which remounts it. Attach via a callback ref so the size
  // observer follows the live element, and restore the scroll offset so the
  // virtualised window still matches the row the user just clicked.
  const attachScroll = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    scrollRef.current = el;
    if (!el) return;
    el.scrollTop = scrollTopRef.current;
    setViewportH(el.clientHeight);
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    roRef.current = ro;
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
        // A manual fetch/pull refreshes the remote refs just as well, so it
        // starts the auto-fetch cooldown too.
        if (op.kind === "fetch" || op.kind === "pull") {
          lastAutoFetchAt.set(path, Date.now());
        }
        // After switching to a branch, offer to pull if it trails its upstream
        // (mirrors VS Code's Git Graph checkout flow).
        if (op.kind === "checkout") {
          const info = await api.gitStatus(path);
          if (info.has_upstream && info.behind > 0) {
            const n = info.behind;
            setDialog({
              kind: "confirm",
              title: "Pull changes",
              description: `${info.branch} is ${n} commit${n > 1 ? "s" : ""} behind its upstream. Pull now?`,
              confirmLabel: "Pull",
              onConfirm: () => void runOp("Pull", { kind: "pull" }),
            });
          }
        }
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

  // Kept in refs so the auto-fetch effect below depends on `path` alone: it
  // must fire once per opened repository, not again whenever the loaded
  // commits (and therefore `reload`) change identity.
  const reloadRef = useRef(reload);
  const onRepoChangedRef = useRef(onRepoChanged);
  useEffect(() => {
    reloadRef.current = reload;
    onRepoChangedRef.current = onRepoChanged;
  }, [reload, onRepoChanged]);

  // Opening the graph fetches from the remote, so remote branches and tags are
  // current without pressing Fetch. It runs beside the initial `git log` rather
  // than before it: the log is local and instant, the fetch is network-bound.
  // Deliberately not routed through `runOp` — that sets `opBusy`, which would
  // disable the whole header while a background job runs, and reports a failure
  // the user did not ask for.
  useEffect(() => {
    const last = lastAutoFetchAt.get(path) ?? 0;
    if (Date.now() - last < AUTO_FETCH_COOLDOWN_MS) return;
    lastAutoFetchAt.set(path, Date.now());

    let cancelled = false;
    setAutoFetching(true);
    void (async () => {
      try {
        await api.gitGraphOp(path, { kind: "fetch" });
        if (cancelled) return;
        await reloadRef.current();
        onRepoChangedRef.current(path);
        setStatus("Fetched from remote");
      } catch (e) {
        // No remote configured, offline, or credentials needed. A fetch the
        // user did not ask for must not nag — one quiet line in the status bar.
        if (!cancelled) setStatus(`Auto fetch skipped — ${e}`);
      } finally {
        if (!cancelled) setAutoFetching(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [path]);

  const copy = useCallback((text: string, what: string) => {
    void writeText(text).then(() => setStatus(`Copied ${what}`));
  }, []);

  const onScroll = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el) return;
      scrollTopRef.current = el.scrollTop;
      setScrollTop(el.scrollTop);
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

  const selectedEntry = useMemo(
    () => rows.find((r) => r.hash === selectedHash) ?? null,
    [rows, selectedHash],
  );

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - 20);
  const end = Math.min(rows.length, start + Math.ceil(viewportH / ROW_H) + 40);

  const commitList = (
    <div
      ref={attachScroll}
      className="h-full overflow-y-auto px-2 py-1"
      onScroll={onScroll}
    >
      {!log && loading ? (
        <div className="flex h-full items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <p className="mt-16 text-center text-sm text-muted-foreground">No commits yet.</p>
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
              selected={entry.hash === selectedHash}
              opBusy={opBusy}
              onOp={(label, op) => void runOp(label, op)}
              onCopy={copy}
              onRequestDialog={setDialog}
              onDeleteBranch={(b) => void deleteBranch(b)}
              onSelect={() =>
                setSelectedHash((prev) => (prev === entry.hash ? null : entry.hash))
              }
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
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* header */}
      <header className="flex items-center gap-2 border-b px-3 py-2">
        {/* Left half is the one that shrinks. A long repo or branch name used
            to push the right-hand controls past the sheet's right edge, and the
            maximize button — last in the row — disappeared with it. */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Button size="icon" variant="ghost" className="size-8 shrink-0" onClick={onClose}>
            <X className="size-4" />
          </Button>
          <span className="truncate text-[13px] font-semibold">{name}</span>
          {/* Same solid tone as the checked-out ref badge in the graph, so the
              header tells you what to look for and the graph shows you where. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className={cn(
                  "h-5 min-w-0 gap-1 px-1.5 text-[11px] font-bold",
                  refTone(detached ? "head" : "branch", true),
                )}
              >
                <GitBranch className="size-3 shrink-0" />
                <span className="max-w-40 truncate">
                  {detached ? "detached HEAD" : log?.current_branch}
                </span>
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              {detached ? "detached HEAD" : log?.current_branch || "(no branch)"}
            </TooltipContent>
          </Tooltip>
          {/* Switch to any local or remote branch, filterable by typing — handy
              when a repo has many branches that aren't decorated in the graph.
              Lives inside a modal Sheet, so the popover is modal too (otherwise
              the Sheet's scroll/pointer guard eats wheel and click). */}
          <BranchCombobox
            path={path}
            current={detached ? "" : (log?.current_branch ?? "")}
            onSwitch={(branch) => void runOp("Checkout", { kind: "checkout", branch })}
            disabled={!!opBusy}
            modal
            trigger={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 w-52 justify-between px-2 text-xs font-normal"
              >
                <span className="truncate">Switch branch…</span>
                <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
              </Button>
            }
          />
          {(loading || opBusy || autoFetching) && (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
          )}
          {opBusy ? (
            <span className="truncate text-[11px] text-muted-foreground">{opBusy}…</span>
          ) : (
            autoFetching && (
              <span className="truncate text-[11px] text-muted-foreground">Fetching…</span>
            )
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
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
          {/* Widens the sheet to the full window without remounting this view,
              so the loaded commits and the selection survive the toggle. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="outline"
                className="size-8"
                onClick={onToggleMaximize}
              >
                {maximized ? (
                  <Minimize2 className="size-3.5" />
                ) : (
                  <Maximize2 className="size-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{maximized ? "Restore size" : "Maximize"}</TooltipContent>
          </Tooltip>
        </div>
      </header>

      {/* commit list, optionally split with the commit diff panel */}
      {selectedEntry ? (
        <ResizablePanelGroup
          orientation="vertical"
          className="min-h-0 flex-1"
          {...diffLayout}
        >
          <ResizablePanel id="commits" defaultSize="55%" minSize="20%" className="min-h-0">
            {commitList}
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id="diff" defaultSize="45%" minSize="15%" className="min-h-0">
            <CommitDiffPanel
              path={path}
              entry={selectedEntry}
              onClose={() => setSelectedHash(null)}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <div className="min-h-0 flex-1">{commitList}</div>
      )}

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
