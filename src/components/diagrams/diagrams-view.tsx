import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ChevronDown, ChevronRight, FolderPlus, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/graph/confirm-dialog";
import { DiagramAiPanel } from "@/components/diagram/diagram-ai-panel";
import { DiagramAiSettings } from "@/components/diagram/diagram-ai-settings";
import { PanelToggle } from "@/components/diagram/panel-frame";
import { FlowView } from "@/components/diagram/flow/flow-view";
import { PfdView } from "@/components/diagram/pfd/pfd-view";
import { AlgorithmView } from "@/components/diagram/algorithm/algorithm-view";
import { ArchitectureView } from "@/components/diagram/architecture/architecture-view";
import { IfdamView } from "@/components/diagram/ifdam/ifdam-view";
import { UsecaseView } from "@/components/diagram/usecase/usecase-view";
import { MatrixView } from "@/components/diagram/matrix2x2/matrix-view";
import { MindmapView } from "@/components/mindmap/mindmap-view";
import { ProjectCreateDialog } from "@/components/schedule/project-create-dialog";
import { ScheduleView } from "@/components/schedule/schedule-view";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import {
  CREATABLE_KINDS,
  KIND_ICON,
  KIND_LABEL_KEY,
  SIMPLE_KINDS,
  backlogOfScope,
  hasEditor,
  isDiagramKind,
  type DiagramKind,
} from "@/lib/diagram-kinds";
import {
  ALL_KINDS,
  chipGroups,
  isCollapsed,
  listedFiles,
  sectionsOf,
  updatedDay,
  withCollapsed,
  type ListSort,
} from "@/lib/diagram-list";
import { isPanelOpen, withPanelOpen, type PanelSide } from "@/lib/diagram-panels";
import { useT } from "@/lib/i18n";
import type { TabFocus } from "@/lib/tab-focus";
import { projectNumberedLabel, projectOptionsOf } from "@/lib/vault-project";
import { readLastVaultPath, readViewState, writeLastVaultPath, writeViewState } from "@/lib/view-state";
import { shiftDate, toISO, formatRange } from "@/lib/schedule/layout";
import { cn } from "@/lib/utils";
import type { BacklogItem, Config, DiagramEditRun, DiagramFile } from "@/types";

const VIEW_ID = "diagrams";
const KIND_FILTER_KEY = "diagrams.kindFilter";
const ALL = ALL_KINDS;
const NEW_PROJECT = "__new__";
/** Same default window as the Schedule tab: six weeks from today. */
const DEFAULT_RANGE_DAYS = 6 * 7 - 1;

function readKindFilter(): string {
  try {
    const saved = localStorage.getItem(KIND_FILTER_KEY) ?? ALL;
    return saved === ALL || isDiagramKind(saved) ? saved : ALL;
  } catch {
    return ALL;
  }
}

interface Props {
  /** Bumped by the app shell after settings are saved. */
  configVersion: number;
  /** Bumped by the Projects tab after a project is created, archived or restored. */
  projectsVersion?: number;
  /** A project the Projects tab asked this tab to open. */
  focus?: TabFocus;
}

/**
 * The Diagrams tab (T-0680): one place for every kind of diagram of a project.
 *
 * It owns what used to be repeated in the Schedule and Mindmap tabs - the
 * project picker, the note list, create / rename / delete - and hosts the
 * existing editors for the kinds that have one. Which editor opens is decided
 * by the note's frontmatter `type`, not by the folder it sits in.
 */
