import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ExternalLink,
  FolderOpen,
  MoveHorizontal,
  PictureInPicture2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { HtmlPreview } from "@/components/docs/html-preview";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Markdown } from "@/components/ui/markdown";
import { api } from "@/lib/api";
import {
  basename,
  expandWikiEmbeds,
  resolveDocRelative,
  splitFrontmatter,
} from "@/lib/docs/markdown";
import { previewKindForPath } from "@/lib/docs/preview-kind";
import { PREVIEW_ZOOM, parsePreviewZoom, stepPreviewZoom } from "@/lib/docs/zoom";
import { cn } from "@/lib/utils";
import type { DocsFigure } from "@/types";

interface Props {
  /** Absolute path of the document to render; "" when nothing is selected. */
  path: string;
  /** Bumped by the toolbar's refresh button to re-read the open document. */
  refreshToken: number;
  onError: (message: string) => void;
  /** Told whether the document is being read right now. */
  onBusyChange?: (busy: boolean) => void;
  /**
   * True inside a Docs viewer window (T-0279). The document already has a
   * window of its own there, so the pop-out button is not offered again.
   */
  standalone?: boolean;
}

/**
 * localStorage keys for the reading preferences (T-0279). Machine-local UI
 * state, like the tab's last root and document; shared by the tab and its
 * viewer windows, which run on the same origin.
 */
const ZOOM_KEY = "docs.zoom";
const FULL_WIDTH_KEY = "docs.fullWidth";

function recall(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable — the preference just does not survive a restart
  }
}

/**
 * A document's YAML frontmatter, shown as the reference material it is.
 *
 * Small, muted and monospaced on purpose: it is metadata the reader glances
 * at, not the document. Before T-0294 it was not styled at all — CommonMark
 * read the closing `---` as a setext underline and set the whole block in
 * heading type, which made a note's keys the loudest thing on the page.
 */
function Frontmatter({ text, fullWidth }: { text: string; fullWidth: boolean }) {
  return (
    <pre
      className={cn(
        "mb-4 overflow-x-auto rounded-md border border-border/60 bg-muted/20 px-3 py-2",
        "font-mono text-[11px] leading-relaxed text-muted-foreground",
        fullWidth ? "max-w-none" : "mx-auto max-w-3xl",
      )}
    >
      {text}
    </pre>
  );
}

/** Opens one figure in a viewer window of its own. */
function openFigure(figure: DocsFigure, onError: (message: string) => void) {
  void api
    .openDocsViewer({ kind: "figure", title: figure.title, figure })
    .catch((e) => onError(String(e)));
}

/**
 * The read-only document pane.
 *
 * Images are fetched through the backend rather than by the webview: the
 * files sit on a share the webview has no access to, and the backend is where
 * the containment guard lives. Their bytes are cached per document so
 * scrolling a note full of screenshots does not re-read the share.
 *
 * An HTML file is shown as a page instead, in `HtmlPreview`'s sandboxed frame.
 *
 * The pane is narrow beside the tree, so it carries its own ways to read a
 * wide document (T-0279): a text zoom (also Ctrl+wheel), a full-width switch
 * that lifts the reading line length, and pop-outs — the whole document, or
 * one diagram or image, in a window of its own.
 */
