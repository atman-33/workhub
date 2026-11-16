import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  Archive,
  ArchiveRestore,
  ArrowUpDown,
  CircleAlert,
  CircleCheck,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Info,
  List,
  ListTodo,
  Shapes,
  RefreshCw,
} from "lucide-react";
import { Hint } from "@/components/ui/hint";
import { CopyPromptButton } from "@/components/copy-prompt-button";
import { ConfirmDialog } from "@/components/graph/confirm-dialog";
import { ProjectBacklog } from "@/components/projects/project-backlog";
import { ProjectCombobox } from "@/components/projects/project-combobox";
import { ProjectDocuments } from "@/components/projects/project-documents";
import { ProjectListDialog } from "@/components/projects/project-list-dialog";
import { ProjectCreateDialog } from "@/components/schedule/project-create-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, timeAgo } from "@/lib/api";
import { useConfig } from "@/lib/use-config";
import { useT } from "@/lib/i18n";
import { BACKLOG_STATUSES } from "@/lib/project-backlog";
import {
  DESCRIPTION_MAX_HEIGHT_PX,
  clampAutoGrowHeight,
  isTruncatedExcerpt,
} from "@/lib/project-description";
import {
  TASK_STATUSES,
  buildProjectFixPrompt,
  buildSharedSpaceSurveyPrompt,
  isSurveyStale,
  issueLabel,
  linkedRepos,
  readProjectSortMode,
  sortProjectsByMode,
  taskCountsByProject,
  unknownProjects,
  writeProjectSortMode,
  type ProjectOrderWrite,
  type ProjectSortMode,
} from "@/lib/vault-project";
import {
  readLastVaultPath,
  readViewState,
  writeLastVaultPath,
  writeViewState,
} from "@/lib/view-state";
import { cn } from "@/lib/utils";
import type { Task, VaultProject } from "@/types";

/**
 * The Projects tab (T-0190).
 *
 * Schedule and Mindmap both start from `projects/<slug>/`, but until this tab
 * there was no screen for the project itself — no way to see what a project
 * folder holds, to create or retire one, or to notice that the vault's layout
 * conventions had quietly stopped being followed.
 *
 * The tab's main job is therefore *reconciliation*, not CRUD:
 *
 * - the folder against the layout documented in the vault's CLAUDE.md
 *   (findings come from the backend scan);
 * - the tasks against the projects — a task's `project:` is free text, so a
 *   typo silently orphans it, and that is shown here rather than never;
 * - the projects against the registered repositories, which do not share a
 *   naming scheme with them and never will.
 *
 * There is no delete. A project folder holds months of hand-written prose, so
 * the only removal is an archive to `archive/projects/<slug>/`, undone from
 * the same screen.
 */

/** Sentinel for the repo picker — Radix rejects an empty string as a value. */
const NO_REPO = "__none__";

/** Where the four navigation buttons hand off to. */
export type ProjectTarget = "tasks" | "diagrams" | "repos";

interface Props {
  /** Whether the Projects tab is the visible one; gates the reload on focus. */
  active: boolean;
  /** Opens another tab focused on this project (or, for `repos`, on the
   * repository path it is linked to). `path` selects one diagram note inside
   * the Diagrams tab (T-0715); every other target ignores it. */
  onNavigate: (target: ProjectTarget, value: string, path?: string) => void;
  /** Called after this view creates, archives or restores a project, so the
   * project pickers in the other tabs reload. The watcher's
   * `projects-changed` event reports the same thing for writers outside the
   * app; this is the deterministic path for the app's own actions. */
  onProjectsChange?: () => void;
}

/** Sentinel for the status filter — Radix rejects an empty string as a value. */
const ALL_BACKLOG_STATUSES = "__all__";

/** The `view-state` slot this tab's selection is remembered in (T-0997). */
const VIEW_ID = "projects";

