import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Markdown } from "@/components/ui/markdown";
import { api } from "@/lib/api";
import { expandWikiEmbeds, resolveDocRelative } from "@/lib/docs/markdown";

interface Props {
  /** Absolute path of the document to render; "" when nothing is selected. */
  path: string;
  /** Bumped by the toolbar's refresh button to re-read the open document. */
  refreshToken: number;
}

/**
 * The read-only document pane.
 *
 * Images are fetched through the backend rather than by the webview: the
 * files sit on a share the webview has no access to, and the backend is where
 * the containment guard lives. Their bytes are cached per document so
 * scrolling a note full of screenshots does not re-read the share.
 */
export function DocsPreview({ path, refreshToken }: Props) {
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!path) {
      setContent("");
      setError("");
      return;
    }
    let live = true;
    setLoading(true);
    setError("");
    void api
      .docsReadFile(path)
      .then((text) => live && setContent(text))
      .catch((e) => {
        if (!live) return;
        setContent("");
        setError(String(e));
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [path, refreshToken]);

  // Obsidian's `![[file]]` embeds are not CommonMark, so they are rewritten
  // before the renderer ever sees them.
  const markdown = useMemo(() => expandWikiEmbeds(content), [content]);

  // Keyed by the document *and* the refresh token so a re-read drops the
  // images with the text it belongs to.
  const cacheKey = `${path}|${refreshToken}`;
  const [cache] = useState(() => new Map<string, Map<string, string | null>>());

  const resolveAsset = useCallback(
    async (src: string): Promise<string | null> => {
      let forDoc = cache.get(cacheKey);
      if (!forDoc) {
        cache.clear();
        forDoc = new Map();
        cache.set(cacheKey, forDoc);
      }
      const hit = forDoc.get(src);
      if (hit !== undefined) return hit;
      const target = resolveDocRelative(path, src);
      // An external URL resolves to null, which the renderer shows as an
      // unreadable image — this tab deliberately fetches nothing off the web.
      if (!target) {
        forDoc.set(src, null);
        return null;
      }
      try {
        const uri = await api.docsReadAsset(target);
        forDoc.set(src, uri);
        return uri;
      } catch {
        forDoc.set(src, null);
        return null;
      }
    },
    [cache, cacheKey, path],
  );

  if (!path) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
        Pick a document on the left to read it.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <Hint label={path}>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{path}</span>
        </Hint>
        <Hint label="Show this file in Explorer">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Show in Explorer"
            onClick={() => void api.openExplorer(path)}
          >
            <FolderOpen />
          </Button>
        </Hint>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {error && <p className="text-xs text-destructive">{error}</p>}
        {!error && loading && !content && (
          <p className="text-xs text-muted-foreground">Reading…</p>
        )}
        {!error && content && (
          <Markdown mermaid resolveAsset={resolveAsset}>
            {markdown}
          </Markdown>
        )}
        {!error && !loading && !content && (
          <p className="text-xs text-muted-foreground">This document is empty.</p>
        )}
      </div>
    </div>
  );
}
