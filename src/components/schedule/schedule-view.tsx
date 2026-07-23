import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Download, Plus, RefreshCw } from "lucide-react";
import { ItemEditor } from "@/components/schedule/item-editor";
import { ScheduleAiPanel } from "@/components/schedule/schedule-ai-panel";
import { ScheduleGrid } from "@/components/schedule/schedule-grid";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { exportScheduleHtml } from "@/lib/schedule/export";
import { formatRange, parseRange, shiftDate, toISO } from "@/lib/schedule/layout";
import {
  nextItemId,
  parseSchedule,
  serializeSchedule,
  type ScheduleDocModel,
  type ScheduleItem,
} from "@/lib/schedule/parse";
import type { Config, ScheduleEditRun, ScheduleFile, Task } from "@/types";

/**
 * The Schedule tab (design note §6).
 *
 * The note on disk is the source of truth, so this view is a loop rather than
 * a store: parse the file into a model, let gestures mutate the model,
 * serialize back, and let the file watcher bring external edits in. Two
 * details make that safe:
 *
 * - **Debounced writes.** Dragging a bar produces a change per pixel-step;
 *   writing each one would thrash the file and the watcher. Edits land in
 *   state immediately and reach disk once the user pauses.
 * - **mtime guarding.** Every write carries the mtime the content was read at.
 *   An Obsidian or agent edit in between is reported instead of overwritten.
 */

/** Quiet period after the last edit before the file is written. */
const SAVE_DEBOUNCE_MS = 600;
/** Default window when a note has no usable `range` (design note §3.1). */
const DEFAULT_WEEKS = 6;

interface Props {
  /** Bumped by the app shell after settings are saved. */
  configVersion: number;
}

