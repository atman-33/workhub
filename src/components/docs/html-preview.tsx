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
 * Scrolls the frame to the element a `#fragment` names, the way the browser
 * would: by `id`, then by `<a name>`, with an empty fragment or `#top` meaning
 * the top of the page.
 */
function scrollToFragment(doc: Document, fragment: string) {
  let id = fragment;
  try {
    id = decodeURIComponent(fragment);
  } catch {
    // A stray `%` — look the fragment up as written.
  }
  const target =
    doc.getElementById(id) ?? doc.getElementsByName(id)[0] ?? null;
  if (target) target.scrollIntoView();
  else if (id === "" || id.toLowerCase() === "top") doc.defaultView?.scrollTo(0, 0);
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

  // No link is ever allowed to navigate the frame. An external one opens in
  // the browser, as in the Markdown preview; an in-page `#anchor` is scrolled
  // to by hand; anything else does nothing.
  //
  // The anchor case cannot be left to the browser: a srcdoc document takes its
  // base URL from the parent, so `#bottom` resolves to the *app's* URL plus a
  // fragment. That is a different document, the frame navigates to it, and
  // the app's own index.html loads with scripts off — its boot spinner then
  // turns forever inside the preview.
  const onLoad = useCallback((e: SyntheticEvent<HTMLIFrameElement>) => {
    const doc = e.currentTarget.contentDocument;
    doc?.addEventListener("click", (event) => {
      const anchor = (event.target as Element | null)?.closest?.("a[href], area[href]");
      if (!anchor) return;
      event.preventDefault();
      const href = anchor.getAttribute("href") ?? "";
      if (href.startsWith("#")) scrollToFragment(doc, href.slice(1));
      else if (/^(https?:|mailto:)/i.test(href)) void openUrl(href);
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