export function DiagramsView({ configVersion, projectsVersion = 0, focus }: Props) {
  const t = useT();
  const [config, setConfig] = useState<Config | null>(null);
  const [projects, setProjects] = useState<string[]>([]);
  const [projectFolders, setProjectFolders] = useState<Record<string, string>>({});
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [project, setProject] = useState(() => readViewState(VIEW_ID).project);
  const [path, setPath] = useState(() => readViewState(VIEW_ID).path);
  const [kindFilter, setKindFilter] = useState(readKindFilter);
  const [files, setFiles] = useState<DiagramFile[]>([]);
  const [filesLoaded, setFilesLoaded] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [renaming, setRenaming] = useState<DiagramFile | null>(null);
  const [deleting, setDeleting] = useState<DiagramFile | null>(null);
  const [error, setError] = useState("");
  // The AI edit (T-0685) is one runner for every kind of diagram, so its state
  // and panel live here, not in each editor.
  const [aiRun, setAiRun] = useState<DiagramEditRun | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  // Bumped when an AI edit ends or is undone: the editors re-read the note.
  const [reloadToken, setReloadToken] = useState(0);
  // Each editor registers a function that writes its pending save; called
  // before a run so the agent reads what is on screen.
  const flushers = useRef<Record<string, (() => Promise<void>) | null>>({});

  const vaultPath = config?.settings.vault_path ?? null;

  useEffect(() => {
    void api.getConfig().then(setConfig);
  }, [configVersion]);

  /** Settings owned by this tab save immediately. The patch goes onto a fresh
   * read of the config, so a setting another tab changed meanwhile is not
   * reverted (T-0281). */
  const patchSettings = useCallback(async (patch: Partial<Config["settings"]>) => {
    setConfig((c) => (c ? { ...c, settings: { ...c.settings, ...patch } } : c));
    setConfig(await api.patchSettings(patch));
  }, []);

  useEffect(() => {
    void api.diagramEditStatus().then(setAiRun);
    const unlisten = listen<DiagramEditRun>("diagram-edit:status", (e) => setAiRun(e.payload));
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  // While a run is live the agent holds the file: every editor is locked, and
  // the run's end triggers a re-read (the file watcher usually has already).
  const aiRunning = aiRun?.state === "running";
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !aiRunning) setReloadToken((n) => n + 1);
    wasRunning.current = aiRunning;
  }, [aiRunning]);

  // A project handed over by the Projects tab. Keyed on the request counter so
  // a parent re-render never re-applies it over a project picked here since.
  // `focus.path` (T-0715) selects one diagram note — the Backlog pane's "Open
  // in Diagrams tab" — once the listing arrives, since it loads after the
  // project is set.
  const focusN = focus?.n ?? 0;
  const focusProject = focus?.value ?? "";
  const focusPath = focus?.path ?? "";
  useEffect(() => {
    if (focusN > 0 && focusProject) {
      setProject(focusProject);
      if (!focusPath) setPath("");
    }
  }, [focusN, focusProject, focusPath]);
  useEffect(() => {
    if (focusN > 0 && focusPath && filesLoaded && files.some((f) => f.path === focusPath)) {
      setPath(focusPath);
    }
  }, [focusN, focusPath, filesLoaded, files]);

  // A listing that fails is usually a folder that moved while it was read (an
  // archive is a move); one retry lets it settle before falling back to empty.
  const loadFiles = useCallback(
    async (retried = false) => {
      if (!vaultPath) return;
      try {
        setFiles(await api.listDiagrams(vaultPath, project));
        setFilesLoaded(true);
      } catch {
        if (!retried) setTimeout(() => void loadFiles(true), 400);
        else {
          setFiles([]);
          setFilesLoaded(true);
        }
      }
    },
    [vaultPath, project],
  );

  const loadProjects = useCallback(
    async (retried = false) => {
      if (!vaultPath) return;
      try {
        const options = projectOptionsOf(await api.listVaultProjects(vaultPath, false));
        setProjects(options.slugs);
        setProjectFolders(options.folders);
        setProjectsLoaded(true);
      } catch {
        if (!retried) setTimeout(() => void loadProjects(true), 400);
        else {
          setProjects([]);
          setProjectFolders({});
          setProjectsLoaded(true);
        }
      }
      // `projectsVersion` is a reload trigger, not a value read here.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [vaultPath, projectsVersion],
  );

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);
  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  // A vault switch must not inherit the old vault's selection: the stored path
  // is absolute and would keep reading a note in the vault just left behind.
  useEffect(() => {
    if (!vaultPath) return;
    if (readLastVaultPath() !== vaultPath) {
      setProject("");
      setPath("");
    }
    writeLastVaultPath(vaultPath);
  }, [vaultPath]);

  useEffect(() => {
    const subs = [
      listen("projects-changed", () => {
        void loadProjects();
        void loadFiles();
      }),
      listen("diagrams-changed", () => void loadFiles()),
    ];
    return () => {
      for (const sub of subs) void sub.then((fn) => fn());
    };
  }, [loadProjects, loadFiles]);

  // The selected project may be the one that just left.
  useEffect(() => {
    if (projectsLoaded && project && !projects.includes(project)) setProject("");
  }, [projectsLoaded, projects, project]);

  const listSort: ListSort = config?.settings.diagram_list_sort ?? "updated";
  const collapsedKinds = config?.settings.diagram_collapsed_kinds ?? [];
  // The notes in the order the list shows them: grouped by kind under All, one
  // kind flat otherwise (T-0701).
  const visible = useMemo(
    () => listedFiles(files, kindFilter, listSort),
    [files, kindFilter, listSort],
  );
  const sections = useMemo(
    () => (kindFilter === ALL ? sectionsOf(files, listSort) : []),
    [files, kindFilter, listSort],
  );
  const chips = useMemo(() => chipGroups(files, kindFilter), [files, kindFilter]);
  const current = files.find((f) => f.path === path) ?? null;

  // Keep the open note while the listing still holds it; otherwise open the
  // first one shown. One rule in one effect: two of them judging the same note
  // differently is what made the old pickers reopen a file in a loop (T-0284).
  useEffect(() => {
    if (!filesLoaded || !projectsLoaded) return;
    if (path && files.some((f) => f.path === path)) return;
    const next = visible[0]?.path ?? "";
    if (next !== path) setPath(next);
  }, [files, filesLoaded, projectsLoaded, path, visible]);

  useEffect(() => {
    writeViewState(VIEW_ID, "path", path);
  }, [path]);
  useEffect(() => {
    writeViewState(VIEW_ID, "project", project);
  }, [project]);
  useEffect(() => {
    try {
      localStorage.setItem(KIND_FILTER_KEY, kindFilter);
    } catch {
      // persistence is a convenience
    }
  }, [kindFilter]);

  const kind: DiagramKind | "" = current && isDiagramKind(current.kind) ? current.kind : "";

  async function rename(file: DiagramFile, title: string) {
    if (!vaultPath) return;
    try {
      // Schedule and Mindmap keep their own commands (their undo history and
      // trash live in their own folders); every newer kind shares one.
      const renamed =
        file.kind === "schedule"
          ? await api.renameSchedule(vaultPath, file.path, title)
          : file.kind === "mindmap"
            ? await api.renameMindmap(vaultPath, file.path, title)
            : await api.renameDiagram(vaultPath, file.path, title);
      setRenaming(null);
      await loadFiles();
      if (file.path === path) setPath(renamed.path);
    } catch (e) {
      setError(t("diagram.rename.failed", { error: String(e) }));
    }
  }

  async function remove(file: DiagramFile) {
    if (!vaultPath) return;
    try {
      if (file.kind === "schedule") await api.deleteSchedule(vaultPath, file.path);
      else if (file.kind === "mindmap") await api.deleteMindmap(vaultPath, file.path);
      else await api.deleteDiagram(vaultPath, file.path);
      setDeleting(null);
      if (file.path === path) setPath("");
      await loadFiles();
    } catch (e) {
      setError(t("diagram.delete.failed", { error: String(e) }));
    }
  }

  if (!vaultPath) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
        {t("diagram.noVault")}
      </div>
    );
  }

  if (projectsLoaded && !projects.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-sm text-muted-foreground">
        {t("diagram.noProjectsTitle")}
        <Button size="sm" onClick={() => setProjectDialogOpen(true)}>
          <FolderPlus className="mr-1 size-3.5" />
          {t("diagram.newProject")}
        </Button>
        <ProjectCreateDialog
          vaultPath={vaultPath}
          open={projectDialogOpen}
          onOpenChange={setProjectDialogOpen}
          onCreated={(slug) => {
            void loadProjects();
            setProject(slug);
          }}
        />
      </div>
    );
  }

  /** Writes the open editor's pending save, so a run starts from what is on screen. */
  const flushEditor = async () => {
    if (kind) await flushers.current[kind]?.();
  };

  const runAi = async (instruction: string, confirm: boolean) => {
    if (!current) return;
    setError("");
    try {
      await flushEditor();
      await api.runDiagramEdit(current.path, instruction, confirm);
    } catch (e) {
      setError(String(e));
    }
  };

  const copyAiPrompt = async (instruction: string, confirm: boolean) => {
    if (!current) return;
    // Flush first so the file the agent reads has the on-screen edits.
    await flushEditor();
    await api.copyDiagramEditPrompt(current.path, instruction, confirm);
  };

  const undoAi = () => {
    if (!current) return;
    setError("");
    void api
      .restoreDiagramSnapshot(current.path)
      .then(() => setReloadToken((n) => n + 1))
      .catch((e) => setError(String(e)));
  };

  // Side panels hide per kind of diagram (T-0686). With no note open there is
  // no kind, and the list stays shown: nothing else could bring it back.
  const hiddenPanels = config?.settings.diagram_hidden_panels ?? [];
  const panelOpen = (side: PanelSide) => !kind || isPanelOpen(hiddenPanels, kind, side);
  const setPanelOpen = (which: DiagramKind, side: PanelSide, open: boolean) =>
    void patchSettings({
      diagram_hidden_panels: withPanelOpen(
        config?.settings.diagram_hidden_panels ?? [],
        which,
        side,
        open,
      ),
    });

  const editorFor = (which: "schedule" | "mindmap" | "matrix2x2" | "flow" | "pfd" | "algorithm" | "usecase" | "architecture" | "ifdam") => ({
    project: current?.project ?? project,
    path: kind === which ? path : "",
    title: current?.title ?? "",
    locked: aiRunning,
    reloadToken,
    sidePanelOpen: isPanelOpen(hiddenPanels, which, "right"),
    onSidePanelOpenChange: (open: boolean) => setPanelOpen(which, "right", open),
    registerFlush: (flush: (() => Promise<void>) | null) => {
      flushers.current[which] = flush;
    },
    onPathChange: (next: string) => {
      // An editor only ever hands back "none" (after a delete, or a note that
      // vanished) or a note of its own kind; the list re-resolves from there.
      setPath(next);
      void loadFiles();
    },
  });

  const renderRow = (file: DiagramFile) => {
    const fileKind = isDiagramKind(file.kind) ? file.kind : null;
    const Icon = fileKind ? KIND_ICON[fileKind] : Pencil;
    const item = backlogOfScope(file.scope);
    const editable = hasEditor(file.kind);
    return (
      <ContextMenu key={file.path}>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            onClick={() => setPath(file.path)}
            className={cn(
              "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
              file.path === path
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            <Icon className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-foreground">{file.title}</span>
              <span className="block truncate text-[10px]">
                {[!project && file.project, item, updatedDay(file.updated)]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
          </button>
        </ContextMenuTrigger>
        {editable && (
          <ContextMenuContent className="w-44">
            <ContextMenuItem disabled={aiRunning} onClick={() => setRenaming(file)}>
              <Pencil className="size-4" />
              {t("diagram.list.rename")}
            </ContextMenuItem>
            <ContextMenuItem
              variant="destructive"
              disabled={aiRunning}
              onClick={() => setDeleting(file)}
            >
              <Trash2 className="size-4" />
              {t("diagram.list.delete")}
            </ContextMenuItem>
          </ContextMenuContent>
        )}
      </ContextMenu>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-1.5">
        <PanelToggle
          side="left"
          open={panelOpen("left")}
          disabled={!kind}
          onToggle={() => kind && setPanelOpen(kind, "left", !panelOpen("left"))}
        />
        <Select
          value={project || ALL}
          onValueChange={(v) => {
            if (v === NEW_PROJECT) {
              setProjectDialogOpen(true);
              return;
            }
            setProject(v === ALL ? "" : v);
            setPath("");
          }}
        >
          <SelectTrigger className="h-7 w-44 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("diagram.allProjects")}</SelectItem>
            {projects.map((slug) => (
              <SelectItem key={slug} value={slug}>
                {projectNumberedLabel(slug, projectFolders)}
              </SelectItem>
            ))}
            <SelectSeparator />
            <SelectItem value={NEW_PROJECT}>{t("diagram.newProject")}</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex items-center rounded-md border p-0.5">
          <Button
            size="sm"
            variant={kindFilter === ALL ? "secondary" : "ghost"}
            className="h-6 gap-1 px-2 text-xs"
            onClick={() => setKindFilter(ALL)}
          >
            {t("diagram.filter.all")}
            <span className="tabular-nums text-muted-foreground">{files.length}</span>
          </Button>
          {chips.map((group) => (
            <div key={group.id} className="flex items-center">
              <span aria-hidden className="mx-1 h-4 w-px bg-border" />
              {group.chips.map(({ kind: chipKind, count }) => (
                <Button
                  key={chipKind}
                  size="sm"
                  variant={kindFilter === chipKind ? "secondary" : "ghost"}
                  className="h-6 gap-1 px-2 text-xs"
                  onClick={() => setKindFilter(chipKind)}
                >
                  {t(KIND_LABEL_KEY[chipKind])}
                  <span className="tabular-nums text-muted-foreground">{count}</span>
                </Button>
              ))}
            </div>
          ))}
        </div>

        <Hint label={t("diagram.newHint")}>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-xs"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="size-3.5" />
            {t("diagram.new")}
          </Button>
        </Hint>
        {error && <span className="max-w-96 truncate text-[11px] text-destructive">{error}</span>}
        <div className="ml-auto flex items-center gap-1.5">
          <DiagramAiSettings
            settings={config?.settings ?? null}
            onPatch={(patch) => void patchSettings(patch)}
          />
          <Hint label={t("diagram.aiPanel.toggleHint")} disabled={!current}>
            <Button
              size="sm"
              variant={aiOpen ? "secondary" : "outline"}
              className="h-7 text-xs"
              disabled={!current}
              onClick={() => setAiOpen((v) => !v)}
            >
              <Sparkles className="size-3.5" />
            </Button>
          </Hint>
          <PanelToggle
            side="right"
            open={!kind || isPanelOpen(hiddenPanels, kind, "right")}
            disabled={!kind || !hasEditor(kind)}
            onToggle={() =>
              kind && setPanelOpen(kind, "right", !isPanelOpen(hiddenPanels, kind, "right"))
            }
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="relative shrink-0">
          {panelOpen("left") && (
            <aside className="h-full w-56 overflow-y-auto border-r p-1.5">
              {visible.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  {files.length === 0 ? t("diagram.list.empty") : t("diagram.list.emptyFiltered")}
                </p>
              ) : (
                <>
                  <div
                    className="mb-1 flex items-center gap-1 px-1"
                    title={t("diagram.list.sortHint")}
                  >
                    {(["updated", "name"] as const).map((value) => (
                      <Button
                        key={value}
                        size="sm"
                        variant={listSort === value ? "secondary" : "ghost"}
                        className="h-5 px-1.5 text-[10px]"
                        onClick={() => void patchSettings({ diagram_list_sort: value })}
                      >
                        {value === "updated" ? t("diagram.list.sortUpdated") : t("diagram.list.sortName")}
                      </Button>
                    ))}
                  </div>
                  {kindFilter === ALL
                    ? sections.map((section) => {
                        const SectionIcon = KIND_ICON[section.kind];
                        const folded = isCollapsed(collapsedKinds, section.kind);
                        const Chevron = folded ? ChevronRight : ChevronDown;
                        return (
                          <div key={section.kind} className="mb-1">
                            <button
                              type="button"
                              aria-expanded={!folded}
                              aria-label={t("diagram.list.toggleGroup", {
                                kind: t(KIND_LABEL_KEY[section.kind]),
                              })}
                              onClick={() =>
                                void patchSettings({
                                  diagram_collapsed_kinds: withCollapsed(
                                    collapsedKinds,
                                    section.kind,
                                    !folded,
                                  ),
                                })
                              }
                              className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] font-semibold text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                            >
                              <Chevron className="size-3 shrink-0" />
                              <SectionIcon className="size-3 shrink-0" />
                              <span className="min-w-0 flex-1 truncate">{t(KIND_LABEL_KEY[section.kind])}</span>
                              <span className="tabular-nums font-normal">{section.files.length}</span>
                            </button>
                            {!folded && section.files.map(renderRow)}
                          </div>
                        );
                      })
                    : visible.map(renderRow)}
                </>
              )}
            </aside>
          )}
        </div>

        <div className="relative min-w-0 flex-1">
          {/* Every editor stays mounted so a pending save is never lost to a
              switch between kinds, and each draws only when its own kind is
              open (the others are handed an empty path). */}
          <div className={cn("h-full", kind === "schedule" ? "" : "hidden")}>
            <ScheduleView configVersion={configVersion} embedded={editorFor("schedule")} />
          </div>
          <div className={cn("h-full", kind === "mindmap" ? "" : "hidden")}>
            <MindmapView configVersion={configVersion} embedded={editorFor("mindmap")} />
          </div>
          <div className={cn("h-full", kind === "matrix2x2" ? "" : "hidden")}>
            <MatrixView configVersion={configVersion} embedded={editorFor("matrix2x2")} />
          </div>
          <div className={cn("h-full", kind === "flow" ? "" : "hidden")}>
            <FlowView configVersion={configVersion} embedded={editorFor("flow")} />
          </div>
          <div className={cn("h-full", kind === "pfd" ? "" : "hidden")}>
            <PfdView configVersion={configVersion} embedded={editorFor("pfd")} />
          </div>
          <div className={cn("h-full", kind === "algorithm" ? "" : "hidden")}>
            <AlgorithmView configVersion={configVersion} embedded={editorFor("algorithm")} />
          </div>
          <div className={cn("h-full", kind === "usecase" ? "" : "hidden")}>
            <UsecaseView configVersion={configVersion} embedded={editorFor("usecase")} />
          </div>
          <div className={cn("h-full", kind === "architecture" ? "" : "hidden")}>
            <ArchitectureView configVersion={configVersion} embedded={editorFor("architecture")} />
          </div>
          <div className={cn("h-full", kind === "ifdam" ? "" : "hidden")}>
            <IfdamView configVersion={configVersion} embedded={editorFor("ifdam")} />
          </div>
          {!hasEditor(kind) && (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
              {current ? (
                <>
                  <p className="font-medium text-foreground">{current.title}</p>
                  <p>{t("diagram.soon")}</p>
                </>
              ) : (
                <p>{t("diagram.list.pickOne")}</p>
              )}
            </div>
          )}
        </div>

        {aiOpen && aiRun && current && (
          <aside className="flex w-72 shrink-0 flex-col border-l">
            <DiagramAiPanel
              run={aiRun}
              defaultConfirm={config?.settings.diagram_confirm ?? false}
              disabled={!current}
              onRun={(instruction, confirm) => void runAi(instruction, confirm)}
              onUndo={undoAi}
              onCopyPrompt={copyAiPrompt}
            />
          </aside>
        )}
      </div>

      <ProjectCreateDialog
        vaultPath={vaultPath}
        open={projectDialogOpen}
        onOpenChange={setProjectDialogOpen}
        onCreated={(slug) => {
          void loadProjects();
          setProject(slug);
          setPath("");
        }}
      />

      <CreateDiagramDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        vaultPath={vaultPath}
        projects={projects}
        projectFolders={projectFolders}
        defaultProject={project || current?.project || projects[0] || ""}
        defaultKind={kindFilter !== ALL && CREATABLE_KINDS.includes(kindFilter as DiagramKind) ? (kindFilter as DiagramKind) : "mindmap"}
        onCreated={async (file) => {
          setCreateOpen(false);
          setError("");
          if (project && project !== file.project) setProject(file.project);
          if (kindFilter !== ALL && kindFilter !== file.kind) setKindFilter(ALL);
          await loadFiles();
          setPath(file.path);
        }}
      />

      <RenameDialog
        file={renaming}
        onClose={() => setRenaming(null)}
        onSubmit={(file, title) => void rename(file, title)}
      />

      <ConfirmDialog
        open={deleting !== null}
        title={t("diagram.delete.title")}
        description={t("diagram.delete.description", { title: deleting?.title ?? "" })}
        confirmLabel={t("diagram.delete.confirm")}
        destructive
        onConfirm={() => deleting && void remove(deleting)}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

function RenameDialog({
  file,
  onClose,
  onSubmit,
}: {
  file: DiagramFile | null;
  onClose: () => void;
  onSubmit: (file: DiagramFile, title: string) => void;
}) {
  const t = useT();
  const [title, setTitle] = useState("");
  useEffect(() => {
    if (file) setTitle(file.title);
  }, [file]);
  return (
    <Dialog open={file !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("diagram.rename.title")}</DialogTitle>
        </DialogHeader>
        <Input
          value={title}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && title.trim() && file) onSubmit(file, title.trim());
          }}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!title.trim()} onClick={() => file && onSubmit(file, title.trim())}>
            {t("diagram.list.rename")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateDiagramDialog({
  open,
  onOpenChange,
  vaultPath,
  projects,
  projectFolders,
  defaultProject,
  defaultKind,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vaultPath: string;
  projects: string[];
  projectFolders: Record<string, string>;
  defaultProject: string;
  defaultKind: DiagramKind;
  onCreated: (file: DiagramFile) => void | Promise<void>;
}) {
  const t = useT();
  const [project, setProject] = useState(defaultProject);
  const [kind, setKind] = useState<DiagramKind>(defaultKind);
  const [title, setTitle] = useState("");
  const [place, setPlace] = useState<"project" | "backlog">("project");
  const [item, setItem] = useState("");
  const [items, setItems] = useState<BacklogItem[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Start from the current context each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setProject(defaultProject);
    setKind(defaultKind);
    setTitle("");
    setPlace("project");
    setItem("");
    setError("");
  }, [open, defaultProject, defaultKind]);

  useEffect(() => {
    if (!open || !project) {
      setItems([]);
      return;
    }
    let live = true;
    void api
      .listBacklogItems(vaultPath, project)
      .then((list) => live && setItems(list))
      .catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, [open, vaultPath, project]);

  async function submit() {
    if (!project || !title.trim() || busy) return;
    if (place === "backlog" && !item) return;
    setBusy(true);
    setError("");
    try {
      const today = toISO(new Date());
      const range = formatRange(today, shiftDate(today, DEFAULT_RANGE_DAYS));
      const file = await api.createDiagram(
        vaultPath,
        project,
        kind,
        title.trim(),
        place === "backlog" ? item : "",
        range,
      );
      await onCreated(file);
    } catch (e) {
      setError(t("diagram.create.failed", { error: String(e) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("diagram.create.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-xs">
          <label className="block space-y-1">
            <span className="text-muted-foreground">{t("diagram.create.project")}</span>
            <Select value={project} onValueChange={setProject}>
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {projects.map((slug) => (
                  <SelectItem key={slug} value={slug}>
                    {projectNumberedLabel(slug, projectFolders)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="block space-y-1">
            <span className="text-muted-foreground">{t("diagram.create.kind")}</span>
            <Select value={kind} onValueChange={(v) => setKind(v as DiagramKind)}>
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CREATABLE_KINDS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(KIND_LABEL_KEY[value])}
                    {SIMPLE_KINDS.includes(value) && ` (${t("diagram.create.simple")})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="block space-y-1">
            <span className="text-muted-foreground">{t("diagram.create.name")}</span>
            <Input
              value={title}
              autoFocus
              placeholder={t("diagram.create.namePlaceholder")}
              className="h-8 text-xs"
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
          </label>
          <div className="space-y-1">
            <span className="text-muted-foreground">{t("diagram.create.place")}</span>
            <div className="flex items-center rounded-md border p-0.5">
              {(["project", "backlog"] as const).map((value) => (
                <Button
                  key={value}
                  size="sm"
                  variant={place === value ? "secondary" : "ghost"}
                  className="h-6 flex-1 px-2 text-xs"
                  onClick={() => setPlace(value)}
                >
                  {value === "project" ? t("diagram.create.placeProject") : t("diagram.create.placeBacklog")}
                </Button>
              ))}
            </div>
            {place === "backlog" &&
              (items.length === 0 ? (
                <p className="text-muted-foreground">{t("diagram.create.noItems")}</p>
              ) : (
                <Select value={item} onValueChange={setItem}>
                  <SelectTrigger className="h-8 w-full text-xs">
                    <SelectValue placeholder={t("diagram.create.pickItem")} />
                  </SelectTrigger>
                  <SelectContent>
                    {items.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.id} {b.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ))}
          </div>
          {error && <p className="text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={busy || !project || !title.trim() || (place === "backlog" && !item)}
            onClick={() => void submit()}
          >
            {t("common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
