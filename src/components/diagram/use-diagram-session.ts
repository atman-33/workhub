import { useEffect, useRef, useSyncExternalStore } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "@/lib/api";
import {
  createDiagramSession,
  type DiagramAdapter,
  type DiagramClock,
  type DiagramFileApi,
  type DiagramSession,
  type DiagramSnapshot,
  todayISO,
} from "@/lib/diagram/session";
import type { EmbeddedDiagram } from "@/lib/embedded-diagram";

const fileApi: DiagramFileApi = {
  read: (path) => api.readDiagram(path),
  write: (path, content, expectedMtime) => api.writeDiagram(path, content, expectedMtime),
  onChanged: (listener) => {
    const unlisten = listen("diagrams-changed", listener);
    return () => void unlisten.then((fn) => fn());
  },
};

const clock: DiagramClock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  today: todayISO,
};

export type DiagramSessionView<Doc> = DiagramSnapshot<Doc> &
  Pick<DiagramSession<Doc>, "mutate" | "preview" | "undo" | "redo" | "flush">;

/**
 * Binds a Diagram session (T-1218) to a view: opens the note the Diagrams tab
 * hands over, follows its Agent lock and reload token, and registers the
 * flush the host calls before an AI edit. `adapter` must be a stable
 * (module-level) object.
 */
export function useDiagramSession<Doc>(
  adapter: DiagramAdapter<Doc>,
  embedded: EmbeddedDiagram,
): DiagramSessionView<Doc> {
  const ref = useRef<DiagramSession<Doc> | null>(null);
  if (ref.current === null) {
    ref.current = createDiagramSession({ api: fileApi, clock, adapter });
  }
  const session = ref.current;

  // The host hands fresh callbacks on every render; the session reads the
  // latest through its inputs, so nothing below depends on them.
  session.setInputs({
    locked: embedded.locked,
    fallbackTitle: embedded.title,
    onPathChange: embedded.onPathChange,
  });

  const { path, reloadToken } = embedded;
  const registerFlush = useRef(embedded.registerFlush);
  registerFlush.current = embedded.registerFlush;

  useEffect(() => session.attach(), [session]);
  useEffect(() => session.open(path), [session, path]);

  const handledReload = useRef(reloadToken);
  useEffect(() => {
    if (reloadToken === handledReload.current) return;
    handledReload.current = reloadToken;
    session.reload();
  }, [session, reloadToken]);

  useEffect(() => {
    registerFlush.current(session.flush);
    return () => registerFlush.current(null);
  }, [session]);

  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  return {
    ...snapshot,
    mutate: session.mutate,
    preview: session.preview,
    undo: session.undo,
    redo: session.redo,
    flush: session.flush,
  };
}
