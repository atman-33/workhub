import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, BookOpen, RefreshCw, Shapes } from "lucide-react";
import { DocsPreview, type UnresolvedWikiLink } from "@/components/docs/docs-preview";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { KIND_ICON, KIND_LABEL_KEY, isDiagramKind } from "@/lib/diagram-kinds";
import { isPreviewable } from "@/lib/docs/preview-kind";
import { isWithinRoot, relativeWithin } from "@/lib/docs/tree-nav";
import { useT } from "@/lib/i18n";
import {
  BACKLOG_STATUSES,
  backlogItemFromFrontmatter,
  classifyBacklogFile,
  compareBacklogFiles,
  discoverBacklogItems,
  entryNoteName,
  filterBacklogItems,
  parseFrontmatterScalars,
  type BacklogFileKind,
  type BacklogListItem,
} from "@/lib/project-backlog";
import { cn } from "@/lib/utils";
import type { DocsEntry, Task } from "@/types";

/** Sentinel for the status filter — Radix rejects an empty string as a value. */
const ALL_STATUSES = "__all__";

/** One listed file of the selected item, with what it is. */
interface BacklogFileRow {
  entry: DocsEntry;
  kind: BacklogFileKind;
  /** The frontmatter `type` when the file is a diagram note. */
  diagramKind: string;
}

interface Props {
  vaultPath: string;
  slug: string;
  /**
   * The backend-scanned absolute path of the project folder. `resolveProjectDir`
   * cannot see archived projects, so this covers them — the pane only reads, so
   * a scanned path is safe to fall back to (never string-concatenated).
   */
  fallbackDir: string;
  /** All vault tasks, for the per-item count of tasks pointing at it. */
  tasks: Task[];
  /** Opens the Diagrams tab with this diagram note selected. */
  onOpenDiagrams: (diagramPath: string) => void;
}

/**
 * The Backlog pane of a project's detail view (T-0715): the project's backlog
 * items (`B-NNN`) with the status and priority from each item's entry-note
 * frontmatter — the same fields `_backlog.base` renders.
 *
 * Discovery goes through the same `resolve_project_dir` + `docs_*` commands
 * as the Documents pane (T-0714): no new backend commands. An item is either
 * a folder of notes (the entry note, child notes `NNN-...`, task deliverables
 * `NNN-T-xxxx-...`, HTML files, diagram notes — the template keeps them flat)
 * or a single `B-NNN-....md` file, the old shape from before folder-first.
 *
 * Read-only throughout: editing stays in Obsidian. Diagram notes are stage 1
 * only — a kind icon in the list and an "Open in Diagrams tab" button, no
 * embedded rendering. Standard Markdown links (`[x](y.md)`) are followed
 * inside the item's folder; anything else gets the Obsidian hint. A
 * `[[wikilink]]` that resolves to one file in the folder is followed the same
 * way (T-0726); one with no single answer gets the Obsidian hint aimed at the
 * open note, where Obsidian can follow it.
 *
 * The parent mounts this per project (`key={slug}`), so the selection cannot
 * leak across projects.
 */
