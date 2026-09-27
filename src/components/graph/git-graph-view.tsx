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
import { BranchFilterPopover, type BranchFilter } from "@/components/graph/branch-filter-popover";
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
import { t as tStatic, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { CommitEntry, GitLog, GraphOp } from "@/types";

const PAGE = 500;
const WORKTREE_HASH = "WORKTREE";
/** Minimum gap between two automatic fetches of the same repository. */
const AUTO_FETCH_COOLDOWN_MS = 60_000;
/** How long a `git log` may run before the "taking a while" notice appears. */
const SLOW_LOAD_MS = 5_000;
/** The error `git_log` returns for a load killed via `cancel_log` — never
 * surfaced as a failure. */
const CANCELLED_ERROR = "cancelled";

/**
 * When the graph was last auto-fetched, per repository path. Module scope on
 * purpose: the view unmounts every time the sheet closes, and reopening it a
 * few seconds later should not fire another fetch.
 */
const lastAutoFetchAt = new Map<string, number>();

interface Props {
  path: string;
  name: string;
  /** Extra branches always shown on top of the dynamically-computed
   * defaults; persisted per repo alongside `favorite` (T-0408). */
  graphBranches: string[];
  graphShowAll: boolean;
  onGraphFilterChange: (next: BranchFilter) => void;
  onClose: () => void;
  onRepoChanged: (path: string) => void;
  /** Whether the containing sheet is expanded to the full window width. */
  maximized: boolean;
  onToggleMaximize: () => void;
}

export function GitGraphView({
  path,
  name,
  graphBranches,
  graphShowAll,
  onGraphFilterChange,
  onClose,
  onRepoChanged,
  maximized,
  onToggleMaximize,
}: Props) {
  const t = useT();
  const [log, setLog] = useState<GitLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [slowLoad, setSlowLoad] = useState(false);
  const [branchFilterOpen, setBranchFilterOpen] = useState(false);
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
  /** `request_id` of the `git_log` currently in flight, if any — lets a
   * newer load supersede (and cancel) an older one, and lets the repo-path
   * change / unmount effect below cancel whatever is still running. */
  const requestIdRef = useRef<string | null>(null);

  // Persist the commit-list / diff-panel split across restarts, the same way
  // the repos list persists its own vertical split.
  const diffLayout = useDefaultLayout({
    id: "git-graph-vertical",
    storage: localStorage,
  });

  const load = useCallback(
    async (limit: number, skip: number, append: boolean) => {
      // A load already in flight for this view is superseded by this one —
      // cancel it rather than let two `git log` processes run at once.
      if (requestIdRef.current) {
        void api.gitLogCancel(requestIdRef.current);
      }
      const requestId = crypto.randomUUID();
      requestIdRef.current = requestId;

      setLoading(true);
      setSlowLoad(false);
      const slowTimer = window.setTimeout(() => setSlowLoad(true), SLOW_LOAD_MS);
      try {
        const next = await api.gitLog(path, limit, skip, graphBranches, graphShowAll, requestId);
        // Superseded by a newer load while this one was in flight — its
        // result is stale, and the newer load owns `loading`/`slowLoad` now.
        if (requestIdRef.current !== requestId) return;
        setLog((prev) =>
          append && prev
            ? { ...next, commits: [...prev.commits, ...next.commits] }
            : next,
        );
      } catch (e) {
        if (requestIdRef.current !== requestId) return;
        if (String(e) !== CANCELLED_ERROR) {
          setStatus(tStatic("graph.status.gitLogFailed", { error: String(e) }));
        }
      } finally {
        window.clearTimeout(slowTimer);
        if (requestIdRef.current === requestId) {
          requestIdRef.current = null;
          setLoading(false);
          setSlowLoad(false);
        }
      }
    },
    [path, graphBranches, graphShowAll],
  );

  useEffect(() => {
    void load(PAGE, 0, false);
  }, [load]);

  // Cancel whatever `git log` is still running when the repo changes or this
  // view unmounts — a load for a repo the user has already left behind is
  // pure waste, and on a huge repo it can otherwise run for a long time.
  useEffect(() => {
    return () => {
      if (requestIdRef.current) {
        void api.gitLogCancel(requestIdRef.current);
        requestIdRef.current = null;
      }
    };
  }, [path]);

  const cancelCurrentLoad = useCallback(() => {
    if (requestIdRef.current) {
      void api.gitLogCancel(requestIdRef.current);
      requestIdRef.current = null;
    }
    setLoading(false);
    setSlowLoad(false);
  }, []);

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
        setStatus(tStatic("graph.status.ok", { label, msg }));
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
              title: tStatic("graph.view.pullChangesTitle"),
              description: tStatic("graph.view.pullChangesDescription", {
                branch: info.branch,
                count: n,
              }),
              confirmLabel: tStatic("graph.view.pull"),
              onConfirm: () => void runOp(tStatic("graph.view.pull"), { kind: "pull" }),
            });
          }
        }
      } catch (e) {
        setStatus(tStatic("graph.status.failed", { label, error: String(e) }));
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
      setOpBusy(tStatic("graph.op.deleteBranchTitle"));
      try {
        const msg = await api.gitGraphOp(path, {
          kind: "delete_branch",
          name: branch,
          force: false,
        });
        setStatus(tStatic("graph.status.ok", { label: tStatic("graph.op.deleteBranchTitle"), msg }));
        setOpBusy(null);
        await reload();
        onRepoChanged(path);
      } catch (e) {
        setOpBusy(null);
        if (String(e).includes("not fully merged")) {
          setStatus(
            tStatic("graph.status.failed", {
              label: tStatic("graph.op.deleteBranchTitle"),
              error: String(e),
            }),
          );
          setDialog({
            kind: "confirm",
            title: tStatic("graph.op.forceDeleteBranchTitle"),
            description: tStatic("graph.op.forceDeleteBranchDescription", { branch }),
            confirmLabel: tStatic("graph.op.forceDelete"),
            destructive: true,
            onConfirm: () =>
              void runOp(tStatic("graph.op.forceDeleteBranch"), {
                kind: "delete_branch",
                name: branch,
                force: true,
              }),
          });
        } else {
          setStatus(
            tStatic("graph.status.failed", {
              label: tStatic("graph.op.deleteBranchTitle"),
              error: String(e),
            }),
          );
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
        setStatus(tStatic("graph.status.fetchedFromRemote"));
      } catch (e) {
        // No remote configured, offline, or credentials needed. A fetch the
        // user did not ask for must not nag — one quiet line in the status bar.
        if (!cancelled) setStatus(tStatic("graph.status.autoFetchSkipped", { error: String(e) }));
      } finally {
        if (!cancelled) setAutoFetching(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [path]);

  const copy = useCallback((text: string, what: string) => {
    void writeText(text).then(() => setStatus(tStatic("graph.status.copied", { what })));
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
      subject: tStatic("graph.view.uncommittedChanges", { count: log.uncommitted }),
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
        <p className="mt-16 text-center text-sm text-muted-foreground">
          {t("graph.view.noCommitsYet")}
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
                {loading ? <Loader2 className="size-3.5 animate-spin" /> : t("graph.view.loadMore")}
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
                  {detached ? t("graph.view.detachedHead") : log?.current_branch}
                </span>
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              {detached ? t("graph.view.detachedHead") : log?.current_branch || t("graph.view.noBranch")}
            </TooltipContent>
          </Tooltip>
          {/* Switch to any local or remote branch, filterable by typing — handy
              when a repo has many branches that aren't decorated in the graph.
              Lives inside a modal Sheet, so the popover is modal too (otherwise
              the Sheet's scroll/pointer guard eats wheel and click). */}
          <BranchCombobox
            path={path}
            current={detached ? "" : (log?.current_branch ?? "")}
            onSwitch={(branch) => void runOp(t("graph.op.checkout"), { kind: "checkout", branch })}
            disabled={!!opBusy}
            modal
            trigger={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 w-52 justify-between px-2 text-xs font-normal"
              >
                <span className="truncate">{t("graph.view.switchBranch")}</span>
                <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
              </Button>
            }
          />
          {/* Restrict which branches the graph walks (T-0408) — the default
              way a repo with many branches gets its commit history to load
              at all. */}
          <BranchFilterPopover
            path={path}
            extraBranches={graphBranches}
            showAll={graphShowAll}
            onChange={onGraphFilterChange}
            disabled={!!opBusy}
            open={branchFilterOpen}
            onOpenChange={setBranchFilterOpen}
          />
          {(loading || opBusy || autoFetching) && (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
          )}
          {opBusy ? (
            <span className="truncate text-[11px] text-muted-foreground">{opBusy}…</span>
          ) : (
            autoFetching && (
              <span className="truncate text-[11px] text-muted-foreground">
                {t("graph.view.fetching")}
              </span>
            )
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            disabled={!!opBusy}
            onClick={() => void runOp(t("graph.view.fetch"), { kind: "fetch" })}
          >
            <RefreshCw className="size-3.5" /> {t("graph.view.fetch")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            disabled={!!opBusy || detached}
            onClick={() => void runOp(t("graph.view.pull"), { kind: "pull" })}
          >
            <Download className="size-3.5" /> {t("graph.view.pull")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            disabled={!!opBusy || detached}
            onClick={() => void runOp(t("graph.view.push"), { kind: "push" })}
          >
            <Upload className="size-3.5" /> {t("graph.view.push")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            disabled={loading || !!opBusy}
            onClick={() => void reload()}
          >
            <RefreshCw className="size-3.5" /> {t("graph.view.refresh")}
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
            <TooltipContent>
              {maximized ? t("graph.view.restoreSize") : t("graph.view.maximize")}
            </TooltipContent>
          </Tooltip>
        </div>
      </header>

      {/* Shown once a load has been running long enough that narrowing the
          branch filter is a plausible fix — see SLOW_LOAD_MS. Never shown
          for a load already restricted to a small ref set, since narrowing
          further would not be the fix at that point... but the timer alone
          can't tell that, so both actions stay offered regardless. */}
      {slowLoad && loading && (
        <div className="flex items-center gap-3 border-b bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-200">
          <Loader2 className="size-3.5 shrink-0 animate-spin" />
          <span className="flex-1">{t("graph.slowLoad.message")}</span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            onClick={cancelCurrentLoad}
          >
            {t("graph.slowLoad.cancel")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            onClick={() => setBranchFilterOpen(true)}
          >
            {t("graph.slowLoad.chooseBranches")}
          </Button>
        </div>
      )}

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
          {log
            ? t("graph.view.commitCount", {
                count: `${log.commits.length}${log.has_more ? "+" : ""}`,
              })
            : ""}
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