export function DocsPreview({ path, refreshToken, onError, onBusyChange, standalone }: Props) {
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(() => parsePreviewZoom(recall(ZOOM_KEY)));
  const [fullWidth, setFullWidth] = useState(() => recall(FULL_WIDTH_KEY) === "1");

  useEffect(() => {
    onBusyChange?.(loading);
  }, [loading, onBusyChange]);

  useEffect(() => {
    remember(ZOOM_KEY, String(zoom));
  }, [zoom]);

  useEffect(() => {
    remember(FULL_WIDTH_KEY, fullWidth ? "1" : "0");
  }, [fullWidth]);

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

  // Which renderer this file gets is decided by its name, because a viewer
  // window is launched with a path and never sees the listing it came from.
  const kind = previewKindForPath(path);
  const html = kind === "html";
  const text = kind === "text";

  // Frontmatter is lifted out before the renderer sees it, and Obsidian's
  // `![[file]]` embeds are rewritten, since neither is CommonMark.
  // Anything with no kind of its own is read as Markdown, which is what the
  // pane has always done with a path it was handed and did not recognise.
  const { frontmatter, markdown } = useMemo(() => {
    if (html || text) return { frontmatter: "", markdown: "" };
    const split = splitFrontmatter(content);
    return { frontmatter: split.frontmatter, markdown: expandWikiEmbeds(split.body) };
  }, [html, text, content]);

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

  const onOpenFigure = useCallback((figure: DocsFigure) => openFigure(figure, onError), [onError]);

  // Ctrl+wheel zooms the text, as in a browser. A native listener because
  // React's wheel handler is passive and could not stop the page scrolling
  // underneath the zoom.
  const scroller = useRef<HTMLDivElement>(null);
  const zoomable = !html && !!content && !error;
  useEffect(() => {
    const el = scroller.current;
    if (!el || !zoomable) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((z) => stepPreviewZoom(z, e.deltaY < 0 ? 1 : -1));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomable]);

  if (!path) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
        Pick a document on the left to read it.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b px-3 py-1.5">
        <Hint label={path}>
          <span className="mr-1 min-w-0 flex-1 truncate text-xs text-muted-foreground">{path}</span>
        </Hint>
        {!html && (
          <>
            <Hint label="Zoom out (Ctrl+wheel)">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Zoom out"
                disabled={zoom <= PREVIEW_ZOOM.min}
                onClick={() => setZoom((z) => stepPreviewZoom(z, -1))}
              >
                <ZoomOut />
              </Button>
            </Hint>
            <Hint label="Reset zoom">
              <button
                type="button"
                onClick={() => setZoom(PREVIEW_ZOOM.initial)}
                className="w-10 text-center text-[11px] tabular-nums text-muted-foreground hover:text-foreground"
              >
                {Math.round(zoom * 100)}%
              </button>
            </Hint>
            <Hint label="Zoom in (Ctrl+wheel)">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Zoom in"
                disabled={zoom >= PREVIEW_ZOOM.max}
                onClick={() => setZoom((z) => stepPreviewZoom(z, 1))}
              >
                <ZoomIn />
              </Button>
            </Hint>
            <Hint label={fullWidth ? "Reading width" : "Use the full width"}>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Toggle full width"
                aria-pressed={fullWidth}
                className={cn(fullWidth && "bg-muted text-foreground")}
                onClick={() => setFullWidth((w) => !w)}
              >
                <MoveHorizontal />
              </Button>
            </Hint>
          </>
        )}
        {!standalone && (
          <Hint label="Open in a new window">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Open in a new window"
              onClick={() =>
                void api
                  .openDocsViewer({ kind: "doc", title: basename(path), path })
                  .catch((e) => onError(String(e)))
              }
            >
              <PictureInPicture2 />
            </Button>
          </Hint>
        )}
        <Hint label="Open with default app">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Open with default app"
            onClick={() => void api.docsOpenExternal(path).catch((e) => onError(String(e)))}
          >
            <ExternalLink />
          </Button>
        </Hint>
        <Hint label="Show this file in Explorer">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Show in Explorer"
            onClick={() => void api.docsReveal(path).catch((e) => onError(String(e)))}
          >
            <FolderOpen />
          </Button>
        </Hint>
      </div>
      {/* The frame scrolls itself, so an HTML page gets the pane edge to edge. */}
      <div
        ref={scroller}
        className={cn(
          // The app sets `user-select: none` on the body to feel native, and
          // only inputs opt back in — which left the one pane whose whole
          // content is prose unselectable (T-0294). Read-only text you cannot
          // copy out of is a document you have to open somewhere else.
          "select-text cursor-auto",
          html && !error && content
            ? "min-h-0 flex-1"
            : "min-h-0 flex-1 overflow-y-auto px-6 py-4",
        )}
      >
        {error && <p className="text-xs text-destructive">{error}</p>}
        {!error && loading && !content && (
          <p className="text-xs text-muted-foreground">Reading…</p>
        )}
        {!error && content && html && <HtmlPreview path={path} content={content} />}
        {!error && content && text && (
          // Shown exactly as it is on disk (T-0294): no parsing, no
          // highlighting, no table made out of a CSV. The point is to read a
          // small file without leaving the tab; anything the raw form cannot
          // carry is what "Open with default app" is still there for.
          <div style={{ zoom }}>
            <pre
              className={cn(
                "whitespace-pre-wrap break-words font-mono text-xs leading-relaxed",
                fullWidth ? "max-w-none" : "mx-auto max-w-3xl",
              )}
            >
              {content}
            </pre>
          </div>
        )}
        {!error && content && !html && !text && (
          // `zoom` rather than a transform: the text re-flows at the new size,
          // so a zoomed document still fits the pane instead of overflowing it.
          // Keyed by the refresh, so a re-read also redraws the diagrams — a
          // PlantUML server set since the last draw included.
          <div key={refreshToken} style={{ zoom }}>
            {frontmatter && <Frontmatter text={frontmatter} fullWidth={fullWidth} />}
            <Markdown
              variant="document"
              className={cn(fullWidth && "max-w-none")}
              allowHtml
              mermaid
              callouts
              plantuml={api.docsRenderPlantuml}
              resolveAsset={resolveAsset}
              onOpenFigure={onOpenFigure}
            >
              {markdown}
            </Markdown>
          </div>
        )}
        {!error && !loading && !content && (
          <p className="text-xs text-muted-foreground">This document is empty.</p>
        )}
      </div>
    </div>
  );
}
