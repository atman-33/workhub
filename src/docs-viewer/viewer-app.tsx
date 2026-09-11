import { useEffect, useState } from "react";
import { DocsPreview } from "@/components/docs/docs-preview";
import { FigureViewer } from "@/components/docs/figure-viewer";
import { api } from "@/lib/api";
import type { DocsViewerPayload } from "@/types";

/**
 * A Docs viewer window (T-0279): one document or one figure popped out of the
 * Docs tab. What to show is fetched from the backend, which holds the payload
 * for this window's label (see `src-tauri/src/docs_viewer.rs`).
 *
 * The OS title bar is kept, so there is no header of our own to drag by and
 * closing is the window's ✕.
 */
export function ViewerApp() {
  const [payload, setPayload] = useState<DocsViewerPayload | null | undefined>(undefined);
  const [loadError, setLoadError] = useState("");
  // What the document's own buttons report (open with default app, …).
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .docsViewerPayload()
      .then((p) => setPayload(p))
      .catch((e) => setLoadError(String(e)));
  }, []);

  if (loadError || payload === null) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-6 text-xs text-destructive">
        {loadError || "Nothing to show — this window lost what it was opened for."}
      </div>
    );
  }
  if (payload === undefined) return <div className="h-full bg-background" />;

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {error && (
        <div className="border-b bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive">
          {error}
        </div>
      )}
      <div className="min-h-0 flex-1">
        {payload.kind === "doc" ? (
          <DocsPreview path={payload.path} refreshToken={0} onError={setError} standalone />
        ) : (
          <FigureViewer figure={payload.figure} />
        )}
      </div>
    </div>
  );
}