export function ProjectBacklog({ vaultPath, slug, fallbackDir, tasks, onOpenDiagrams }: Props) {
  const t = useT();
  const [backlogDir, setBacklogDir] = useState("");
  const [items, setItems] = useState<BacklogListItem[]>([]);
  const [rows, setRows] = useState<BacklogFileRow[]>([]);
  // The selected item's folder/file name — unique within `backlog/`, unlike
  // the `B-NNN` id when two folders share one.
  const [selectedItem, setSelectedItem] = useState("");
  const [selectedFile, setSelectedFile] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [linkHint, setLinkHint] = useState("");
  // A `[[wikilink]]` click with no single file to open (T-0726): the link as
  // written, and how many files answer to it (0 when none does).
  const [wikiHint, setWikiHint] = useState<{ target: string; count: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [error, setError] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError("");
    setLinkHint("");
    setWikiHint(null);
    try {
      const resolved = (await api.resolveProjectDir(vaultPath, slug)) ?? fallbackDir ?? "";
      if (!resolved) {
        setBacklogDir("");
        setItems([]);
        setRows([]);
        setSelectedItem("");
        setSelectedFile("");
        setError(t("projects.view.docs.resolveFailed"));
        return;
      }
      const dir = `${resolved.replace(/\/+$/, "")}/backlog`;
      setBacklogDir(dir);
      // No `backlog/` folder is not an error — the project simply has no
      // items yet, the same way the task editor's picker sees it.
      const listing = await api.docsListDir(dir).catch(() => [] as DocsEntry[]);
      const discovered = discoverBacklogItems(listing);
      const read = await Promise.all(
        discovered.map(async (d) => {
          const entryPath = d.isFile ? `${dir}/${d.name}` : `${dir}/${d.name}/${entryNoteName(d.name)}`;
          const text = await api.docsReadFile(entryPath).catch(() => "");
          return backlogItemFromFrontmatter(d, parseFrontmatterScalars(text));
        }),
      );
      setItems(read);
      setSelectedItem((prev) => (read.some((i) => i.name === prev) ? prev : ""));
      setSelectedFile((prev) => {
        // Keep the file while its item is still listed; the file loader
        // reselects the entry note when the item itself changed.
        if (!prev || !prev.startsWith(`${dir}/`)) return "";
        const owner = read.find(
          (i) => prev === `${dir}/${i.name}` || prev.startsWith(`${dir}/${i.name}/`),
        );
        return owner ? prev : "";
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [vaultPath, slug, fallbackDir, t]);

  useEffect(() => {
    void loadItems();
  }, [loadItems, refreshToken]);

  const loadFiles = useCallback(
    async (item: BacklogListItem) => {
      setLoadingFiles(true);
      try {
        const itemDir = item.isFile ? backlogDir : `${backlogDir}/${item.name}`;
        const listing = item.isFile
          ? (
              await api.docsListDir(backlogDir).catch(() => [] as DocsEntry[])
            ).filter((e) => e.path === `${backlogDir}/${item.name}`)
          : await api.docsListDir(itemDir);
        const files = listing.filter(isPreviewable);
        const types = await Promise.all(
          files.map(async (f) => {
            if (!f.is_markdown) return "";
            const text = await api.docsReadFile(f.path).catch(() => "");
            return parseFrontmatterScalars(text).type?.trim() ?? "";
          }),
        );
        const entry = item.isFile ? item.name : entryNoteName(item.name);
        const next = files
          .map((f, i) => ({
            entry: f,
            kind: classifyBacklogFile(f.name, f.name === entry, types[i], f.is_html),
            diagramKind: types[i],
          }))
          .sort((a, b) =>
            compareBacklogFiles(
              { name: a.entry.name, isEntry: a.kind === "entry" },
              { name: b.entry.name, isEntry: b.kind === "entry" },
            ),
          );
        setRows(next);
        setSelectedFile((prev) => {
          if (prev && next.some((r) => r.entry.path === prev)) return prev;
          return next[0]?.entry.path ?? "";
        });
      } catch (e) {
        setError(String(e));
        setRows([]);
        setSelectedFile("");
      } finally {
        setLoadingFiles(false);
      }
    },
    [backlogDir],
  );

  useEffect(() => {
    if (!selectedItem || !backlogDir) {
      setRows([]);
      return;
    }
    const item = items.find((i) => i.name === selectedItem);
    if (!item) {
      setRows([]);
      return;
    }
    void loadFiles(item);
  }, [selectedItem, items, backlogDir, loadFiles, refreshToken]);

  const openInObsidian = (path: string) => {
    setError("");
    void api.openInObsidian(path).catch((e) => setError(String(e)));
  };

  /** Follows a Markdown link inside the selected item; anything else gets the
   * Obsidian hint rather than a failed read in the pane. */
  const openDoc = (target: string) => {
    const item = items.find((i) => i.name === selectedItem);
    const scope = item && backlogDir ? (item.isFile ? backlogDir : `${backlogDir}/${item.name}`) : "";
    if (scope && isWithinRoot(scope, target)) {
      setLinkHint("");
      setWikiHint(null);
      setSelectedFile(target);
    } else {
      setWikiHint(null);
      setLinkHint(target);
    }
  };

  /** A `[[wikilink]]` click with no single file to open (T-0726): the banner
   * offers the open note itself in Obsidian, where the link can be followed. */
  const openUnresolvedWiki = (info: UnresolvedWikiLink) => {
    setLinkHint("");
    setWikiHint({ target: info.target, count: info.candidates.length });
  };

  const taskCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of tasks) {
      if (!task.backlog) continue;
      counts.set(task.backlog, (counts.get(task.backlog) ?? 0) + 1);
    }
    return counts;
  }, [tasks]);

  const visible = useMemo(() => filterBacklogItems(items, statusFilter), [items, statusFilter]);
  const current = rows.find((r) => r.entry.path === selectedFile) ?? null;
  const currentIsDiagram = !!current && current.kind === "diagram";
  const DiagramIcon =
    current && isDiagramKind(current.diagramKind)
      ? KIND_ICON[current.diagramKind]
      : Shapes;

  return (
    <section aria-label={t("projects.view.backlogTab")} className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">
          {t("projects.view.backlogTab")}
        </h3>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {t("projects.view.backlog.filterLabel")}
            <Select
              value={statusFilter || ALL_STATUSES}
              onValueChange={(v) => setStatusFilter(v === ALL_STATUSES ? "" : v)}
            >
              <SelectTrigger className="h-7 w-28 text-[11px]">
                <SelectValue placeholder={t("projects.view.backlog.filterAll")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_STATUSES}>{t("projects.view.backlog.filterAll")}</SelectItem>
                {BACKLOG_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5"
            disabled={loading}
            onClick={() => setRefreshToken((n) => n + 1)}
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            {t("projects.view.refresh")}
          </Button>
        </div>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {/* Same fixed-height split as the Documents pane: the detail pane scrolls
        itself, so an unbounded preview here would push the list off screen. */}
      <div className="flex h-[28rem] min-h-0 overflow-hidden rounded-md border">
        <div className="w-60 shrink-0 overflow-y-auto border-r">
          {loading && items.length === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">{t("projects.view.backlog.loading")}</p>
          ) : visible.length === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">{t("projects.view.backlog.noItems")}</p>
          ) : (
            visible.map((item) => {
              const active = item.name === selectedItem;
              const count = taskCounts.get(item.id) ?? 0;
              return (
                <div key={item.name} className={cn("border-b last:border-b-0", active && "bg-muted/50")}>
                  <div className="flex items-center gap-1 pr-1">
                    <button
                      type="button"
                      onClick={() => {
                        setLinkHint("");
                        setWikiHint(null);
                        setSelectedItem(item.name);
                      }}
                      className="min-w-0 flex-1 px-2 py-1.5 text-left"
                    >
                      <span className="block truncate text-xs font-medium">{item.title}</span>
                      <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                        {item.id}
                        {item.status ? ` · ${item.status}` : ""}
                        {item.priority ? ` · ${item.priority}` : ""}
                        {count > 0 ? ` · ${t("projects.list.taskCount", { count })}` : ""}
                      </span>
                    </button>
                    <Hint label={t("projects.view.docs.openInObsidian")}>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`${t("projects.view.docs.openInObsidian")}: ${item.title}`}
                        onClick={() =>
                          openInObsidian(
                            item.isFile
                              ? `${backlogDir}/${item.name}`
                              : `${backlogDir}/${item.name}/${entryNoteName(item.name)}`,
                          )
                        }
                      >
                        <BookOpen />
                      </Button>
                    </Hint>
                  </div>
                  {active && (
                    <div className="pb-1">
                      {loadingFiles && rows.length === 0 ? (
                        <p className="px-4 py-1 text-[11px] text-muted-foreground">
                          {t("projects.view.backlog.loading")}
                        </p>
                      ) : rows.length === 0 ? (
                        <p className="px-4 py-1 text-[11px] text-muted-foreground">
                          {t("projects.view.backlog.filesEmpty")}
                        </p>
                      ) : (
                        rows.map((row) => (
                          <button
                            key={row.entry.path}
                            type="button"
                            onClick={() => {
                              setLinkHint("");
                              setWikiHint(null);
                              setSelectedFile(row.entry.path);
                            }}
                            title={backlogDir ? relativeWithin(backlogDir, row.entry.path) : row.entry.path}
                            className={cn(
                              "flex w-full items-center gap-1.5 py-1 pl-5 pr-2 text-left text-[11px] hover:underline",
                              row.entry.path === selectedFile && "bg-muted font-medium",
                            )}
                          >
                            {row.kind === "diagram" && isDiagramKind(row.diagramKind) ? (
                              (() => {
                                const Icon = KIND_ICON[row.diagramKind];
                                return <Icon className="size-3 shrink-0 text-muted-foreground" />;
                              })()
                            ) : null}
                            <span className="min-w-0 flex-1 truncate">{row.entry.name}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          {!selectedFile || !current ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
              {t("projects.view.backlog.pickFile")}
            </div>
          ) : currentIsDiagram ? (
            <>
              <div className="flex items-center gap-1 border-b px-2 py-1">
                <Hint label={t("projects.view.docs.backToList")}>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("projects.view.docs.backToList")}
                    onClick={() => {
                      setLinkHint("");
                      setWikiHint(null);
                      setSelectedFile("");
                    }}
                  >
                    <ArrowLeft />
                  </Button>
                </Hint>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {backlogDir ? relativeWithin(backlogDir, current.entry.path) : current.entry.path}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => openInObsidian(current.entry.path)}
                >
                  <BookOpen className="size-3.5" />
                  {t("projects.view.docs.openInObsidian")}
                </Button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
                <DiagramIcon className="size-8 text-muted-foreground" />
                <p className="text-sm font-medium">
                  {isDiagramKind(current.diagramKind)
                    ? t(KIND_LABEL_KEY[current.diagramKind])
                    : current.entry.name}
                </p>
                <p className="max-w-80 text-xs text-muted-foreground">
                  {t("projects.view.backlog.diagramHint")}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <Button size="sm" className="h-7 gap-1.5" onClick={() => onOpenDiagrams(current.entry.path)}>
                    <Shapes className="size-3.5" />
                    {t("projects.view.backlog.openInDiagrams")}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1 border-b px-2 py-1">
                <Hint label={t("projects.view.docs.backToList")}>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("projects.view.docs.backToList")}
                    onClick={() => {
                      setLinkHint("");
                      setWikiHint(null);
                      setSelectedFile("");
                    }}
                  >
                    <ArrowLeft />
                  </Button>
                </Hint>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {backlogDir ? relativeWithin(backlogDir, selectedFile) : selectedFile}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => openInObsidian(selectedFile)}
                >
                  <BookOpen className="size-3.5" />
                  {t("projects.view.docs.openInObsidian")}
                </Button>
              </div>
              {linkHint && (
                <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
                  <span className="min-w-0 flex-1 truncate">
                    {t("projects.view.docs.linkOutsideHint")}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 shrink-0 gap-1 text-[11px]"
                    onClick={() => openInObsidian(linkHint)}
                  >
                    <BookOpen className="size-3" />
                    {t("projects.view.docs.openInObsidian")}
                  </Button>
                </div>
              )}
              {wikiHint && (
                <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
                  <span className="min-w-0 flex-1 truncate">
                    {wikiHint.count > 0
                      ? t("projects.view.docs.wikiAmbiguousHint", {
                          target: wikiHint.target,
                          count: wikiHint.count,
                        })
                      : t("projects.view.docs.wikiNotFoundHint", { target: wikiHint.target })}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 shrink-0 gap-1 text-[11px]"
                    onClick={() => openInObsidian(selectedFile)}
                  >
                    <BookOpen className="size-3" />
                    {t("projects.view.docs.openInObsidian")}
                  </Button>
                </div>
              )}
              <div className="min-h-0 flex-1">
                <DocsPreview
                  path={selectedFile}
                  refreshToken={refreshToken}
                  onError={setError}
                  onOpenDoc={openDoc}
                  onUnresolvedWikiLink={openUnresolvedWiki}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
