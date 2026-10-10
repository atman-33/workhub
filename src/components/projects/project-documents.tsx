import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, BookOpen, RefreshCw } from "lucide-react";
import { DocsPreview } from "@/components/docs/docs-preview";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { isWithinRoot } from "@/lib/docs/tree-nav";
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
 * Read-only throughout: editing stays in Obsidian, which is why every
 * document carries an "Open in Obsidian" action. Links that leave the project
 * folder are not followed in the pane — a banner points at Obsidian instead —
 * so an unresolvable link shows a hint rather than a broken view.
 *
 * The parent mounts this per project (`key={slug}`), so the selected document
 * cannot leak across projects: switching project remounts the pane with no
 * selection.
 */
export function ProjectDocuments({ vaultPath, slug }: { vaultPath: string; slug: string }) {
  const t = useT();
  const [dir, setDir] = useState("");
  const [groups, setGroups] = useState<ProjectDocGroup[]>([]);
  const [selected, setSelected] = useState("");
  const [linkHint, setLinkHint] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setLinkHint("");
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

  const openInObsidian = (path: string) => {
    setError("");
    void api.openInObsidian(path).catch((e) => setError(String(e)));
  };

  /** Follows a document link inside the project folder; anything else gets
   * the Obsidian hint rather than a failed read in the pane. */
  const openDoc = (target: string) => {
    if (dir && isWithinRoot(dir, target)) {
      setLinkHint("");
      setSelected(target);
    } else {
      setLinkHint(target);
    }
  };

  return (
    <section aria-label={t("projects.view.documentsTab")} className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
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
      {error && <p className="text-xs text-destructive">{error}</p>}
      {/* Fixed height with internal scroll: the detail pane scrolls itself,
        so an unbounded preview here would push the list off screen. The list
        keeps a fixed width beside the preview; picking another document, or
        the Overview tab above, is how the reader moves on. */}
      <div className="flex h-[28rem] min-h-0 overflow-hidden rounded-md border">
        <div className="w-60 shrink-0 overflow-y-auto border-r">
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
        <div className="flex min-w-0 flex-1 flex-col">
          {!selected ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
              {t("projects.view.docs.pickPrompt")}
            </div>
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
                      setSelected("");
                    }}
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
              <div className="min-h-0 flex-1">
                <DocsPreview
                  path={selected}
                  refreshToken={refreshToken}
                  onError={setError}
                  onOpenDoc={openDoc}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