export function ProjectsView({
  active,
  onNavigate,
  onProjectsChange,
}: Props) {
  const t = useT();
  const config = useConfig();
  const [projects, setProjects] = useState<VaultProject[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  // The last selected project, remembered per machine and restored on the
  // next launch (T-0997) — the same `view-state` slot the Schedule, Mindmap
  // and Diagrams tabs keep their picker in, not a new mechanism.
  const [slug, setSlug] = useState(() => readViewState(VIEW_ID).project);
  /** Set after the first successful load, so the fallback below does not run
   *  against the initial empty list and wipe a restored selection. */
  const [loaded, setLoaded] = useState(false);
  // The full list lives in a dialog now (T-0997); the combobox up top is the
  // main route, this is where a project is managed, not just chosen.
  const [listDialogOpen, setListDialogOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [editName, setEditName] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [editAlias, setEditAlias] = useState("");
  // Persisted per machine (T-0278) — this is how the owner likes to look at
  // the list, not anything about the vault's content.
  const [sortMode, setSortMode] = useState<ProjectSortMode>(() => readProjectSortMode());
  // Which slice of the detail pane is showing (T-0714, backlog in T-0715).
  // Kept across projects — the panes themselves are remounted per project,
  // so no document leaks over.
  const [pane, setPane] = useState<"overview" | "documents" | "backlog">("overview");
  // Panes visited so far (T-1005): a visited pane stays mounted and is only
  // hidden, so the selected item and file survive tab switches.
  const [visited, setVisited] = useState({ overview: true, documents: false, backlog: false });
  useEffect(() => {
    setVisited((v) => (v[pane] ? v : { ...v, [pane]: true }));
  }, [pane]);
  // Controls that live in the tab row but act on the Documents / Backlog
  // panes (T-0813): the Refresh button and the Backlog status filter.
  const [paneRefresh, setPaneRefresh] = useState(0);
  const [paneLoading, setPaneLoading] = useState(false);
  const [backlogStatusFilter, setBacklogStatusFilter] = useState("");

  const vaultPath = config?.settings.vault_path ?? null;
  const repos = config?.projects ?? [];
  // Held in a ref because the app shell passes a fresh arrow every render;
  // depending on it directly would rebuild every callback below on each one.
  const onProjectsChangeRef = useRef(onProjectsChange);
  onProjectsChangeRef.current = onProjectsChange;

  const load = useCallback(async () => {
    if (!vaultPath) return;
    setError("");
    try {
      const [found, allTasks] = await Promise.all([
        api.listVaultProjects(vaultPath, true),
        api.listTasks(vaultPath),
      ]);
      setProjects(found);
      setTasks(allTasks);
      setLoaded(true);
    } catch (e) {
      setError(String(e));
    }
  }, [vaultPath]);

  // A vault switch must not inherit the old vault's selection: a slug is only
  // unique within its vault, so restoring it blindly can land on a different
  // project that happens to share the name. Same-vault restarts keep
  // restoring — only a changed vault clears (Schedule/Mindmap/Diagrams do the
  // same for their notes, T-0344).
  useEffect(() => {
    if (!vaultPath) return;
    if (readLastVaultPath() !== vaultPath) setSlug("");
    writeLastVaultPath(vaultPath);
  }, [vaultPath]);

  /** An explicit selection: switch the detail pane and remember it for the
   *  next launch. Filtering (combobox or dialog input) never comes through
   *  here, so typing cannot move the detail pane. */
  const selectProject = useCallback((next: string) => {
    setSlug(next);
    writeViewState(VIEW_ID, "project", next);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Obsidian and agents write these folders too. Re-read when the tab is
  // brought forward (a note edited in Obsidian changes a folder's counts and
  // its last-touched time, which no event reports), and again whenever a
  // project folder itself appears or disappears.
  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  useEffect(() => {
    const unlisten = listen("projects-changed", () => void load());
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [load]);

  const counts = useMemo(() => taskCountsByProject(tasks), [tasks]);
  const orphans = useMemo(
    () => unknownProjects(tasks, projects),
    [tasks, projects],
  );

  // The ordered list feeds both pickers (T-0997). Text filtering happens inside
  // the combobox dropdown and the list dialog, never here, so typing cannot
  // switch the detail pane — only the Archived toggle narrows this.
  const ordered = useMemo(() => {
    const matched = projects.filter((p) => {
      if (p.archived && !showArchived) return false;
      return true;
    });
    // The backend already returns "order" mode in this order; sorting again
    // keeps the list right when a pin or a drag is applied to the local array
    // (T-0231), and is what applies "name" mode at all (T-0278).
    return sortProjectsByMode(matched, sortMode);
  }, [projects, showArchived, sortMode]);

  // Drag-reorder needs positions, which "name" mode does not have (T-0278).
  // A filtered list hides rows between the ones on screen, so the dialog
  // additionally disables drops while its own filter is non-empty.
  const reorderable = sortMode === "order";
  const activeOrdered = useMemo(() => ordered.filter((p) => !p.archived), [ordered]);
  const archivedOrdered = useMemo(() => ordered.filter((p) => p.archived), [ordered]);

  // Keep a selection as the list reloads: an empty detail pane beside a
  // populated list is a click the user never wants to make. A stored slug the
  // vault no longer holds falls back to the first project and is remembered
  // as such; an empty vault keeps the slug untouched.
  useEffect(() => {
    if (!loaded || projects.length === 0) return;
    if (!ordered.some((p) => p.slug === slug)) {
      selectProject(ordered[0]?.slug ?? "");
    }
  }, [loaded, projects, ordered, slug, selectProject]);

  const current = ordered.find((p) => p.slug === slug) ?? null;
  /** One instant for every staleness check on the screen, refreshed when the
   * project list is — a shared space does not go stale between two renders,
   * and a per-row `new Date()` would make the memo below re-run forever. */
  const now = useMemo(() => new Date(), [projects]);
  useEffect(() => {
    if (!current) return;
    setEditName(current.name);
    setEditSummary(current.summary);
  }, [current?.slug, current?.name, current?.summary]);
  // The Description field holds one line of frontmatter or the whole first
  // README paragraph (cut with "…" only past the backend's SUMMARY_CHARS
  // safety net), never the whole README — so it grows with its content up to
  // a ceiling, past which it scrolls instead (T-0713, full paragraph in
  // T-0736).
  const summaryRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = summaryRef.current;
    if (!el || !current || current.archived) return;
    el.style.height = "auto";
    el.style.height = `${clampAutoGrowHeight(el.scrollHeight)}px`;
    el.style.overflowY =
      el.scrollHeight > DESCRIPTION_MAX_HEIGHT_PX ? "auto" : "hidden";
    // `pane` matters because the Description editor lives in the Overview
    // pane (T-0737): switching back from another tab remounts the textarea,
    // and without this the restored height collapses to a single line.
  }, [editSummary, pane, current?.slug, current?.archived]);
  useEffect(() => {
    if (!current) return;
    setEditAlias(current.alias);
  }, [current?.slug, current?.alias]);
  const currentRepos = useMemo(
    () => (current ? linkedRepos(current, repos) : []),
    [current, repos],
  );
  /** The project's default repository — the first entry that still resolves.
   *  A stale entry at the head should not disable the Repo button when the
   *  project links to a registered repo further down the list. */
  const defaultRepo = currentRepos.find((l) => l.repo)?.repo ?? null;
  // Only repos this project does not already link to are offered, so the
  // picker cannot produce a duplicate entry.
  const addableRepos = useMemo(
    () => repos.filter((r) => !currentRepos.some((l) => l.repo?.path === r.path)),
    [repos, currentRepos],
  );
  const currentCounts = current ? counts.get(current.slug) : undefined;
  // The scan already told us whether the entry point exists; Obsidian's URL
  // scheme opens files, not folders, so a project with no README falls back to
  // Explorer instead of opening nothing.
  const hasReadme =
    !!current &&
    !current.issues.some((i) => i.kind === "missing-file" && i.target === "README.md");

  /** Re-reads the vault and tells the other tabs' project pickers to do the
   * same. Every mutation this view performs ends here. */
  const refresh = useCallback(async () => {
    await load();
    onProjectsChangeRef.current?.();
  }, [load]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setError("");
    setStatus(label);
    try {
      await fn();
      await refresh();
      setStatus("");
    } catch (e) {
      setStatus("");
      setError(String(e));
    }
  };

  /** Writes the whole `repos:` list back; every edit below is a list rewrite
   *  rather than a per-entry command, because order carries meaning (the first
   *  entry is the project's default repository) and a partial update would
   *  leave it ambiguous. */
  const saveRepos = (entries: string[]) => {
    if (!vaultPath || !current) return;
    void run(t("projects.view.statusLinking"), async () => {
      await api.setVaultProjectRepos(vaultPath, current.slug, entries);
    });
  };

  const currentEntries = () => currentRepos.map((l) => l.entry);

  const addRepo = (value: string) => {
    if (value === NO_REPO) return;
    saveRepos([...currentEntries(), value]);
  };

  const removeRepo = (at: number) => {
    saveRepos(currentEntries().filter((_, i) => i !== at));
  };

  /** Promotes an entry one place; from index 1 that makes it the default. */
  const promoteRepo = (at: number) => {
    if (at <= 0) return;
    const next = currentEntries();
    [next[at - 1], next[at]] = [next[at], next[at - 1]];
    saveRepos(next);
  };

  /**
   * Applies the writes one pin or one drop implies.
   *
   * The local array is updated first and the vault written after: the list is
   * what the user just dragged, and waiting a file write and a rescan before
   * the row moves makes the drag feel like it failed. `refresh()` then
   * replaces the optimistic state with what is actually on disk.
   */
  const applyOrder = (writes: ProjectOrderWrite[]) => {
    if (!vaultPath || writes.length === 0) return;
    const by = new Map(writes.map((w) => [w.slug, w]));
    setProjects((prev) =>
      prev.map((p) => {
        const w = by.get(p.slug);
        return w ? { ...p, pinned: w.pinned, order: w.order } : p;
      }),
    );
    void run(t("projects.view.statusReordering"), async () => {
      for (const w of writes) {
        await api.setVaultProjectOrder(vaultPath, w.slug, w.pinned, w.order);
      }
    });
  };

  /** A star click. The position is left alone, so unpinning drops the project
   *  back where its own `order` puts it rather than at the end of the list. */
  const togglePin = (project: VaultProject) => {
    applyOrder([
      { slug: project.slug, pinned: !project.pinned, order: project.order },
    ]);
  };

  const detailsDirty =
    !!current &&
    (editName.trim() !== current.name || editSummary.trim() !== current.summary);

  const saveDetails = () => {
    if (!vaultPath || !current || current.archived) return;
    const name = editName.trim();
    if (!name) return;
    void run(t("projects.view.statusSaving"), async () => {
      await api.setVaultProjectDetails(
        vaultPath,
        current.slug,
        name,
        editSummary.trim(),
      );
    });
  };

  const aliasDirty = !!current && editAlias.trim() !== current.alias;

  /** The backend owns the format and uniqueness rules; a rejection comes back
   * through `run` and shows in the same error line as every other write. */
  const saveAlias = () => {
    if (!vaultPath || !current || current.archived) return;
    void run(t("projects.view.statusSavingAlias"), async () => {
      await api.setVaultProjectAlias(vaultPath, current.slug, editAlias.trim());
    });
  };

  if (!vaultPath) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        {t("projects.view.noVault")}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Unified picker + pane switcher (T-0999, 案B): the project combobox
        and the Overview/Documents/Backlog tabs share this row, so the backlog
        pane gains a full row of height. List controls (archived toggle, sort,
        list reload) move to the sub-header below. */}
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-1.5">
        <Hint label={t("projects.view.projectList")}>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 px-2"
            aria-label={t("projects.view.projectList")}
            onClick={() => setListDialogOpen(true)}
          >
            <List className="size-3.5" />
          </Button>
        </Hint>
        <ProjectCombobox
          active={activeOrdered}
          archived={archivedOrdered}
          selected={slug}
          onSelect={selectProject}
        />
        {current && (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="sm"
              variant={pane === "overview" ? "secondary" : "ghost"}
              className="h-8"
              onClick={() => setPane("overview")}
            >
              {t("projects.view.overviewTab")}
            </Button>
            <Button
              size="sm"
              variant={pane === "documents" ? "secondary" : "ghost"}
              className="h-8"
              onClick={() => setPane("documents")}
            >
              {t("projects.view.documentsTab")}
            </Button>
            <Button
              size="sm"
              variant={pane === "backlog" ? "secondary" : "ghost"}
              className="h-8"
              onClick={() => setPane("backlog")}
            >
              {t("projects.view.backlogTab")}
            </Button>
          </div>
        )}
        {/* Overview has no Refresh of its own: its content is the
          project list, which the sub-header's reload button refreshes. */}
        {current && pane !== "overview" && (
          <div className="flex shrink-0 items-center gap-2">
            {pane === "backlog" && (
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                {t("projects.view.backlog.filterLabel")}
                <Select
                  value={backlogStatusFilter || ALL_BACKLOG_STATUSES}
                  onValueChange={(v) =>
                    setBacklogStatusFilter(v === ALL_BACKLOG_STATUSES ? "" : v)
                  }
                >
                  <SelectTrigger
                    size="sm"
                    className="h-6 w-28 px-2 py-0 text-[11px] data-[size=sm]:h-6 [&_svg:not([class*='size-'])]:size-3"
                  >
                    <SelectValue placeholder={t("projects.view.backlog.filterAll")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_BACKLOG_STATUSES}>
                      {t("projects.view.backlog.filterAll")}
                    </SelectItem>
                    {BACKLOG_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-6 gap-1.5"
              disabled={paneLoading}
              onClick={() => setPaneRefresh((n) => n + 1)}
            >
              <RefreshCw className={cn("size-3.5", paneLoading && "animate-spin")} />
              {t("projects.view.refresh")}
            </Button>
          </div>
        )}
        <Button size="sm" className="ml-auto h-8 gap-1.5" onClick={() => setCreateOpen(true)}>
          <FolderPlus className="size-3.5" />
          {t("projects.view.newProject")}
        </Button>
      </div>

      {(error || status) && (
        <div
          className={cn(
            "border-b px-3 py-1 text-xs",
            error ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {error || status}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {!current ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t("projects.view.selectProject")}
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col">
              {/* Sub-header (T-0999, 案B): the name (read-only here — editing
                lives in the Overview pane below), the status and update time,
                and icon-only navigation with tooltips. One compact row; every
                destination stays reachable. */}
              <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-1">
                <h2 className="mr-1 min-w-0 truncate text-base font-semibold">
                  {current.name}
                </h2>
                {current.status && (
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {t("projects.view.statusLabel", { status: current.status })}
                  </span>
                )}
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {t("projects.view.updatedLabel", {
                    time: current.updated ? timeAgo(current.updated) : "—",
                  })}
                </span>
                <div className="ml-auto flex flex-wrap items-center gap-1">
                  <Hint label={t("projects.view.archivedToggle")}>
                    <Button
                      size="sm"
                      variant={showArchived ? "secondary" : "ghost"}
                      className="h-6 w-6 p-0"
                      aria-label={t("projects.view.archivedToggle")}
                      onClick={() => setShowArchived((v) => !v)}
                    >
                      <Archive className="size-3.5" />
                    </Button>
                  </Hint>
                  <Hint
                    label={
                      sortMode === "order"
                        ? t("projects.view.sortByPosition")
                        : t("projects.view.sortByName")
                    }
                  >
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 gap-1 px-2"
                      aria-label={
                        sortMode === "order"
                          ? t("projects.view.sortByPosition")
                          : t("projects.view.sortByName")
                      }
                      onClick={() => {
                        const next = sortMode === "order" ? "name" : "order";
                        setSortMode(next);
                        writeProjectSortMode(next);
                      }}
                    >
                      <ArrowUpDown className="size-3.5" />
                      {sortMode === "order" ? t("projects.view.sortOrder") : t("projects.view.sortName")}
                    </Button>
                  </Hint>
                  <Hint label={t("projects.view.refresh")}>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0"
                      aria-label={t("projects.view.refresh")}
                      onClick={() => void load()}
                    >
                      <RefreshCw className="size-3.5" />
                    </Button>
                  </Hint>
                  <span className="mx-0.5 h-4 w-px shrink-0 bg-border" aria-hidden="true" />
                  <Hint
                    label={hasReadme ? t("projects.view.openReadme") : t("projects.view.openFolder")}
                  >
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 w-6 p-0"
                      aria-label={hasReadme ? t("projects.view.openReadme") : t("projects.view.openFolder")}
                      onClick={() => {
                        if (hasReadme) void api.openInObsidian(`${current.path}/README.md`);
                        else void api.openExplorer(current.path);
                      }}
                    >
                      <FolderOpen className="size-3.5" />
                    </Button>
                  </Hint>
                  <Hint label={t("projects.view.tasksButton")}>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 w-6 p-0"
                      aria-label={t("projects.view.tasksButton")}
                      onClick={() => onNavigate("tasks", current.slug)}
                    >
                      <ListTodo className="size-3.5" />
                    </Button>
                  </Hint>
                  <Hint label={t("projects.view.diagramsButton")}>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 w-6 p-0"
                      aria-label={t("projects.view.diagramsButton")}
                      onClick={() => onNavigate("diagrams", current.slug)}
                    >
                      <Shapes className="size-3.5" />
                    </Button>
                  </Hint>
                  <Hint label={t("projects.view.repoButton")}>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 w-6 p-0"
                      aria-label={t("projects.view.repoButton")}
                      disabled={!defaultRepo}
                      onClick={() => defaultRepo && onNavigate("repos", defaultRepo.path)}
                    >
                      <GitBranch className="size-3.5" />
                    </Button>
                  </Hint>
                  <Hint
                    label={current.archived ? t("projects.view.restore") : t("projects.view.archive")}
                  >
                    <Button
                      size="sm"
                      variant={current.archived ? "outline" : "ghost"}
                      className="h-6 w-6 p-0"
                      aria-label={current.archived ? t("projects.view.restore") : t("projects.view.archive")}
                      onClick={() => setArchiveOpen(true)}
                    >
                      {current.archived ? (
                        <ArchiveRestore className="size-3.5" />
                      ) : (
                        <Archive className="size-3.5" />
                      )}
                    </Button>
                  </Hint>
                </div>
              </div>

              {/* Pane switcher lives in the unified row above (T-0999) — this
                space is gone, and the backlog pane below gains its height. */}

              {/* Panes stay mounted once visited (T-1005): switching tabs
                hides instead of unmounting, so the selected item and file
                survive. `key={slug}` still remounts everything on a project
                switch, so no document leaks over. Overview scrolls as a page,
                while Documents / Backlog scroll inside themselves (T-0737). */}
              <div className="min-h-0 flex-1 px-4 pb-4 pt-2">
                {visited.documents && (
                  <div
                    className={cn(
                      "h-full min-h-0 overflow-hidden",
                      pane !== "documents" && "hidden",
                    )}
                  >
                    <ProjectDocuments
                      key={current.slug}
                      vaultPath={vaultPath}
                      slug={current.slug}
                      refreshToken={paneRefresh}
                      onLoadingChange={setPaneLoading}
                      onOpenDiagrams={(diagramPath) => onNavigate("diagrams", current.slug, diagramPath)}
                    />
                  </div>
                )}
                {visited.backlog && (
                  <div
                    className={cn(
                      "h-full min-h-0 overflow-hidden",
                      pane !== "backlog" && "hidden",
                    )}
                  >
                    <ProjectBacklog
                      key={current.slug}
                      vaultPath={vaultPath}
                      slug={current.slug}
                      fallbackDir={current.path}
                      tasks={tasks}
                      refreshToken={paneRefresh}
                      statusFilter={backlogStatusFilter}
                      onLoadingChange={setPaneLoading}
                      onOpenDiagrams={(diagramPath) => onNavigate("diagrams", current.slug, diagramPath)}
                    />
                  </div>
                )}
                <div
                  className={cn(
                    "h-full min-h-0",
                    pane === "overview" ? "overflow-y-auto" : "hidden",
                  )}
                >
                  <div className="space-y-4">
                    {/* The heading already shows in the fixed header above, so
                      an archived project shows its description here with no
                      editing fields, as before. */}
                    {current.archived ? (
                      <>
                        {current.summary && (
                          <p
                            className="text-sm"
                            title={
                              isTruncatedExcerpt(current.summary)
                                ? t("projects.view.descriptionTruncatedHint")
                                : undefined
                            }
                          >
                            {current.summary}
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                    <label className="block space-y-1">
                      <span className="text-xs text-muted-foreground">{t("projects.view.name")}</span>
                      <Input
                        value={editName}
                        className="h-8 text-sm font-semibold"
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveDetails();
                        }}
                      />
                    </label>
                    <label className="mt-2 block space-y-1">
                      <span className="text-xs text-muted-foreground">
                        {t("projects.view.description")}
                      </span>
                      <Textarea
                        ref={summaryRef}
                        value={editSummary}
                        placeholder={t("projects.view.descriptionPlaceholder")}
                        title={
                          isTruncatedExcerpt(editSummary)
                            ? t("projects.view.descriptionTruncatedHint")
                            : undefined
                        }
                        className="max-h-48 resize-none overflow-y-auto text-sm"
                        onChange={(e) => setEditSummary(e.target.value)}
                      />
                      {isTruncatedExcerpt(editSummary) && (
                        <span className="block text-[11px] text-muted-foreground">
                          {t("projects.view.descriptionTruncatedHint")}
                        </span>
                      )}
                    </label>
                    <div className="mt-2 flex items-center gap-2">
                      <Button
                        size="sm"
                        className="h-7"
                        disabled={!detailsDirty || !editName.trim()}
                        onClick={saveDetails}
                      >
                        {t("projects.view.save")}
                      </Button>
                      {detailsDirty && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7"
                          onClick={() => {
                            setEditName(current.name);
                            setEditSummary(current.summary);
                          }}
                        >
                          {t("projects.view.cancel")}
                        </Button>
                      )}
                    </div>
                    <label className="mt-3 block space-y-1">
                      <span className="text-xs text-muted-foreground">{t("projects.view.alias")}</span>
                      <div className="flex items-center gap-2">
                        <Input
                          value={editAlias}
                          placeholder={t("projects.view.aliasPlaceholder")}
                          className="h-8 max-w-64 font-mono text-sm"
                          onChange={(e) => setEditAlias(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveAlias();
                          }}
                        />
                        <Button
                          size="sm"
                          className="h-7"
                          disabled={!aliasDirty}
                          onClick={saveAlias}
                        >
                          {t("projects.view.save")}
                        </Button>
                        {aliasDirty && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7"
                            onClick={() => setEditAlias(current.alias)}
                          >
                            {t("projects.view.cancel")}
                          </Button>
                        )}
                      </div>
                      <span className="block text-[11px] text-muted-foreground">
                        {t("projects.view.aliasHelp")}
                      </span>
                    </label>
                  </>
                )}
                <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                  {current.path}
                </p>
              <section className="space-y-1.5">
                <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                  {t("projects.view.repositoriesHeading")}
                </h3>
                {currentRepos.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t("projects.view.noRepository")}</p>
                ) : (
                  <ul className="space-y-1">
                    {currentRepos.map((link, i) => (
                      <li key={link.entry} className="flex items-center gap-2 text-xs">
                        <span className="w-10 shrink-0 text-[10px] uppercase text-muted-foreground">
                          {i === 0 ? t("projects.view.defaultLabel") : ""}
                        </span>
                        {link.repo ? (
                          <span className="truncate">{link.repo.name}</span>
                        ) : (
                          <span className="truncate text-destructive">
                            {t("projects.view.unregisteredRepo", { entry: link.entry })}
                          </span>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-[11px]"
                          disabled={current.archived || i === 0}
                          onClick={() => promoteRepo(i)}
                          title={t("projects.view.moveUpTitle")}
                        >
                          {t("projects.view.up")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-[11px]"
                          disabled={current.archived}
                          onClick={() => removeRepo(i)}
                          title={t("projects.view.unlinkTitle")}
                        >
                          {t("projects.view.remove")}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                {addableRepos.length > 0 && (
                  <Select
                    value={NO_REPO}
                    onValueChange={addRepo}
                    disabled={current.archived}
                  >
                    <SelectTrigger className="h-8 max-w-96 text-xs">
                      <SelectValue placeholder={t("projects.view.addRepoPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_REPO}>{t("projects.view.addRepoPlaceholder")}</SelectItem>
                      {addableRepos.map((r) => (
                        <SelectItem key={r.path} value={r.path}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <p className="text-[11px] text-muted-foreground">
                  {t("projects.view.reposHelpPrefix")} <span className="font-mono">repos:</span>{" "}
                  {t("projects.view.reposHelpMid")}{" "}
                  <span className="font-mono">_index.md</span>
                  {t("projects.view.reposHelpSuffix")}
                </p>
              </section>

              <section className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                    {t("projects.view.sharedSpacesHeading")}
                  </h3>
                  <CopyPromptButton
                    showLabel
                    label={t("projects.view.copySurveyPrompt")}
                    onCopy={() => writeText(buildSharedSpaceSurveyPrompt(current, config?.settings.language))}
                  />
                </div>
                {current.shared.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t("projects.view.noSharedSpace")}
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {current.shared.map((space) => (
                      <li key={space.name} className="flex items-center gap-2 text-xs">
                        <span className="truncate">{space.title}</span>
                        {space.kind && (
                          <span className="shrink-0 rounded bg-muted px-1 text-[10px] uppercase text-muted-foreground">
                            {space.kind}
                          </span>
                        )}
                        <span
                          className={cn(
                            "shrink-0 rounded px-1 text-[10px] uppercase",
                            space.direction === "export-ok"
                              ? "bg-muted text-muted-foreground"
                              : "bg-muted font-medium text-foreground",
                          )}
                          title={
                            space.direction === "export-ok"
                              ? t("projects.view.exportOkTitle")
                              : t("projects.view.readOnlyTitle")
                          }
                        >
                          {space.direction}
                        </span>
                        <span className="truncate font-mono text-[11px] text-muted-foreground">
                          {space.location}
                        </span>
                        {isSurveyStale(space.surveyed, now) && (
                          <span
                            className="shrink-0 text-[10px] uppercase text-muted-foreground"
                            title={
                              space.surveyed
                                ? t("projects.view.staleTitleChecked", { date: space.surveyed })
                                : t("projects.view.staleTitleNever")
                            }
                          >
                            {t("projects.view.staleLabel")}
                          </span>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-auto h-6 shrink-0 px-1.5 text-[11px]"
                          onClick={() => void api.openInObsidian(space.path)}
                          title={t("projects.view.openNoteTitle")}
                        >
                          {t("projects.view.open")}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-[11px] text-muted-foreground">
                  {t("projects.view.sharedSpacesHelpPrefix")}{" "}
                  <span className="font-mono">shared/</span> {t("projects.view.sharedSpacesHelpMid")}{" "}
                  <span className="text-foreground">{t("projects.view.copySurveyPrompt")}</span>{" "}
                  {t("projects.view.sharedSpacesHelpSuffix")}
                </p>
              </section>

              <section className="space-y-1.5">
                <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                  {t("projects.view.tasksHeading")}
                </h3>
                {currentCounts ? (
                  <div className="flex flex-wrap gap-3 text-xs">
                    {TASK_STATUSES.map((s) => (
                      <span key={s} className="text-muted-foreground">
                        {s} <span className="font-medium text-foreground">{currentCounts[s]}</span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t("projects.view.noTaskProjectPrefix")}{" "}
                    <span className="font-mono">project:</span>{" "}
                    {t("projects.view.noTaskProjectSuffix")}
                  </p>
                )}
              </section>

              <section className="space-y-1.5">
                <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                  {t("projects.view.contentsHeading")}
                </h3>
                {current.folders.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t("projects.view.noSubfolders")}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {current.folders.map((f) => (
                      <span
                        key={f.name}
                        className={cn(
                          "rounded border px-2 py-0.5 text-[11px]",
                          f.known ? "text-muted-foreground" : "border-dashed text-foreground",
                        )}
                      >
                        <span className="font-mono">{f.name}/</span> {f.count}
                      </span>
                    ))}
                  </div>
                )}
              </section>

              <section className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                    {t("projects.view.layoutFindingsHeading")}
                  </h3>
                  {current.issues.length > 0 && (
                    <CopyPromptButton
                      showLabel
                      label={t("projects.view.copyFixPrompt")}
                      onCopy={() => writeText(buildProjectFixPrompt(current, config?.settings.language))}
                    />
                  )}
                </div>
                {current.issues.length === 0 ? (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CircleCheck className="size-3.5" />
                    {t("projects.view.layoutMatches")}
                  </p>
                ) : (
                  <>
                    <ul className="space-y-1">
                      {current.issues.map((issue, i) => (
                        <li
                          key={`${issue.kind}-${issue.target}-${i}`}
                          className={cn(
                            "flex items-center gap-1.5 text-xs",
                            issue.severity === "warn"
                              ? "text-destructive"
                              : "text-muted-foreground",
                          )}
                        >
                          {issue.severity === "warn" ? (
                            <CircleAlert className="size-3.5 shrink-0" />
                          ) : (
                            <Info className="size-3.5 shrink-0" />
                          )}
                          {issueLabel(issue)}
                        </li>
                      ))}
                    </ul>
                    <p className="text-[11px] text-muted-foreground">
                      {t("projects.view.layoutFindingsHelpPrefix")}{" "}
                      <span className="text-foreground">{t("projects.view.copyFixPrompt")}</span>{" "}
                      {t("projects.view.layoutFindingsHelpSuffix")}
                    </p>
                  </>
                )}
              </section>
                  </div>
                </div>
            </div>
            </div>
          )}
      </div>

      <ProjectListDialog
        open={listDialogOpen}
        onOpenChange={setListDialogOpen}
        active={activeOrdered}
        archived={archivedOrdered}
        selected={slug}
        counts={counts}
        reorderable={reorderable}
        orphans={orphans}
        onSelect={selectProject}
        onTogglePin={togglePin}
        onMove={applyOrder}
      />
      <ProjectCreateDialog
        vaultPath={vaultPath}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(created) => {
          selectProject(created);
          void refresh();
        }}
      />
      {current && (
        <ConfirmDialog
          open={archiveOpen}
          title={
            current.archived ? t("projects.view.restoreTitle") : t("projects.view.archiveTitle")
          }
          description={
            current.archived
              ? t("projects.view.restoreDescription", { slug: current.slug })
              : t("projects.view.archiveDescription", { slug: current.slug })
          }
          confirmLabel={current.archived ? t("projects.view.restore") : t("projects.view.archive")}
          onClose={() => setArchiveOpen(false)}
          onConfirm={() => {
            setArchiveOpen(false);
            const target = current;
            const label = target.archived
              ? t("projects.view.statusRestoring")
              : t("projects.view.statusArchiving");
            void run(label, async () => {
              if (target.archived) await api.restoreVaultProject(vaultPath, target.slug);
              else await api.archiveVaultProject(vaultPath, target.slug);
            });
          }}
        />
      )}
    </div>
  );
}
