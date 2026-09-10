import { type SyntheticEvent, useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "@/lib/api";
import { prepareHtmlDocument, serializeHtmlDocument } from "@/lib/docs/html";

interface Props {
  /** Absolute path of the HTML file — what its relative references resolve against. */
  path: string;
  /** The file's text, as read by the backend. */
  content: string;
}

/**
 * Shows an HTML file from the share as the page it is, in a sandboxed frame.
 *
 * The sandbox is `allow-same-origin` and nothing else, and that combination is
 * the whole security story (T-0271):
 *
 * - **no `allow-scripts`** — nothing in the file runs, inline handlers
 *   included. This webview holds the Tauri IPC bridge; a script from a shared
 *   folder must never execute next to it. A report that needs its scripts is
 *   opened in the default app instead, from the tree's context menu or the
 *   preview header.
 * - **`allow-same-origin`** is what lets *this* component reach into the frame
 *   to catch link clicks. It is safe only because scripts are off: with both
 *   flags set, the frame could lift its own sandbox.
 *
 * Forms, popups and top-level navigation stay blocked by the sandbox too.
 */
export function HtmlPreview({ path, content }: Props) {
  const [srcDoc, setSrcDoc] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setSrcDoc(null);
    void (async () => {
      const doc = new DOMParser().parseFromString(content, "text/html");
      await prepareHtmlDocument(doc, path, {
        readText: api.docsReadFile,
        readImage: api.docsReadAsset,
      });
      if (live) setSrcDoc(serializeHtmlDocument(doc));
    })();
    return () => {
      live = false;
    };
  }, [path, content]);

  // Links behave as they do in the Markdown preview: an external one opens in
  // the browser, never inside the frame. An in-page `#anchor` is left to the
  // frame so a table of contents still scrolls.
  const onLoad = useCallback((e: SyntheticEvent<HTMLIFrameElement>) => {
    const doc = e.currentTarget.contentDocument;
    doc?.addEventListener("click", (event) => {
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      if (href.startsWith("#")) return;
      event.preventDefault();
      if (/^(https?:|mailto:)/i.test(href)) void openUrl(href);
    });
  }, []);

  if (srcDoc === null) {
    return <p className="px-4 py-3 text-xs text-muted-foreground">Preparing page…</p>;
  }
  return (
    <iframe
      title={path}
      sandbox="allow-same-origin"
      srcDoc={srcDoc}
      onLoad={onLoad}
      // White like a browser tab: an HTML file that sets no background of its
      // own was written for one, and would be dark-on-dark on this app's theme.
      className="h-full w-full border-0 bg-white"
    />
  );
}
