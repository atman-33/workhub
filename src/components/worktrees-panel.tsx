import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Code2,
  FolderOpen,
  GitBranch,
  Loader2,
  RefreshCw,
  SquareTerminal,
  Trash2,
  TreeDeciduous,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Hint } from "@/components/ui/hint";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { t as i18nT, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Settings, Worktree } from "@/types";

interface Props {
  projectPaths: string[];
  settings: Settings;
  onClose: () => void;
}

/** A worktree pending removal, plus the user's chosen options. */
interface RemoveTarget {
  wt: Worktree;
  force: boolean;
  deleteBranch: boolean;
}

export function WorktreesPanel({ projectPaths, settings, onClose }: Props) {
  const t = useT();
  const [worktrees, setWorktrees] = useState<Worktree[] | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [target, setTarget] = useState<RemoveTarget | null>(null);

  const refresh = useCallback(() => {
    setWorktrees(null);
    void api
      .listWorktrees(projectPaths)
      .then((ws) => setWorktrees(ws.filter((w) => !w.is_main)))
      .catch((e) => {
        setWorktrees([]);
        setStatus(i18nT("projects.worktrees.listFailed", { error: String(e) }));
      });
  }, [projectPaths]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Group task worktrees by task id; unlabeled worktrees (no task/<id> branch)
  // fall into a trailing "Other" group.
  const groups = useMemo(() => {
    const map = new Map<string, Worktree[]>();
    for (const w of worktrees ?? []) {
      const key = w.task_id ?? "\u{10ffff}other"; // sort last
      const arr = map.get(key) ?? [];
      arr.push(w);
      map.set(key, arr);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [worktrees]);

  const openVscode = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return;
      void api
        .openInVscode(settings.vscode_cmd, paths)
        .then(() =>
          setStatus(i18nT("projects.worktrees.openedInVscode", { count: paths.length })),
        )
        .catch((e) =>
          setStatus(i18nT("projects.worktrees.vscodeLaunchFailed", { error: String(e) })),
        );
    },
    [settings.vscode_cmd],
  );

  const confirmRemove = useCallback(async () => {
    if (!target) return;
    const { wt, force, deleteBranch } = target;
    setBusy(wt.path);
    setTarget(null);
    try {
      await api.removeWorktree(wt.repo_path, wt.path, force);
      if (deleteBranch && wt.branch) {
        // Force-delete the task branch (it is typically unmerged).
        await api.deleteWorktreeBranch(wt.repo_path, wt.branch, true);
      }
      setStatus(
        i18nT("projects.worktrees.removed", { repo: wt.repo_name, branch: wt.branch || wt.path }),
      );
      refresh();
    } catch (e) {
      setStatus(i18nT("projects.worktrees.removeFailed", { error: String(e) }));
    } finally {
      setBusy(null);
    }
  }, [target, refresh]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <TreeDeciduous className="size-4 text-primary" />
        <h2 className="text-sm font-bold tracking-tight">{t("projects.worktrees.title")}</h2>
        <Button
          size="sm"
          variant="outline"
          className="ml-2 h-7 gap-1.5 text-xs"
          onClick={refresh}
        >
          <RefreshCw className="size-3.5" /> {t("projects.worktrees.refresh")}
        </Button>
        <Button size="icon" variant="ghost" className="ml-auto size-7" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </header>

      <main className="flex-1 overflow-y-auto px-3 py-2">
        {worktrees === null ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : worktrees.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <TreeDeciduous className="size-9 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">{t("projects.worktrees.empty")}</p>
            <p className="max-w-xs text-xs text-muted-foreground/70">
              {t("projects.worktrees.emptyHint")}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map(([key, items]) => {
              const taskId = items[0].task_id;
              const label = taskId ?? t("projects.worktrees.otherGroup");
              return (
                <section key={key} className="space-y-1">
                  <div className="flex items-center gap-2 px-1">
                    <span className="text-xs font-semibold text-primary">{label}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {t(
                        items.length === 1
                          ? "projects.worktrees.worktreeCountOne"
                          : "projects.worktrees.worktreeCountOther",
                        { count: items.length },
                      )}
                    </span>
                    {items.length > 1 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto h-6 gap-1 px-1.5 text-[11px]"
                        onClick={() => openVscode(items.map((w) => w.path))}
                      >
                        <Code2 className="size-3" /> {t("projects.worktrees.openAllInVscode")}
                      </Button>
                    )}
                  </div>
                  <div className="space-y-0.5">
                    {items.map((w) => (
                      <WorktreeRow
                        key={w.path}
                        wt={w}
                        busy={busy === w.path}
                        terminalCmd={settings.terminal_cmd}
                        onOpenVscode={() => openVscode([w.path])}
                        onRemove={() =>
                          setTarget({ wt: w, force: w.dirty, deleteBranch: false })
                        }
                        onStatus={setStatus}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </main>

      <footer className="flex items-center border-t px-4 py-1.5 text-[11px] text-muted-foreground">
        <span className="truncate">{status}</span>
      </footer>

      <RemoveDialog
        target={target}
        onChange={setTarget}
        onCancel={() => setTarget(null)}
        onConfirm={confirmRemove}
      />
    </div>
  );
}

function WorktreeRow({
  wt,
  busy,
  terminalCmd,
  onOpenVscode,
  onRemove,
  onStatus,
}: {
  wt: Worktree;
  busy: boolean;
  terminalCmd: string;
  onOpenVscode: () => void;
  onRemove: () => void;
  onStatus: (s: string) => void;
}) {
  const t = useT();
  return (
    <div className="group flex h-10 items-center gap-2 rounded-lg border border-transparent px-2.5 hover:border-border hover:bg-accent/40">
      <span className="max-w-40 truncate text-[13px] font-medium">{wt.repo_name}</span>
      <Badge
        variant="outline"
        className="h-5 gap-1 border-violet-500/30 bg-violet-500/10 px-1.5 text-[11px] text-violet-700 dark:text-violet-300"
      >
        <GitBranch className="size-3" />
        <span className="max-w-40 truncate">
          {wt.branch || t("projects.worktrees.detached")}
        </span>
      </Badge>
      {wt.dirty && (
        <Hint label={t("projects.worktrees.uncommittedChanges")}>
          <Badge
            variant="outline"
            className="h-5 border-amber-500/30 bg-amber-500/10 px-1.5 text-[11px] text-amber-600 dark:text-amber-400"
          >
            {t("projects.worktrees.dirty")}
          </Badge>
        </Hint>
      )}
      {wt.locked && (
        <Badge variant="outline" className="h-5 px-1.5 text-[11px] text-muted-foreground">
          {t("projects.worktrees.locked")}
        </Badge>
      )}
      <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/70">
        {wt.path}
      </span>

      {busy && <Loader2 className="size-3.5 animate-spin text-primary" />}

      <Hint label={t("projects.worktrees.openInVscode")}>
        <Button
          size="icon"
          variant="ghost"
          className="size-7 opacity-60 group-hover:opacity-100"
          onClick={onOpenVscode}
        >
          <Code2 className="size-4" />
        </Button>
      </Hint>
      <Hint label={t("projects.worktrees.openInExplorer")}>
        <Button
          size="icon"
          variant="ghost"
          className="size-7 opacity-60 group-hover:opacity-100"
          onClick={() => void api.openExplorer(wt.path)}
        >
          <FolderOpen className="size-4" />
        </Button>
      </Hint>
      <Hint label={t("projects.worktrees.openTerminal")}>
        <Button
          size="icon"
          variant="ghost"
          className="size-7 opacity-60 group-hover:opacity-100"
          onClick={() =>
            void api
              .openTerminal(terminalCmd, wt.path)
              .catch((e) =>
                onStatus(i18nT("projects.worktrees.terminalLaunchFailed", { error: String(e) })),
              )
          }
        >
          <SquareTerminal className="size-4" />
        </Button>
      </Hint>
      <Hint label={t("projects.worktrees.removeWorktree")} disabled={busy}>
        <Button
          size="icon"
          variant="ghost"
          className="size-7 text-muted-foreground opacity-60 hover:text-destructive group-hover:opacity-100"
          disabled={busy}
          onClick={onRemove}
        >
          <Trash2 className="size-4" />
        </Button>
      </Hint>
    </div>
  );
}

function RemoveDialog({
  target,
  onChange,
  onCancel,
  onConfirm,
}: {
  target: RemoveTarget | null;
  onChange: (t: RemoveTarget) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  const wt = target?.wt;
  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("projects.worktrees.removeWorktree")}</DialogTitle>
          <DialogDescription>
            {wt && (
              <>
                <code className="text-xs">{wt.path}</code>
                {wt.branch && (
                  <>
                    {" "}
                    {t("projects.worktrees.onBranch")} <code className="text-xs">{wt.branch}</code>
                  </>
                )}
                .
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        {target && (
          <div className="space-y-3 text-sm">
            {wt?.dirty && (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                {t("projects.worktrees.dirtyWarning")}
              </p>
            )}
            <label className={cn("flex items-center gap-2", wt?.dirty && "opacity-70")}>
              <Checkbox
                checked={target.force}
                disabled={wt?.dirty}
                onCheckedChange={(v) => onChange({ ...target, force: v === true || !!wt?.dirty })}
              />
              {t("projects.worktrees.forceRemoval")}
            </label>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={target.deleteBranch}
                disabled={!wt?.branch}
                onCheckedChange={(v) => onChange({ ...target, deleteBranch: v === true })}
              />
              {t("projects.worktrees.alsoDeleteBranch")}{" "}
              {wt?.branch ? (
                <code className="text-xs">{wt.branch}</code>
              ) : (
                t("projects.worktrees.none")
              )}
            </label>
            {target.deleteBranch && (
              <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                {t("projects.worktrees.deleteBranchWarning")}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            {t("projects.worktrees.cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={!!wt?.dirty && !target?.force}
            onClick={onConfirm}
          >
            {t("projects.worktrees.remove")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
