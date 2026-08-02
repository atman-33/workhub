import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  CalendarCheck,
  CalendarDays,
  Download,
  GanttChart,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
} from "lucide-react";
import { ItemEditor } from "@/components/schedule/item-editor";
import { ScheduleAiPanel } from "@/components/schedule/schedule-ai-panel";
import { ScheduleGrid } from "@/components/schedule/schedule-grid";
import { SprintSettings } from "@/components/schedule/sprint-settings";
import { TimelineGrid } from "@/components/schedule/timeline-grid";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { exportScheduleHtml } from "@/lib/schedule/export";
import { isScheduleLocale, type ScheduleLocale } from "@/lib/schedule/i18n";
import {
  calendarDays,
  formatRange,
  panWindow,
  parseRange,
  shiftDate,
  toISO,
  toggleNonWorkingDay,
  windowAround,
  zoomWindow,
} from "@/lib/schedule/layout";
import {
  isRangeKind,
  nextItemId,
  parseSchedule,
  serializeSchedule,
  type ItemKind,
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
/** Depth of the in-memory undo stack (Ctrl+Z). Deep enough to walk back out of
 * a run of experiments, shallow enough that it is obviously not a substitute
 * for the file's git history. */
const UNDO_LIMIT = 50;
/** Default window when a note has no usable `range` (design note §3.1). */
const DEFAULT_WEEKS = 6;
/**
 * Window the timeline opens on, in weeks (about six months).
 *
 * A long-range plan is the question the timeline exists to answer, and the
 * six-week calendar window shows a single phase — arriving there zoomed that
 * far in reads as the mode being broken. Applied only when the current window
 * is *shorter*, so a window the user already widened is left alone.
 */
const TIMELINE_WEEKS = 26;
/** Below this, switching to the timeline widens the window to `TIMELINE_WEEKS`. */
const TIMELINE_MIN_WEEKS = 10;

/** How the note is drawn. Session state, deliberately not persisted: which
 * question you are asking of a plan changes several times an hour. */
type ViewMode = "calendar" | "timeline";
/** Starting width of the right column, in percent of the view. Roughly the
 * fixed 288px it replaced at a typical window size. */
const SIDEBAR_DEFAULT_PCT = 22;

interface Props {
  /** Bumped by the app shell after settings are saved. */
  configVersion: number;
}

export function ScheduleView({ configVersion }: Props) {
  const [config, setConfig] = useState<Config | null>(null);
  const [files, setFiles] = useState<ScheduleFile[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState("");
  const [path, setPath] = useState("");
  const [doc, setDoc] = useState<ScheduleDocModel | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [aiRun, setAiRun] = useState<ScheduleEditRun | null>(null);
  // Only the *id* of the selection is state; the element itself is looked up in
  // the document below. Keeping a copy here would fork the truth: a drag on the
  // grid edits `doc` without passing through the side panel, and the panel's
  // next edit would write the pre-drag copy back over it (T-0101).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [window_, setWindow] = useState<{ start: string; end: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [mode, setMode] = useState<ViewMode>("calendar");
  // Session-only: the calendar reads better at full width when reviewing or
  // before an export, but that is a preference for a moment, not for a
  // machine, so it is deliberately not persisted to settings.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Width of the right column, in percent, kept here rather than left to the
  // panel group: hiding the sidebar unmounts its panel, and without a
  // remembered size every collapse/expand round trip would snap it back to the
  // default. Session-only for the same reason as the collapse flag.
  const [sidebarSize, setSidebarSize] = useState(SIDEBAR_DEFAULT_PCT);
  // Document snapshots for Ctrl+Z / Ctrl+Shift+Z. In memory only: undo is for
  // "that drag went somewhere I didn't mean", not for history — the file's git
  // backup and the AI-edit snapshot cover the durable cases.
  const undoStack = useRef<ScheduleDocModel[]>([]);
  const redoStack = useRef<ScheduleDocModel[]>([]);

  // The raw file text and the mtime it was read at: serialization needs the
  // original bytes to preserve `## Memo` and unmanaged frontmatter, and the
  // mtime is what makes the next write conflict-safe.
  const source = useRef<{ content: string; mtime: number }>({ content: "", mtime: 0 });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The calendar's scroll container — what the Today button scrolls. */
  const scrollRef = useRef<HTMLDivElement>(null);

  const vaultPath = config?.settings.vault_path ?? null;
  const aiRunning = aiRun?.state === "running";
  const rawLocale = config?.settings.schedule_locale ?? "en";
  const locale: ScheduleLocale = isScheduleLocale(rawLocale) ? rawLocale : "en";

  useEffect(() => {
    void api.getConfig().then(setConfig);
  }, [configVersion]);

  // Today is state, not a value read during render: the view re-renders only on
  // file events, so a window left open overnight would keep marking yesterday.
  // A minute's granularity is plenty for a marker that changes at midnight.
  const [today, setToday] = useState(() => toISO(new Date()));
  useEffect(() => {
    const id = setInterval(() => {
      const now = toISO(new Date());
      setToday((prev) => (prev === now ? prev : now));
    }, 60_000);
    return () => clearInterval(id);
  }, []);

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
    // A reload means the file, not the user, decided the current state — the
    // stack would otherwise let Ctrl+Z "undo" someone else's edit.
    undoStack.current = [];
    redoStack.current = [];
    setDoc(parsed);
    setWindow((prev) => prev ?? parseRange(parsed.range) ?? defaultWindow());
  }, []);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    if (!vaultPath) return;
    void api.listTasks(vaultPath).then(setTasks);
    void api.listScheduleProjects(vaultPath).then(setProjects);
  }, [vaultPath]);

  useEffect(() => {
    void loadDoc(path);
    // Each note carries its own range; drop the window so the new note's is used.
    setWindow(null);
    setSelectedId(null);
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
   * Writes a model to state and schedules the file write, without touching the
   * undo stacks — the undo/redo handlers manage those themselves.
   */
  const apply = useCallback(
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

  /**
   * Applies a user edit: records the previous state for undo, then writes.
   *
   * Every drag, resize, toggle and delete goes through here, which is what
   * makes one Ctrl+Z always mean "the last thing I did" — including the
   * clicks that now toggle non-working days, where a mis-click is easy.
   */
  const mutate = useCallback(
    (next: ScheduleDocModel) => {
      if (aiRunning || !doc) return;
      undoStack.current = [...undoStack.current, doc].slice(-UNDO_LIMIT);
      redoStack.current = [];
      apply(next);
    },
    [aiRunning, doc, apply],
  );

  const undo = useCallback(() => {
    const previous = undoStack.current.at(-1);
    if (!previous || !doc || aiRunning) return;
    undoStack.current = undoStack.current.slice(0, -1);
    redoStack.current = [...redoStack.current, doc];
    setSelectedId(null);
    apply(previous);
  }, [doc, aiRunning, apply]);

  const redo = useCallback(() => {
    const next = redoStack.current.at(-1);
    if (!next || !doc || aiRunning) return;
    redoStack.current = redoStack.current.slice(0, -1);
    undoStack.current = [...undoStack.current, doc];
    setSelectedId(null);
    apply(next);
  }, [doc, aiRunning, apply]);

  const patchItem = useCallback(
    (id: string, patch: (item: ScheduleItem) => ScheduleItem) => {
      if (!doc) return;
      mutate({ ...doc, items: doc.items.map((i) => (i.id === id ? patch(i) : i)) });
    },
    [doc, mutate],
  );

  /**
   * The selected element, read out of the document rather than remembered.
   *
   * This is what keeps the side panel honest against every edit that does not
   * originate in it — a drag, an arrow-key nudge, an undo, a reload after an
   * Obsidian or agent edit. It also closes the panel on its own when the
   * element goes away, since a deleted id simply finds nothing.
   */
  const selected = useMemo(
    () => (selectedId ? (doc?.items.find((i) => i.id === selectedId) ?? null) : null),
    [doc, selectedId],
  );

  const projectTasks = useMemo(
    () => tasks.filter((t) => !t.archived && (!project || t.project === project)),
    [tasks, project],
  );

  /**
   * The project a new schedule would be created in.
   *
   * The dropdown is the obvious source, but under "All projects" it names
   * none — and an open note does, since every schedule belongs to exactly one
   * project. Falling back to it is what lets "I am looking at this plan, give
   * me another one like it" work without first re-picking the project the
   * open file is already in. Empty only when neither is available, which is
   * the one case New has nothing to act on.
   */
  const targetProject = useMemo(
    () => project || files.find((f) => f.path === path)?.project || "",
    [project, files, path],
  );

  const handleExport = useCallback(async () => {
    if (!doc || !window_ || !vaultPath) return;
    const dir =
      config?.settings.schedule_export_dir?.trim() ||
      `${vaultPath}/projects/${targetProject}/attachments`;
    const name = `${(doc.title || "schedule").replace(/[\\/:*?"<>|]/g, "-")} ${window_.start}.html`;
    const out = `${dir.replace(/\\/g, "/").replace(/\/$/, "")}/${name}`;
    // The export follows what is on screen: an approved plan is approved in
    // the drawing it was read in.
    const html = exportScheduleHtml(doc, { ...window_, today: toISO(new Date()), locale, mode });
    try {
      await api.exportScheduleHtml(out, html);
      setStatus(`Exported to ${out}`);
      await api.openExplorer(out);
    } catch (e) {
      setStatus(String(e));
    }
  }, [doc, window_, vaultPath, targetProject, config, locale, mode]);

  /**
   * Keyboard editing: undo/redo, plus nudging the selected element.
   *
   * Dragging is for placing something roughly; the arrow keys are for the last
   * day or two of adjustment, where a mouse is the wrong instrument. Bound on
   * the window rather than a focused element so the shortcuts work straight
   * after a drag, without the user having to click the grid first.
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Never steal a key from a field the user is typing in.
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      if (aiRunning) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key === "Escape") {
        setSelectedId(null);
        return;
      }
      if (!selected) return;

      if (e.key === "Delete") {
        e.preventDefault();
        if (doc) mutate({ ...doc, items: doc.items.filter((i) => i.id !== selected.id) });
        setSelectedId(null);
        return;
      }
      const step = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
      if (!step) return;
      e.preventDefault();
      // Shift resizes the end; without it the whole element moves. A range
      // element can be shortened to a single day but never inverted.
      if (e.shiftKey) {
        if (!isRangeKind(selected.kind)) return;
        const end = shiftDate(selected.end, step);
        if (end < selected.start) return;
        patchItem(selected.id, () => ({ ...selected, end }));
      } else {
        patchItem(selected.id, () => ({
          ...selected,
          start: shiftDate(selected.start, step),
          end: shiftDate(selected.end, step),
        }));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected, doc, aiRunning, undo, redo, mutate, patchItem]);

  /**
   * The displayed window: moved by whole weeks, grown or shrunk from its end,
   * or repositioned onto today.
   *
   * None of this writes the note — the window is view state, and the `range`
   * frontmatter belongs to whoever created the file. That is what makes the
   * wheel gestures safe to fire dozens of times: nothing to save, nothing to
   * undo, nothing that can conflict with an edit made in Obsidian.
   *
   * The setters are functional so these callbacks stay identity-stable: the
   * grid re-registers its non-passive wheel listener whenever they change.
   */
  const panBy = useCallback((weeks: number) => {
    setWindow((prev) => (prev ? panWindow(prev, weeks) : prev));
  }, []);

  const zoomBy = useCallback((weeks: number) => {
    setWindow((prev) => (prev ? zoomWindow(prev, weeks) : prev));
  }, []);

  /** Sets the window to a whole number of weeks from its current start — the
   * timeline's range presets. Like every other window change it is view state
   * and never touches the note. */
  const setWindowWeeks = useCallback((weeks: number) => {
    setWindow((prev) => (prev ? { start: prev.start, end: shiftDate(prev.start, weeks * 7 - 1) } : prev));
  }, []);

  /**
   * Switches drawing mode, widening a too-narrow window on the way into the
   * timeline. Going back to the calendar leaves the window as it is: the user
   * chose that span while looking at the plan, and silently re-cropping it
   * would throw away the thing they just decided.
   */
  const switchMode = useCallback(
    (next: ViewMode) => {
      setMode(next);
      if (next !== "timeline") return;
      setWindow((prev) => {
        if (!prev) return prev;
        const weeks = Math.ceil(calendarDays(prev.start, prev.end) / 7);
        if (weeks >= TIMELINE_MIN_WEEKS) return prev;
        return { start: prev.start, end: shiftDate(prev.start, TIMELINE_WEEKS * 7 - 1) };
      });
    },
    [],
  );

  const scrollToTodayCell = useCallback(() => {
    scrollRef.current
      ?.querySelector("[data-today]")
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);

  /** Set when today first has to be brought into the window: its cell does not
   * exist until that render has happened, so the scroll waits for it. */
  const pendingScroll = useRef(false);
  useEffect(() => {
    if (!pendingScroll.current) return;
    pendingScroll.current = false;
    scrollToTodayCell();
  }, [window_, scrollToTodayCell]);

  const goToToday = useCallback(() => {
    if (window_ && today >= window_.start && today <= window_.end) {
      scrollToTodayCell();
      return;
    }
    pendingScroll.current = true;
    setWindow((prev) => (prev ? windowAround(prev, today) : prev));
  }, [window_, today, scrollToTodayCell]);

  if (!vaultPath) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        Set a vault path in Settings to use schedules.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs">
        <Select value={project || "__all__"} onValueChange={(v) => setProject(v === "__all__" ? "" : v)}>
          <SelectTrigger className="h-7 w-40 text-xs">
            <SelectValue placeholder="Project" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All projects</SelectItem>
            {projects.map((slug) => (
              <SelectItem key={slug} value={slug}>
                {slug}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={path} onValueChange={setPath}>
          <SelectTrigger className="h-7 w-56 text-xs">
            <SelectValue placeholder="Select a schedule" />
          </SelectTrigger>
          <SelectContent>
            {files.map((f) => (
              <SelectItem key={f.path} value={f.path}>
                {f.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Calendar or timeline: the same note at two scales. Kept next to the
            file pickers rather than off to the right, because which drawing is
            on screen changes what every control after it means. */}
        <div className="flex shrink-0 items-center rounded-md border p-0.5">
          {(["calendar", "timeline"] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={mode === value ? "secondary" : "ghost"}
              className="h-6 px-2 text-xs capitalize"
              onClick={() => switchMode(value)}
              disabled={!path}
              title={
                value === "calendar"
                  ? "Week grid — day-level planning"
                  : "Long-range timeline — months, phases and sprints"
              }
            >
              {value === "calendar" ? (
                <CalendarDays className="mr-1 size-3" />
              ) : (
                <GanttChart className="mr-1 size-3" />
              )}
              {value}
            </Button>
          ))}
        </div>

        {window_ && (
          // The date pickers carry an explicit width: `DatePicker` is `w-full`
          // for the form fields it was built for, which in a flex row means
          // "the whole toolbar". Without this the row overflows and the
          // controls after it are drawn on top of each other.
          <div
            className="flex shrink-0 items-center gap-1"
            title="Shift + wheel over the calendar moves this window a week; Ctrl + wheel grows or shrinks it"
          >
            <DatePicker
              value={window_.start}
              className="w-32"
              // An empty value is ignored below, so offering the ✕ would put a
              // control on screen that does nothing when pressed.
              clearable={false}
              onChange={(v) => v && setWindow({ ...window_, start: v })}
            />
            <span className="text-muted-foreground">to</span>
            <DatePicker
              value={window_.end}
              className="w-32"
              clearable={false}
              onChange={(v) => v && setWindow({ ...window_, end: v })}
            />
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={goToToday}
              disabled={!doc}
              title="Show today"
            >
              <CalendarCheck className="mr-1 size-3" />
              Today
            </Button>
          </div>
        )}

        {/* Range presets, and the sprint cadence, belong to the long-range
            reading only: at six weeks there is no sprint band to label and
            nothing to jump a quarter of. */}
        {mode === "timeline" && window_ && (
          <div className="flex shrink-0 items-center gap-1.5">
            {/* Grouped in one bordered box, like the mode switch: the three are
                one control ("how much time do I want on screen"), and loose
                buttons read as three unrelated ones. */}
            <div className="flex items-center rounded-md border p-0.5">
              {[
                { label: "3m", weeks: 13 },
                { label: "6m", weeks: 26 },
                { label: "1y", weeks: 52 },
              ].map((preset) => (
                <Button
                  key={preset.label}
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  onClick={() => setWindowWeeks(preset.weeks)}
                  disabled={!doc}
                  title={`Show ${preset.weeks} weeks from the window start`}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
            {doc && (
              <SprintSettings
                sprint={doc.sprint}
                windowStart={window_.start}
                disabled={aiRunning}
                onChange={(sprint) => mutate({ ...doc, sprint })}
              />
            )}
          </div>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => void loadDoc(path)}
            disabled={!path}
          >
            <RefreshCw className="mr-1 size-3" />
            Reload
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => void handleExport()}
            disabled={!doc}
          >
            <Download className="mr-1 size-3" />
            Export HTML
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => setSidebarCollapsed((v) => !v)}
            disabled={!path}
            title={sidebarCollapsed ? "Show the side panel" : "Hide the side panel"}
          >
            {sidebarCollapsed ? (
              <PanelRightOpen className="size-3" />
            ) : (
              <PanelRightClose className="size-3" />
            )}
          </Button>
          <Popover open={creating} onOpenChange={setCreating}>
            <PopoverTrigger asChild>
              <Button
                size="sm"
                variant="secondary"
                className="h-7 text-xs"
                // A schedule belongs to exactly one project. Under "All
                // projects" the dropdown names none, but an open note does —
                // see `targetProject`.
                disabled={!targetProject}
                title={
                  targetProject
                    ? `Create a schedule in ${targetProject}`
                    : "Pick a project, or open a schedule, first"
                }
              >
                <Plus className="mr-1 size-3" />
                New
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 space-y-2 p-3 text-xs">
              <div className="text-muted-foreground">
                New schedule in <span className="text-foreground">{targetProject}</span>
              </div>
              <Input
                value={newTitle}
                placeholder="Schedule name"
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
                      targetProject,
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
                Create
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

      <ResizablePanelGroup
        orientation="horizontal"
        className="min-h-0 flex-1"
        onLayoutChanged={(layout) => {
          const size = layout.sidebar;
          if (typeof size === "number") setSidebarSize(size);
        }}
      >
        <ResizablePanel id="calendar" minSize="40%" className="min-h-0 min-w-0">
          <div ref={scrollRef} className="h-full overflow-y-auto">
            {doc && window_ && mode === "timeline" ? (
              <TimelineGrid
                doc={doc}
                start={window_.start}
                end={window_.end}
                tasks={projectTasks}
                locale={locale}
                today={today}
                selectedId={selected?.id ?? null}
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
                    if (next.end < next.start) return i;
                    return next;
                  })
                }
                onSelectItem={(item) => setSelectedId(item?.id ?? null)}
                onToggleNonWorking={(date) => toggleNonWorking(date)}
                onCreateItem={(kind, from, to) => createItem(kind, from, to)}
                onPanWindow={panBy}
                onZoomWindow={zoomBy}
              />
            ) : doc && window_ ? (
              <ScheduleGrid
                doc={doc}
                start={window_.start}
                end={window_.end}
                tasks={projectTasks}
                locale={locale}
                today={today}
                selectedId={selected?.id ?? null}
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
                    // A resize can only shorten a bar to a single day; past
                    // that the gesture would invert it, which the notation
                    // forbids.
                    if (next.end < next.start) return i;
                    return next;
                  })
                }
                onSelectItem={(item) => setSelectedId(item?.id ?? null)}
                onToggleNonWorking={(date) => toggleNonWorking(date)}
                onCreateItem={(kind, from, to) => createItem(kind, from, to)}
                onMoveTaskDue={(taskId, date) => {
                  void api.updateTask(vaultPath, { id: taskId, due: date }).then(() => {
                    void api.listTasks(vaultPath).then(setTasks);
                  });
                }}
                onPanWindow={panBy}
                onZoomWindow={zoomBy}
              />
            ) : (
              <div className="p-6 text-sm text-muted-foreground">
                Select a schedule, or pick a project and create one.
              </div>
            )}
          </div>
        </ResizablePanel>

        {/* Still one right column for every panel, not one per panel: the
            editor comes and goes *vertically* inside it, so selecting a bar
            never changes the calendar's width. The grid places its bars in
            percentages of that width, and it jumping on selection was the
            original complaint.

            Dragging the divider is a different thing from that: the width
            changes because the user asked it to, at the moment they asked, so
            the elements moving with it reads as the resize working rather than
            as the calendar running away. */}
        {path && !sidebarCollapsed && (
          <>
            <ResizableHandle />
            <ResizablePanel
              id="sidebar"
              defaultSize={`${sidebarSize}%`}
              minSize="15%"
              maxSize="45%"
              className="min-h-0 min-w-0"
            >
              <aside className="flex h-full flex-col overflow-y-auto">
                {selected && doc && (
                  <ItemEditor
                    item={selected}
                    tasks={projectTasks}
                    onChange={(next) => patchItem(next.id, () => next)}
                    onDelete={() => {
                      mutate({ ...doc, items: doc.items.filter((i) => i.id !== selected.id) });
                      setSelectedId(null);
                    }}
                    onClose={() => setSelectedId(null)}
                  />
                )}
                {aiRun && (
                  <ScheduleAiPanel
                    run={aiRun}
                    defaultConfirm={config?.settings.schedule_confirm ?? false}
                    onRun={(instruction, confirm) => {
                      void api
                        .runScheduleEdit(path, instruction, confirm)
                        .catch((e) => setStatus(String(e)));
                    }}
                    onUndo={() => {
                      void api
                        .restoreScheduleSnapshot(path)
                        .then(() => loadDoc(path))
                        .catch((e) => setStatus(String(e)));
                    }}
                  />
                )}
              </aside>
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );

  /** Non-working toggle for one day. The splitting behaviour (and the
   * weekend no-op) lives in `toggleNonWorkingDay` so the grid, the keyboard
   * and any future caller all get the same rule. */
  function toggleNonWorking(date: string) {
    if (!doc) return;
    const nonWorking = toggleNonWorkingDay(doc.nonWorking, date);
    if (nonWorking === doc.nonWorking) return; // weekend: nothing to change
    mutate({ ...doc, nonWorking });
  }

  /**
   * Creates an element of the kind the user picked from the day's context
   * menu. Choosing the kind up front is what removes the old two-step dance
   * (make a bar, then convert it in the side panel).
   *
   * A bar opens the editor so its title can be typed immediately; a note does
   * too, since an untitled note is an empty comment marker. A milestone opens
   * as well, for the same reason — every kind is created untitled.
   */
  function createItem(kind: ItemKind, start: string, end: string) {
    if (!doc) return;
    const item: ScheduleItem = {
      kind,
      id: nextItemId(doc.items),
      start,
      end: isRangeKind(kind) ? end : start,
      title: "",
      ...(isRangeKind(kind) ? { color: "blue" as const } : {}),
    };
    mutate({ ...doc, items: [...doc.items, item] });
    setSelectedId(item.id);
  }
}

/** Six weeks from today — long enough to hold a phase, short enough to read. */
function defaultWindow(): { start: string; end: string } {
  const today = toISO(new Date());
  return { start: today, end: shiftDate(today, DEFAULT_WEEKS * 7 - 1) };
}
