import { useCallback, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { DirState } from "@/lib/docs/tree-nav";

/**
 * The Docs tab's directory cache: one listing per folder, fetched when
 * something on screen needs it and kept until the next refresh.
 *
 * It used to live inside `DocsTree`, one `useEffect` per rendered level. It is
 * hoisted here because the tree is no longer the only reader — the file-list
 * pane shows the selected folder's files, and fetching the same folder twice
 * on a Google Drive share is exactly the cost the lazy tree exists to avoid
 * (T-0276).
 *
 * Nothing is walked recursively. A folder is read when a caller asks for it,
 * which is what lets the tab open instantly on a share whose full tree would
 * take seconds to pull down.
 */
export function useDocsDirs(onBusyChange?: (busy: boolean) => void) {
  const [dirs, setDirs] = useState<Record<string, DirState>>({});
  // Which refresh each folder was last fetched under. A ref rather than state
  // because the claim has to be synchronous: two callers asking in the same
  // tick would both see an unclaimed folder if this went through setState, and
  // both would hit the share for it.
  const fetchedAt = useRef<Record<string, number>>({});
  // How many listings are in flight. A count rather than a flag because a
  // refresh re-reads every open folder at once; the callback sits in a ref so
  // `ensureLoaded` can stay identity-stable.
  const inFlight = useRef(0);
  const busyChange = useRef(onBusyChange);
  busyChange.current = onBusyChange;

  const ensureLoaded = useCallback((path: string, token: number) => {
    if (!path || fetchedAt.current[path] === token) return;
    fetchedAt.current[path] = token;
    setDirs((prev) => ({ ...prev, [path]: { status: "loading" } }));
    if (inFlight.current++ === 0) busyChange.current?.(true);
    // A slow read answering after a newer one was started (a refresh, or the
    // folder picked again) must not paint its stale result over the fresh one.
    const current = () => fetchedAt.current[path] === token;
    api
      .docsListDir(path)
      .then((entries) => {
        if (current()) setDirs((prev) => ({ ...prev, [path]: { status: "ready", entries } }));
      })
      .catch((e) => {
        if (current()) {
          setDirs((prev) => ({ ...prev, [path]: { status: "error", message: String(e) } }));
        }
      })
      .finally(() => {
        if (--inFlight.current === 0) busyChange.current?.(false);
      });
  }, []);

  return { dirs, ensureLoaded };
}
