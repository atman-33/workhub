import { useCallback, useEffect, useState } from "react";
import { useDefaultLayout } from "react-resizable-panels";
import { ArrowLeft, BookOpen, RefreshCw, Shapes } from "lucide-react";
import { DocsPreview, type UnresolvedWikiLink } from "@/components/docs/docs-preview";
import { DiagramEditorHost } from "@/components/projects/diagram-editor-host";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Hint } from "@/components/ui/hint";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { isWithinRoot } from "@/lib/docs/tree-nav";
import type { DiagramKind } from "@/lib/diagram-kinds";
import {
  diagramKindOfText,
  parseFrontmatterScalars,
} from "@/lib/project-backlog";
import {
  docLabel,
  groupProjectDocEntries,
  type ProjectDocGroup,
} from "@/lib/project-documents";
import { cn } from "@/lib/utils";

/**
 * The Documents pane of a project's detail view (T-0714): the project's
 * shared documents, read through the Docs tab's `DocsPreview`.
 *
 * The project folder is resolved from the slug with `resolveProjectDir` —
 * never by concatenating `projects/<slug>/` — and read through the same
 * `docs_*` commands as the Docs tab. The backend's containment guard allows
 * the vault itself without a registered document root, so no new commands
 * were needed; `backlog/` is never descended into (T-0715 owns it).
 *
 * Read-only throughout, except for diagram notes: those open in place with
 * the real editor view for their kind (T-0738) — the same view the Diagrams
 * tab embeds — beside the "Open in Diagrams tab" button. Every other document
 * is read through the Docs tab's `DocsPreview`, and editing stays in Obsidian,
 * which is why every document carries an "Open in Obsidian" action. Links that leave the project
 * folder are not followed in the pane — a banner points at Obsidian instead —
 * so an unresolvable link shows a hint rather than a broken view. A
 * `[[wikilink]]` that resolves to one file in the folder is followed like any
 * other link (T-0726); one with no single answer gets the same banner, aimed
 * at the note itself, where Obsidian can follow it.
 *
 * The parent mounts this per project (`key={slug}`), so the selected document
 * cannot leak across projects: switching project remounts the pane with no
 * selection.
 */