export function ScheduleView({ configVersion }: Props) {
  const [config, setConfig] = useState<Config | null>(null);
  const [files, setFiles] = useState<ScheduleFile[]>([]);
  const [project, setProject] = useState("");
  const [path, setPath] = useState("");
  const [doc, setDoc] = useState<ScheduleDocModel | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [aiRun, setAiRun] = useState<ScheduleEditRun | null>(null);
  const [selected, setSelected] = useState<ScheduleItem | null>(null);
  const [status, setStatus] = useState("");
  const [window_, setWindow] = useState<{ start: string; end: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  // The raw file text and the mtime it was read at: serialization needs the
  // original bytes to preserve `## Memo` and unmanaged frontmatter, and the
  // mtime is what makes the next write conflict-safe.
  const source = useRef<{ content: string; mtime: number }>({ content: "", mtime: 0 });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const vaultPath = config?.settings.vault_path ?? null;
  const aiRunning = aiRun?.state === "running";

  useEffect(() => {
    void api.getConfig().then(setConfig);
  }, [configVersion]);

  const loadFiles = useCallback(async () => {
    if (!vaultPath) return;
    setFiles(await api.listSchedules(vaultPath, project));
  }, [vaultPath, project]);

  const loadDoc = useCallback(async (target: string) => {
    if (!target) {
      setDoc(null);
      return;
    }
    const read = await api.readSchedule(target);
    source.current = { content: read.content, mtime: read.mtime };
    const parsed = parseSchedule(read.content);
    setDoc(parsed);
    setWindow((prev) => prev ?? parseRange(parsed.range) ?? defaultWindow());
  }, []);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    if (!vaultPath) return;
    void api.listTasks(vaultPath).then(setTasks);
  }, [vaultPath]);

  useEffect(() => {
    void loadDoc(path);
    // Each note carries its own range; drop the window so the new note's is used.
    setWindow(null);
    setSelected(null);
  }, [path, loadDoc]);

  // External edits (Obsidian, the AI agent) arrive as events rather than
  // polling, so the calendar follows the file without a refresh button.
  useEffect(() => {
    const unlisten = listen("schedules-changed", () => {
      void loadFiles();
      if (path) void loadDoc(path);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [path, loadDoc, loadFiles]);

  useEffect(() => {
    void api.scheduleEditStatus().then(setAiRun);
    const unlisten = listen<ScheduleEditRun>("schedule-edit:status", (e) => setAiRun(e.payload));
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  /**
   * Applies a change to the in-memory model and schedules a write. The model
   * updates synchronously so dragging stays responsive; disk catches up when
   * the gesture settles.
   */
  const mutate = useCallback(
    (next: ScheduleDocModel) => {
      if (aiRunning) return; // the agent holds the file
      setDoc(next);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void (async () => {
          const content = serializeSchedule(source.current.content, next, toISO(new Date()));
          try {
            const mtime = await api.writeSchedule(path, content, source.current.mtime);
            source.current = { content, mtime };
            setStatus("");
          } catch (e) {
            // A conflict is not recoverable by retrying: the user has to see
            // the other edit before deciding, so surface it and reload.
            setStatus(String(e));
            void loadDoc(path);
          }
        })();
      }, SAVE_DEBOUNCE_MS);
    },
    [aiRunning, path, loadDoc],
  );

  const patchItem = useCallback(
    (id: string, patch: (item: ScheduleItem) => ScheduleItem) => {
      if (!doc) return;
      mutate({ ...doc, items: doc.items.map((i) => (i.id === id ? patch(i) : i)) });
    },
    [doc, mutate],
  );

  const projectTasks = useMemo(
    () => tasks.filter((t) => !t.archived && (!project || t.project === project)),
    [tasks, project],
  );

  const handleExport = useCallback(async () => {
    if (!doc || !window_ || !vaultPath) return;
    const file = files.find((f) => f.path === path);
    const dir =
      config?.settings.schedule_export_dir?.trim() ||
      `${vaultPath}/projects/${file?.project ?? project}/attachments`;
    const name = `${(doc.title || "schedule").replace(/[\\/:*?"<>|]/g, "-")} ${window_.start}.html`;
    const out = `${dir.replace(/\\/g, "/").replace(/\/$/, "")}/${name}`;
    const html = exportScheduleHtml(doc, { ...window_, today: toISO(new Date()) });
    try {
      await api.exportScheduleHtml(out, html);
      setStatus(`出力しました: ${out}`);
      await api.openExplorer(out);
    } catch (e) {
      setStatus(String(e));
    }
  }, [doc, window_, vaultPath, files, path, project, config]);

  if (!vaultPath) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        Settings で vault を設定するとスケジュールを扱えます。
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs">
        <Select value={project || "__all__"} onValueChange={(v) => setProject(v === "__all__" ? "" : v)}>
          <SelectTrigger className="h-7 w-40 text-xs">
            <SelectValue placeholder="プロジェクト" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">すべてのプロジェクト</SelectItem>
            {[...new Set(files.map((f) => f.project))].map((slug) => (
              <SelectItem key={slug} value={slug}>
                {slug}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={path} onValueChange={setPath}>
          <SelectTrigger className="h-7 w-56 text-xs">
            <SelectValue placeholder="スケジュールを選択" />
          </SelectTrigger>
          <SelectContent>
            {files.map((f) => (
              <SelectItem key={f.path} value={f.path}>
                {f.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {window_ && (
          <div className="flex items-center gap-1">
            <DatePicker
              value={window_.start}
              onChange={(v) => v && setWindow({ ...window_, start: v })}
            />
            <span className="text-muted-foreground">〜</span>
            <DatePicker value={window_.end} onChange={(v) => v && setWindow({ ...window_, end: v })} />
          </div>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => void loadDoc(path)}
            disabled={!path}
          >
            <RefreshCw className="mr-1 size-3" />
            再読込
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => void handleExport()}
            disabled={!doc}
          >
            <Download className="mr-1 size-3" />
            HTML 出力
          </Button>
          <Popover open={creating} onOpenChange={setCreating}>
            <PopoverTrigger asChild>
              <Button size="sm" variant="secondary" className="h-7 text-xs" disabled={!project}>
                <Plus className="mr-1 size-3" />
                新規
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 space-y-2 p-3 text-xs">
              <Input
                value={newTitle}
                placeholder="スケジュール名"
                className="h-8 text-xs"
                onChange={(e) => setNewTitle(e.target.value)}
              />
              <Button
                size="sm"
                className="h-7 w-full text-xs"
                disabled={!newTitle.trim()}
                onClick={() => {
                  void (async () => {
                    const win = window_ ?? defaultWindow();
                    const created = await api.createSchedule(
                      vaultPath,
                      project,
                      newTitle.trim(),
                      formatRange(win.start, win.end),
                    );
                    setNewTitle("");
                    setCreating(false);
                    await loadFiles();
                    setPath(created.path);
                  })();
                }}
              >
                作成
              </Button>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {status && (
        <div className="border-b bg-muted/40 px-3 py-1 text-[11px] text-muted-foreground">
          {status}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto">
          {doc && window_ ? (
            <ScheduleGrid
              doc={doc}
              start={window_.start}
              end={window_.end}
              tasks={projectTasks}
              readOnly={aiRunning}
              onMoveItem={(id, delta) =>
                patchItem(id, (i) => ({
                  ...i,
                  start: shiftDate(i.start, delta),
                  end: shiftDate(i.end, delta),
                }))
              }
              onResizeItem={(id, edge, delta) =>
                patchItem(id, (i) => {
                  const next =
                    edge === "start"
                      ? { ...i, start: shiftDate(i.start, delta) }
                      : { ...i, end: shiftDate(i.end, delta) };
                  // A resize can only shorten a bar to a single day; past that
                  // the gesture would invert it, which the notation forbids.
                  if (next.end < next.start) return i;
                  return next;
                })
              }
              onSelectItem={(item) => setSelected(item)}
              onToggleNonWorking={(date) => toggleNonWorking(date)}
              onCreateBar={(start, end) => createBar(start, end)}
              onMoveTaskDue={(taskId, date) => {
                void api.updateTask(vaultPath, { id: taskId, due: date }).then(() => {
                  void api.listTasks(vaultPath).then(setTasks);
                });
              }}
            />
          ) : (
            <div className="p-6 text-sm text-muted-foreground">
              スケジュールを選択するか、プロジェクトを選んで新規作成してください。
            </div>
          )}
        </div>

        {selected && doc && (
          <div className="w-72 shrink-0 border-l">
            <ItemEditor
              item={selected}
              tasks={projectTasks}
              onChange={(next) => {
                setSelected(next);
                patchItem(next.id, () => next);
              }}
              onDelete={() => {
                mutate({ ...doc, items: doc.items.filter((i) => i.id !== selected.id) });
                setSelected(null);
              }}
              onClose={() => setSelected(null)}
            />
          </div>
        )}

        {aiRun && path && (
          <ScheduleAiPanel
            run={aiRun}
            defaultConfirm={config?.settings.schedule_confirm ?? false}
            onRun={(instruction, confirm) => {
              void api.runScheduleEdit(path, instruction, confirm).catch((e) => setStatus(String(e)));
            }}
            onUndo={() => {
              void api
                .restoreScheduleSnapshot(path)
                .then(() => loadDoc(path))
                .catch((e) => setStatus(String(e)));
            }}
          />
        )}
      </div>
    </div>
  );

  function toggleNonWorking(date: string) {
    if (!doc) return;
    const covering = doc.nonWorking.ranges.find((r) => date >= r.start && date <= r.end);
    if (covering) {
      // Only whole explicit entries are removed. Carving a day out of a
      // multi-day range would need to split it in two, which is a file edit
      // the user is better off making in Obsidian than discovering by
      // right-clicking.
      mutate({
        ...doc,
        nonWorking: {
          ...doc.nonWorking,
          ranges: doc.nonWorking.ranges.filter((r) => r !== covering),
        },
      });
      return;
    }
    mutate({
      ...doc,
      nonWorking: {
        ...doc.nonWorking,
        ranges: [...doc.nonWorking.ranges, { start: date, end: date, label: "" }].sort((a, b) =>
          a.start.localeCompare(b.start),
        ),
      },
    });
  }

  function createBar(start: string, end: string) {
    if (!doc) return;
    const item: ScheduleItem = {
      kind: "bar",
      id: nextItemId(doc.items),
      start,
      end,
      title: "新しい帯",
      color: "blue",
    };
    mutate({ ...doc, items: [...doc.items, item] });
    setSelected(item);
  }
}

/** Six weeks from today — long enough to hold a phase, short enough to read. */
function defaultWindow(): { start: string; end: string } {
  const today = toISO(new Date());
  return { start: today, end: shiftDate(today, DEFAULT_WEEKS * 7 - 1) };
}
