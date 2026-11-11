import { describe, expect, it, vi } from "vitest";
import {
  createDiagramSession,
  SAVE_DEBOUNCE_MS,
  UNDO_LIMIT,
  type DiagramAdapter,
  type DiagramClock,
  type DiagramFileApi,
} from "@/lib/diagram/session";

/** A model is just its text; serialize keeps the source's first line as the "unmanaged" part. */
type Doc = { text: string };
const adapter: DiagramAdapter<Doc> = {
  parse: (content, fallback) => ({ text: content.split("\n")[1] ?? fallback }),
  serialize: (source, doc, today) => `${source.split("\n")[0]}\n${doc.text}\n${today}`,
};

function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: DiagramClock = {
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (h) => void timers.delete(h as number),
    today: () => "2026-11-11",
  };
  return {
    clock,
    pendingTimers: () => timers.size,
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id);
          t.fn();
        }
      }
    },
  };
}

function fakeApi(files: Record<string, { content: string; mtime: number }>) {
  const listeners = new Set<() => void>();
  const writes: { path: string; content: string; expected: number }[] = [];
  const reads: string[] = [];
  let failWrite: Error | null = null;
  let mtimeCounter = 1000;
  const api: DiagramFileApi = {
    read: async (path) => {
      reads.push(path);
      const f = files[path];
      if (!f) throw new Error("not found");
      return { ...f };
    },
    write: async (path, content, expected) => {
      writes.push({ path, content, expected });
      if (failWrite) throw failWrite;
      files[path] = { content, mtime: ++mtimeCounter };
      return files[path].mtime;
    },
    onChanged: (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
  };
  return {
    api,
    files,
    writes,
    reads,
    emitChanged: () => listeners.forEach((l) => l()),
    listenerCount: () => listeners.size,
    failNextWrite: (e: Error | null) => (failWrite = e),
  };
}

const flushMicrotasks = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function setup(files: Record<string, { content: string; mtime: number }> = {}) {
  const f = fakeApi({ "/a.md": { content: "fm\nA\n", mtime: 1 }, "/b.md": { content: "fm\nB\n", mtime: 2 }, ...files });
  const c = fakeClock();
  const onPathChange = vi.fn();
  const session = createDiagramSession<Doc>({
    api: f.api,
    clock: c.clock,
    adapter,
    inputs: { fallbackTitle: "fallback", onPathChange },
  });
  const detach = session.attach();
  return { f, c, session, onPathChange, detach };
}

async function openA() {
  const s = setup();
  s.session.open("/a.md");
  await flushMicrotasks();
  return s;
}

describe("Diagram session", () => {
  it("loads the note, parses it and bumps loadedToken", async () => {
    const { session } = await openA();
    expect(session.getSnapshot()).toMatchObject({ doc: { text: "A" }, loadedToken: 1, saveError: "", canUndo: false });
  });

  it("passes the fallback title to the adapter", async () => {
    const s = setup({ "/c.md": { content: "fm", mtime: 3 } });
    s.session.open("/c.md");
    await flushMicrotasks();
    expect(s.session.getSnapshot().doc).toEqual({ text: "fallback" });
  });

  it("a read failure clears the doc and lets go of the path", async () => {
    const s = setup();
    s.session.open("/missing.md");
    await flushMicrotasks();
    expect(s.session.getSnapshot().doc).toBeNull();
    expect(s.onPathChange).toHaveBeenCalledWith("");
  });

  it("an empty path shows no doc without reading", async () => {
    const s = await openA();
    s.f.reads.length = 0;
    s.session.open("");
    await flushMicrotasks();
    expect(s.session.getSnapshot().doc).toBeNull();
    expect(s.f.reads).toEqual([]);
  });

  it("writes once after the debounce, guarded by the mtime it read", async () => {
    const { session, c, f } = await openA();
    session.mutate({ text: "A1" });
    c.advance(SAVE_DEBOUNCE_MS - 1);
    session.mutate({ text: "A2" });
    c.advance(SAVE_DEBOUNCE_MS - 1);
    expect(f.writes).toEqual([]);
    c.advance(1);
    await flushMicrotasks();
    expect(f.writes).toEqual([{ path: "/a.md", content: "fm\nA2\n2026-11-11", expected: 1 }]);
  });

  it("a conflict surfaces the error and reloads the note", async () => {
    const { session, c, f } = await openA();
    session.mutate({ text: "mine" });
    f.failNextWrite(new Error("conflict"));
    f.files["/a.md"] = { content: "fm\ntheirs\n", mtime: 9 };
    c.advance(SAVE_DEBOUNCE_MS);
    await flushMicrotasks();
    const snap = session.getSnapshot();
    expect(snap.saveError).toContain("conflict");
    expect(snap.doc).toEqual({ text: "theirs" });
    expect(snap.canUndo).toBe(false);
  });

  it("a successful write clears the saveError", async () => {
    const { session, c, f } = await openA();
    session.mutate({ text: "x" });
    f.failNextWrite(new Error("conflict"));
    c.advance(SAVE_DEBOUNCE_MS);
    await flushMicrotasks();
    f.failNextWrite(null);
    session.mutate({ text: "y" });
    c.advance(SAVE_DEBOUNCE_MS);
    await flushMicrotasks();
    expect(session.getSnapshot().saveError).toBe("");
  });

  it("opening another note writes the pending edit first, then loads", async () => {
    const { session, f } = await openA();
    session.mutate({ text: "A!" });
    session.open("/b.md");
    await flushMicrotasks();
    expect(f.writes).toEqual([{ path: "/a.md", content: "fm\nA!\n2026-11-11", expected: 1 }]);
    expect(session.getSnapshot().doc).toEqual({ text: "B" });
    // The old note's write must not become B's conflict guard.
    session.mutate({ text: "B!" });
    await session.flush();
    expect(f.writes[1]).toMatchObject({ path: "/b.md", expected: 2 });
  });

  it("drops the echo of its own save (same mtime) and keeps undo", async () => {
    const { session, c, f } = await openA();
    session.mutate({ text: "A1" });
    c.advance(SAVE_DEBOUNCE_MS);
    await flushMicrotasks();
    const before = session.getSnapshot();
    f.reads.length = 0;
    f.emitChanged();
    await flushMicrotasks();
    expect(f.reads).toEqual(["/a.md"]);
    expect(session.getSnapshot()).toBe(before);
    expect(before.canUndo).toBe(true);
  });

  it("an external change reloads and clears undo/redo", async () => {
    const { session, f } = await openA();
    session.mutate({ text: "A1" });
    await session.flush();
    session.undo();
    expect(session.getSnapshot().canRedo).toBe(true);
    await session.flush();
    f.files["/a.md"] = { content: "fm\nexternal\n", mtime: 77 };
    f.emitChanged();
    await flushMicrotasks();
    expect(session.getSnapshot()).toMatchObject({ doc: { text: "external" }, canUndo: false, canRedo: false });
  });

  it("an external change is ignored while an edit is pending", async () => {
    const { session, f } = await openA();
    session.mutate({ text: "typing" });
    f.reads.length = 0;
    f.files["/a.md"] = { content: "fm\nexternal\n", mtime: 77 };
    f.emitChanged();
    await flushMicrotasks();
    expect(f.reads).toEqual([]);
    expect(session.getSnapshot().doc).toEqual({ text: "typing" });
  });

  it("an external change to a different mtime does not bump loadedToken", async () => {
    const { session, f } = await openA();
    f.files["/a.md"] = { content: "fm\nexternal\n", mtime: 77 };
    f.emitChanged();
    await flushMicrotasks();
    expect(session.getSnapshot().loadedToken).toBe(1);
  });

  it("reload() re-reads even when the mtime is unchanged", async () => {
    const { session, f } = await openA();
    session.mutate({ text: "A1" });
    await session.flush();
    f.files["/a.md"] = { content: "fm\nsame-mtime\n", mtime: f.files["/a.md"].mtime };
    session.reload();
    await flushMicrotasks();
    expect(session.getSnapshot()).toMatchObject({ doc: { text: "same-mtime" }, canUndo: false });
  });

  it("ignores mutations while the Agent lock is held", async () => {
    const { session, c, f } = await openA();
    session.setInputs({ locked: true });
    session.mutate({ text: "nope" });
    session.preview({ text: "nope" });
    c.advance(SAVE_DEBOUNCE_MS);
    await flushMicrotasks();
    expect(session.getSnapshot()).toMatchObject({ doc: { text: "A" }, canUndo: false });
    expect(f.writes).toEqual([]);
  });

  it("ignores a mutation that returns the same doc, or arrives before a doc", async () => {
    const s = setup();
    s.session.mutate({ text: "early" });
    expect(s.session.getSnapshot().doc).toBeNull();
    s.session.open("/a.md");
    await flushMicrotasks();
    s.session.mutate(s.session.getSnapshot().doc!);
    expect(s.session.getSnapshot().canUndo).toBe(false);
    expect(s.c.pendingTimers()).toBe(0);
  });

  it("undo and redo walk the history and write the result", async () => {
    const { session, f } = await openA();
    session.mutate({ text: "A1" });
    session.mutate({ text: "A2" });
    session.undo();
    expect(session.getSnapshot()).toMatchObject({ doc: { text: "A1" }, canUndo: true, canRedo: true });
    session.redo();
    expect(session.getSnapshot().doc).toEqual({ text: "A2" });
    session.undo();
    await session.flush();
    expect(f.writes.at(-1)?.content).toBe("fm\nA1\n2026-11-11");
  });

  it("a new edit clears the redo stack", async () => {
    const { session } = await openA();
    session.mutate({ text: "A1" });
    session.undo();
    session.mutate({ text: "A2" });
    expect(session.getSnapshot().canRedo).toBe(false);
  });

  it("preview shows and saves without recording undo", async () => {
    const { session, f } = await openA();
    session.preview({ text: "drag" });
    expect(session.getSnapshot()).toMatchObject({ doc: { text: "drag" }, canUndo: false });
    await session.flush();
    expect(f.writes).toHaveLength(1);
  });

  it("keeps at most UNDO_LIMIT undo steps", async () => {
    const { session } = await openA();
    for (let i = 0; i < UNDO_LIMIT + 5; i++) session.mutate({ text: `e${i}` });
    let steps = 0;
    while (session.getSnapshot().canUndo) {
      session.undo();
      steps++;
    }
    expect(steps).toBe(UNDO_LIMIT);
    // The oldest states were dropped: "A" is no longer reachable.
    expect(session.getSnapshot().doc).toEqual({ text: "e4" });
  });

  it("flush writes now, and is a no-op with nothing pending", async () => {
    const { session, f, c } = await openA();
    await session.flush();
    expect(f.writes).toEqual([]);
    session.mutate({ text: "A1" });
    await session.flush();
    expect(f.writes).toHaveLength(1);
    expect(c.pendingTimers()).toBe(0);
  });

  it("detaching writes the pending edit and stops listening", async () => {
    const { session, f, detach } = await openA();
    session.mutate({ text: "A1" });
    detach();
    await flushMicrotasks();
    expect(f.writes).toHaveLength(1);
    expect(f.listenerCount()).toBe(0);
  });

  it("notifies subscribers on change only", async () => {
    const { session } = await openA();
    const l = vi.fn();
    const off = session.subscribe(l);
    session.mutate({ text: "A1" });
    expect(l).toHaveBeenCalledTimes(1);
    session.setInputs({ locked: false });
    expect(l).toHaveBeenCalledTimes(1);
    off();
    session.mutate({ text: "A2" });
    expect(l).toHaveBeenCalledTimes(1);
  });
});