export function ProjectDocuments({
  vaultPath,
  slug,
  configVersion,
  onOpenDiagrams,
}: {
  vaultPath: string;
  slug: string;
  /** Bumped by the app shell after settings are saved. */
  configVersion: number;
  /** Opens the Diagrams tab with this diagram note selected. */
  onOpenDiagrams: (diagramPath: string) => void;
}) {
  const t = useT();
  // The list / preview split survives a restart, like the Docs tab's (T-0279).
  const docsSplit = useDefaultLayout({ id: "projects-docs-split", storage: localStorage });
  const [dir, setDir] = useState("");
  const [groups, setGroups] = useState<ProjectDocGroup[]>([]);
  const [selected, setSelected] = useState("");
  const [linkHint, setLinkHint] = useState("");
  // A `[[wikilink]]` click with no single file to open (T-0726): the link as
  // written, and how many files answer to it (0 when none does).
  const [wikiHint, setWikiHint] = useState<{ target: string; count: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  // The selected file's diagram kind, read off its frontmatter `type` — the
  // same rule the Backlog pane uses. `path` guards against a read that lands
  // after the selection moved on.
  const [diagram, setDiagram] = useState<{ path: string; kind: DiagramKind; title: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setLinkHint("");
    setWikiHint(null);
    try {
      const resolved = await api.resolveProjectDir(vaultPath, slug);
      if (!resolved) {
        setDir("");
        setGroups([]);
        setSelected("");
        setError(t("projects.view.docs.resolveFailed"));
        return;
      }
      setDir(resolved);
      const root = await api.docsListDir(resolved);
      const { groups: first, subdirs } = groupProjectDocEntries(root);
      const settled = await Promise.allSettled(subdirs.map((d) => api.docsListDir(d)));
      const rest: ProjectDocGroup[] = settled.flatMap((r, i) => {
        if (r.status !== "fulfilled") return [];
        const files = r.value.filter(
          (e) => !e.is_dir && (e.is_markdown || e.is_html || e.is_text),
        );
        if (files.length === 0) return [];
        return [{ dir: subdirs[i].slice(resolved.length + 1), files }];
      });
      setGroups([...first, ...rest]);
      setSelected((prev) => (prev && isWithinRoot(resolved, prev) ? prev : ""));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [vaultPath, slug, t]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  useEffect(() => {
    if (!selected) {
      setDiagram(null);
      return;
    }
    let live = true;
    void api
      .docsReadFile(selected)
      .then((text) => {
        if (!live) return;
        const kind = diagramKindOfText(text);
        if (!kind) {
          setDiagram(null);
          return;
        }
        const title =
          parseFrontmatterScalars(text).title?.trim() || selected.split("/").pop() || selected;
        setDiagram({ path: selected, kind, title });
      })
      .catch(() => {
        if (live) setDiagram(null);
      });
    return () => {
      live = false;
    };
  }, [selected, refreshToken]);

  const openInObsidian = (path: string) => {
    setError("");
    void api.openInObsidian(path).catch((e) => setError(String(e)));
  };

  /** Follows a document link inside the project folder; anything else gets
   * the Obsidian hint rather than a failed read in the pane. */
  const openDoc = (target: string) => {
    if (dir && isWithinRoot(dir, target)) {
      setLinkHint("");
      setWikiHint(null);
      setSelected(target);
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

  const backToList = () => {
    setLinkHint("");
    setWikiHint(null);
    setSelected("");
  };

  // The selected file is a diagram note of a known kind: it renders with the
  // embedded editor, not the Markdown preview.
  const showDiagram = diagram && diagram.path === selected ? diagram : null;

  return (
    <section aria-label={t("projects.view.documentsTab")} className="flex h-full min-h-0 flex-col gap-1.5">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">
          {t("projects.view.documentsTab")}
        </h3>
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
      {error && <p className="shrink-0 text-xs text-destructive">{error}</p>}
      {/* Fills the detail pane's remaining height (T-0737): the parent body
        gives this section its height, and the list/preview split takes the
        rest with its own internal scroll. The list is resizable (its width is remembered) beside
        the preview; picking another document, or the Overview tab above, is
        how the reader moves on. */}
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
        <ResizablePanelGroup orientation="horizontal" className="h-full" {...docsSplit}>
        <ResizablePanel id="docs-list" defaultSize="30%" minSize="160px" maxSize="60%" className="min-h-0">
        <div className="h-full overflow-y-auto border-r">
          {loading && groups.length === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">{t("projects.view.docs.loading")}</p>
          ) : groups.every((g) => g.files.length === 0) ? (
            <p className="p-2 text-xs text-muted-foreground">
              {t("projects.view.docs.noDocuments")}
            </p>
          ) : (
            groups.map(
              (group) =>
                group.files.length > 0 && (
                  <div key={group.dir || "/"} className="border-b py-1 last:border-b-0">
                    {group.dir && (
                      <p className="px-2 py-1 font-mono text-[10px] uppercase text-muted-foreground">
                        {group.dir}/
                      </p>
                    )}
                    {group.files.map((file) => (
                      <div
                        key={file.path}
                        className={cn(
                          "flex items-center gap-1 pr-1",
                          file.path === selected && "bg-muted",
                        )}
                      >
                        <Hint label={file.path}>
                          <button
                            type="button"
                            onClick={() => {
                              setLinkHint("");
                              setWikiHint(null);
                              setSelected(file.path);
                            }}
                            className="min-w-0 flex-1 truncate px-2 py-1 text-left text-xs hover:underline"
                          >
                            {file.name}
                          </button>
                        </Hint>
                        <Hint label={t("projects.view.docs.openInObsidian")}>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`${t("projects.view.docs.openInObsidian")}: ${file.name}`}
                            onClick={() => openInObsidian(file.path)}
                          >
                            <BookOpen />
                          </Button>
                        </Hint>
                      </div>
                    ))}
                  </div>
                ),
            )
          )}
        </div>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id="docs-detail" defaultSize="70%" minSize="200px" className="min-h-0">
        <div className="flex h-full min-w-0 flex-col">
          {!selected ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
              {t("projects.view.docs.pickPrompt")}
            </div>
          ) : showDiagram ? (
            <>
              <div className="flex items-center gap-1 border-b px-2 py-1">
                <Hint label={t("projects.view.docs.backToList")}>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("projects.view.docs.backToList")}
                    onClick={backToList}
                  >
                    <ArrowLeft />
                  </Button>
                </Hint>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {dir ? docLabel(dir, selected) : selected}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => onOpenDiagrams(selected)}
                >
                  <Shapes className="size-3.5" />
                  {t("projects.view.backlog.openInDiagrams")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => openInObsidian(selected)}
                >
                  <BookOpen className="size-3.5" />
                  {t("projects.view.docs.openInObsidian")}
                </Button>
              </div>
              <DiagramEditorHost
                kind={showDiagram.kind}
                path={selected}
                title={showDiagram.title}
                project={slug}
                configVersion={configVersion}
                onClose={backToList}
              />
            </>
          ) : (
            <>
              <div className="flex items-center gap-1 border-b px-2 py-1">
                <Hint label={t("projects.view.docs.backToList")}>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("projects.view.docs.backToList")}
                    onClick={backToList}
                  >
                    <ArrowLeft />
                  </Button>
                </Hint>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {dir ? docLabel(dir, selected) : selected}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => openInObsidian(selected)}
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
                    onClick={() => openInObsidian(selected)}
                  >
                    <BookOpen className="size-3" />
                    {t("projects.view.docs.openInObsidian")}
                  </Button>
                </div>
              )}
              <div className="min-h-0 flex-1">
                <DocsPreview
                  path={selected}
                  refreshToken={refreshToken}
                  onError={setError}
                  onOpenDoc={openDoc}
                  onUnresolvedWikiLink={openUnresolvedWiki}
                />
              </div>
            </>
          )}
        </div>
        </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </section>
  );
}
