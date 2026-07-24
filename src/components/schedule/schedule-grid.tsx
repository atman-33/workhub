import { useCallback, useEffect, useRef, useState } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { monthLabel, strings, type ScheduleLocale } from "@/lib/schedule/i18n";
import {
  buildLayout,
  calendarDays,
  countWorkingDays,
  dayDelta,
  isWeeklyNonWorking,
  shiftDate,
} from "@/lib/schedule/layout";
import { COLOR_HEX, type ItemKind, type ScheduleDocModel, type ScheduleItem } from "@/lib/schedule/parse";
import { cn } from "@/lib/utils";
import type { Task } from "@/types";

/**
 * The continuous week grid (design note §3.1 / §6).
 *
 * Two decisions shape this component.
 *
 * **Gestures are measured in dates, not pixels.** The day under the pointer
 * minus the day the drag started on gives the delta directly, so a drag
 * crosses week rows as naturally as it crosses columns — dragging straight
 * down is simply +7 days. (The original pixel-delta version could only ever
 * express horizontal travel, which made "move this to next week" impossible
 * without scrolling off-screen.) A drag-and-drop library would model "which
 * droppable did this land on", which still answers neither edge-resize nor
 * range sweep; no dependency is added either way.
 *
 * **The drag preview is the real model.** Rather than nudging the DOM with a
 * transform, the pending delta is applied to a copy of the document and that
 * copy is laid out. A bar being dragged across a week boundary therefore
 * splits and re-stacks exactly as it will once released — what you see during
 * the drag is what gets saved.
 *
 * Rendering is driven entirely by `buildLayout`, so this component owns
 * appearance and gestures — never geometry.
 */

/** Height of one bar lane, in px. Mirrored in the row height calculation. */
const LANE_H = 22;

interface Props {
  doc: ScheduleDocModel;
  start: string;
  end: string;
  /** Tasks of the displayed project that carry a `due` (T-0089). */
  tasks: Task[];
  locale: ScheduleLocale;
  /** Id of the element the side panel is editing, highlighted in the grid. */
  selectedId?: string | null;
  /** True while an AI edit is running: every gesture is disabled so an app
   * write cannot race the agent's. */
  readOnly?: boolean;
  onMoveItem: (id: string, deltaDays: number) => void;
  onResizeItem: (id: string, edge: "start" | "end", deltaDays: number) => void;
  onSelectItem: (item: ScheduleItem | null) => void;
  onToggleNonWorking: (date: string) => void;
  onCreateItem: (kind: ItemKind, start: string, end: string) => void;
  onMoveTaskDue: (taskId: string, date: string) => void;
}

/** What the pointer is currently doing. `null` means nothing. */
type Drag =
  | {
      kind: "item";
      id: string;
      edge?: "start" | "end";
      /** Day the press landed on; the delta is measured against this. */
      originDate: string;
      delta: number;
      /** Set once the pointer actually leaves the origin day, so a press that
       * never moved is treated as a click (open the editor) instead. */
      moved: boolean;
    }
  | { kind: "task"; taskId: string; date: string }
  // `active` distinguishes a sweep in progress from the selection it leaves
  // behind: the result stays on screen (with its day counts and the create
  // actions) until the next press clears it.
  | { kind: "range"; anchorDate: string; start: string; end: string; active: boolean }
  | null;

export function ScheduleGrid({
  doc,
  start,
  end,
  tasks,
  locale,
  selectedId,
  readOnly,
  onMoveItem,
  onResizeItem,
  onSelectItem,
  onToggleNonWorking,
  onCreateItem,
  onMoveTaskDue,
}: Props) {
  const [drag, setDrag] = useState<Drag>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // Kept in a ref as well so the window-level pointer handlers below (which are
  // installed once per drag) always read the live value.
  const dragRef = useRef<Drag>(null);
  dragRef.current = drag;

  const t = strings(locale);
  // Lay out the document *with the pending drag applied*, so the preview and
  // the eventual save can never disagree.
  const layout = buildLayout(previewDoc(doc, drag), start, end);

  const tasksByDate = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!task.due) continue;
    const date = drag?.kind === "task" && drag.taskId === task.id ? drag.date : task.due;
    const list = tasksByDate.get(date);
    if (list) list.push(task);
    else tasksByDate.set(date, [task]);
  }
  const taskById = new Map(tasks.map((task) => [task.id, task]));

  /** Status of the task an element is linked to via `task:`, shown on the
   * element so the plan reflects what has actually happened (§7). */
  const linkedStatus = (item: ScheduleItem) =>
    item.task ? taskById.get(item.task)?.status : undefined;

  /** ISO date under a client x/y position, or null when outside any day cell. */
  const dateAt = useCallback((clientX: number, clientY: number): string | null => {
    const el = document
      .elementsFromPoint(clientX, clientY)
      .find((e) => e instanceof HTMLElement && e.dataset.date) as HTMLElement | undefined;
    return el?.dataset.date ?? null;
  }, []);

  // One window-level listener pair per drag, rather than per-element handlers:
  // a drag must keep tracking after the pointer leaves the element it started
  // on (which is exactly what dragging a bar across a week does).
  useEffect(() => {
    if (!drag) return;

    const onMove = (e: PointerEvent) => {
      const current = dragRef.current;
      if (!current) return;
      const date = dateAt(e.clientX, e.clientY);
      if (!date) return;

      if (current.kind === "range") {
        if (!current.active) return;
        const [a, b] =
          date < current.anchorDate ? [date, current.anchorDate] : [current.anchorDate, date];
        if (a !== current.start || b !== current.end) setDrag({ ...current, start: a, end: b });
        return;
      }
      if (current.kind === "task") {
        if (date !== current.date) setDrag({ ...current, date });
        return;
      }
      const delta = dayDelta(current.originDate, date);
      if (delta !== current.delta) setDrag({ ...current, delta, moved: true });
    };

    const onUp = () => {
      const current = dragRef.current;
      if (current?.kind === "range") {
        // The sweep ends but its result stays on screen.
        setDrag({ ...current, active: false });
        return;
      }
      setDrag(null);
      if (!current) return;
      if (current.kind === "task") {
        onMoveTaskDue(current.taskId, current.date);
        return;
      }
      if (!current.moved || !current.delta) return;
      if (current.edge) onResizeItem(current.id, current.edge, current.delta);
      else onMoveItem(current.id, current.delta);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, dateAt, onMoveItem, onResizeItem, onMoveTaskDue]);

  const beginItemDrag = (e: React.PointerEvent, item: ScheduleItem, edge?: "start" | "end") => {
    if (readOnly || e.button !== 0) return;
    e.stopPropagation();
    const originDate = dateAt(e.clientX, e.clientY);
    if (!originDate) return;
    setDrag({ kind: "item", id: item.id, edge, originDate, delta: 0, moved: false });
  };

  /** A press that never moved is a click: open the element for editing. */
  const endItemPress = (item: ScheduleItem) => {
    const current = dragRef.current;
    if (current?.kind === "item" && current.id === item.id && current.moved) return;
    onSelectItem(item);
  };

  const selection = drag?.kind === "range" ? drag : null;

  return (
    <div ref={gridRef} className="select-none text-xs">
      <div className="sticky top-0 z-10 flex border-b bg-background">
        <div className="w-11 shrink-0" />
        <div className="grid flex-1 grid-cols-7">
          {t.weekdays.map((label, i) => (
            <div
              key={label}
              className={cn(
                "px-1.5 py-1 text-[11px] font-medium text-muted-foreground",
                // Sunday and Saturday, since weeks start on Sunday.
                (i === 0 || i === 6) && "text-muted-foreground/60",
              )}
            >
              {label}
            </div>
          ))}
        </div>
      </div>

      {layout.weeks.map((week) => (
        <div key={week.days[0].date} className="flex border-b last:border-b-0">
          <div className="w-11 shrink-0 py-1 pr-2 text-right text-[11px] text-muted-foreground">
            {week.days.some((d) => d.isMonthStart) || week.days[0].day <= 7
              ? monthLabel(week.gutterMonth, locale)
              : ""}
          </div>
          <div data-week-body className="relative flex-1">
            {/* Day cells: the backdrop, the right-click target, and the
                measurement surface `dateAt` hit-tests against. */}
            <div className="grid grid-cols-7">
              {week.days.map((day) => {
                const notes = day.points.filter((p) => p.kind === "note");
                const weekly = isWeeklyNonWorking(day.date, doc.nonWorking);
                return (
                  <ContextMenu key={day.date}>
                    <ContextMenuTrigger asChild>
                      <div
                        data-date={day.date}
                        onPointerDown={(e) => {
                          if (readOnly || e.button !== 0) return;
                          onSelectItem(null);
                          setDrag({
                            kind: "range",
                            anchorDate: day.date,
                            start: day.date,
                            end: day.date,
                            active: true,
                          });
                        }}
                        onPointerUp={() => {
                          // A press that never left this day is a click, and a
                          // click toggles the day. A sweep leaves a selection
                          // instead (handled by the window-level handler).
                          const current = dragRef.current;
                          if (readOnly) return;
                          if (
                            current?.kind === "range" &&
                            current.start === day.date &&
                            current.end === day.date
                          ) {
                            setDrag(null);
                            if (!weekly) onToggleNonWorking(day.date);
                          }
                        }}
                        title={
                          weekly ? "Weekend — edit the weekly: line in the note" : undefined
                        }
                        className={cn(
                          "min-h-20 border-r border-border/60 px-1 pb-1 pt-0.5 last:border-r-0",
                          day.isNonWorking && "bg-muted/60",
                          day.isOutside && "opacity-40",
                          day.isMonthStart && "border-l-2 border-l-foreground/40",
                          !readOnly && !weekly && "cursor-pointer",
                          selection &&
                            day.date >= selection.start &&
                            day.date <= selection.end &&
                            "bg-primary/10",
                        )}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <span
                            className={cn(
                              "text-[11px] tabular-nums",
                              day.isMonthStart ? "font-bold" : "text-muted-foreground",
                            )}
                          >
                            {day.isMonthStart ? `${day.month}/${day.day}` : day.day}
                          </span>
                          {notes.length > 0 && <NoteMarker notes={notes} onOpen={onSelectItem} />}
                        </div>
                        {day.nonWorkingLabel && (
                          <div className="truncate text-[9px] text-muted-foreground">
                            {day.nonWorkingLabel}
                          </div>
                        )}
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <DayMenuItems
                        readOnly={readOnly}
                        day={day.date}
                        weekly={weekly}
                        isNonWorking={day.isNonWorking}
                        selection={selection}
                        onCreateItem={(kind, from, to) => {
                          setDrag(null);
                          onCreateItem(kind, from, to);
                        }}
                        onToggleNonWorking={onToggleNonWorking}
                      />
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })}
            </div>

            {/* Bars float above the cells, positioned in column percentages so
                they stay aligned with the grid at any width. */}
            <div className="pointer-events-none absolute inset-x-0 top-6">
              {week.bars.map((bar) => (
                <div
                  key={`${bar.item.id}-${bar.startCol}`}
                  style={{
                    left: `${(bar.startCol / 7) * 100}%`,
                    width: `${((bar.endCol - bar.startCol + 1) / 7) * 100}%`,
                    top: bar.lane * LANE_H,
                    background: bar.item.color ? COLOR_HEX[bar.item.color] : COLOR_HEX.gray,
                  }}
                  onPointerDown={(e) => beginItemDrag(e, bar.item)}
                  onPointerUp={() => endItemPress(bar.item)}
                  className={cn(
                    "pointer-events-auto absolute flex h-[18px] items-center gap-1 overflow-hidden px-1.5 text-[10px] text-white",
                    !readOnly && "cursor-grab active:cursor-grabbing",
                    bar.isStart && "rounded-l",
                    bar.isEnd && "rounded-r",
                    selectedId === bar.item.id && "ring-2 ring-foreground ring-offset-1",
                  )}
                  title={`${bar.item.title} · ${t.range(bar.item.start, bar.item.end)} · ${t.workingDays(
                    bar.workingDays,
                  )}`}
                >
                  {bar.isStart && !readOnly && (
                    <span
                      onPointerDown={(e) => beginItemDrag(e, bar.item, "start")}
                      className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize"
                    />
                  )}
                  {bar.isStart && (
                    <span className="truncate">
                      {bar.item.title}
                      <span className="ml-1 opacity-80">{bar.workingDays}d</span>
                      {linkedStatus(bar.item) && (
                        <span className="ml-1 rounded bg-black/25 px-1 text-[9px] uppercase">
                          {linkedStatus(bar.item)}
                        </span>
                      )}
                    </span>
                  )}
                  {bar.isEnd && !readOnly && (
                    <span
                      onPointerDown={(e) => beginItemDrag(e, bar.item, "end")}
                      className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize"
                    />
                  )}
                </div>
              ))}
            </div>

            {/* Milestones and task chips sit below the bar lanes. Notes are not
                here — they are corner markers on the day cell itself. */}
            <div
              className="pointer-events-none absolute inset-x-0 grid grid-cols-7"
              style={{ top: 24 + week.lanes * LANE_H }}
            >
              {week.days.map((day) => (
                <div key={day.date} className="min-w-0 px-1">
                  {day.points
                    .filter((p) => p.kind === "milestone")
                    .map((point) => (
                      <div
                        key={point.id}
                        onPointerDown={(e) => beginItemDrag(e, point)}
                        onPointerUp={() => endItemPress(point)}
                        className={cn(
                          "pointer-events-auto mb-0.5 flex items-center gap-1 truncate text-[10px]",
                          !readOnly && "cursor-grab active:cursor-grabbing",
                          selectedId === point.id && "font-semibold",
                        )}
                        title={`${point.title} · ${point.start}`}
                      >
                        <span
                          className="size-1.5 shrink-0 rotate-45"
                          style={{
                            background: point.color ? COLOR_HEX[point.color] : COLOR_HEX.gray,
                          }}
                        />
                        <span className="truncate">{point.title}</span>
                        {linkedStatus(point) && (
                          <span className="shrink-0 rounded bg-muted px-1 text-[9px] uppercase text-muted-foreground">
                            {linkedStatus(point)}
                          </span>
                        )}
                      </div>
                    ))}
                  {(tasksByDate.get(day.date) ?? []).map((task) => (
                    <div
                      key={task.id}
                      onPointerDown={(e) => {
                        if (readOnly || e.button !== 0) return;
                        e.stopPropagation();
                        setDrag({ kind: "task", taskId: task.id, date: day.date });
                      }}
                      className={cn(
                        // Deliberately unlike an element: a task is real work
                        // that already exists, not something being considered.
                        "pointer-events-auto mb-0.5 truncate rounded border border-dashed border-muted-foreground/50 bg-background px-1 text-[10px] text-muted-foreground",
                        !readOnly && "cursor-grab active:cursor-grabbing",
                      )}
                      title={`${task.id} ${task.title} · ${task.status}`}
                    >
                      {task.id} {task.title}
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* Reserve height for the floating layers so week rows never overlap. */}
            <div
              style={{
                height:
                  week.lanes * LANE_H +
                  Math.max(
                    ...week.days.map(
                      (d) =>
                        d.points.filter((p) => p.kind === "milestone").length * 14 +
                        (tasksByDate.get(d.date)?.length ?? 0) * 16,
                    ),
                    0,
                  ),
              }}
            />
          </div>
        </div>
      ))}

      {selection && !readOnly && (
        <div className="flex items-center gap-3 border-t bg-muted/40 px-3 py-1.5 text-[11px]">
          <span>
            Selected {t.range(selection.start, selection.end)} ·{" "}
            {t.calendarDays(calendarDays(selection.start, selection.end))} ·{" "}
            {t.workingDays(countWorkingDays(selection.start, selection.end, doc.nonWorking))}
          </span>
          <span className="text-muted-foreground">Right-click to add an element</span>
          <button
            type="button"
            onClick={() => setDrag(null)}
            className="ml-auto text-muted-foreground hover:text-foreground"
          >
            Clear selection
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Applies the in-flight drag to a copy of the document, so the grid lays out
 * the result rather than approximating it with a CSS transform. Returns `doc`
 * unchanged when nothing is being dragged, keeping the common case allocation
 * free.
 */
function previewDoc(doc: ScheduleDocModel, drag: Drag): ScheduleDocModel {
  if (!drag || drag.kind !== "item" || !drag.delta) return doc;
  const items = doc.items.map((item) => {
    if (item.id !== drag.id) return item;
    if (!drag.edge) {
      return {
        ...item,
        start: shiftDate(item.start, drag.delta),
        end: shiftDate(item.end, drag.delta),
      };
    }
    const next =
      drag.edge === "start"
        ? { ...item, start: shiftDate(item.start, drag.delta) }
        : { ...item, end: shiftDate(item.end, drag.delta) };
    // A resize can shorten a bar to a single day but never invert it.
    return next.end < next.start ? item : next;
  });
  return { ...doc, items };
}

/**
 * Excel-comment-style note indicator: a small corner triangle that reveals the
 * note on hover. Notes are prose *about* a day rather than something occupying
 * it, so giving them a full row in the cell crowded out the elements that do.
 */
function NoteMarker({
  notes,
  onOpen,
}: {
  notes: ScheduleItem[];
  onOpen: (item: ScheduleItem) => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onOpen(notes[0]);
          }}
          aria-label={notes.map((n) => n.title).join("; ")}
          className="size-0 shrink-0 border-r-[9px] border-t-[9px] border-r-transparent border-t-amber-600"
        />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64">
        {notes.map((note) => (
          <div key={note.id}>{note.title}</div>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Right-click menu for a day. Creating an element straight from here is what
 * removes the old two-step dance (make a bar, then change its type in the side
 * panel): the kind is chosen at the moment of creation, which is when the user
 * already knows it.
 */
function DayMenuItems({
  readOnly,
  day,
  weekly,
  isNonWorking,
  selection,
  onCreateItem,
  onToggleNonWorking,
}: {
  readOnly?: boolean;
  day: string;
  weekly: boolean;
  isNonWorking: boolean;
  selection: { start: string; end: string } | null;
  onCreateItem: (kind: ItemKind, start: string, end: string) => void;
  onToggleNonWorking: (date: string) => void;
}) {
  // A sweep that covers this day is what the menu acts on; otherwise the menu
  // acts on the single day that was right-clicked.
  const range =
    selection && day >= selection.start && day <= selection.end
      ? selection
      : { start: day, end: day };
  const spansDays = range.start !== range.end;

  return (
    <>
      <ContextMenuLabel className="text-[11px] font-normal text-muted-foreground">
        {spansDays ? `${range.start} → ${range.end}` : range.start}
      </ContextMenuLabel>
      <ContextMenuItem
        disabled={readOnly}
        onSelect={() => onCreateItem("bar", range.start, range.end)}
      >
        Add bar
      </ContextMenuItem>
      <ContextMenuItem
        disabled={readOnly}
        // A point element takes the start of the range: a milestone or a note
        // is about one day, and silently spreading it over a sweep would be a
        // different thing than the user asked for.
        onSelect={() => onCreateItem("milestone", range.start, range.start)}
      >
        Add milestone
      </ContextMenuItem>
      <ContextMenuItem
        disabled={readOnly}
        onSelect={() => onCreateItem("note", range.start, range.start)}
      >
        Add note
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        disabled={readOnly || weekly}
        onSelect={() => onToggleNonWorking(day)}
      >
        {weekly
          ? "Weekend (set by the weekly: line)"
          : isNonWorking
            ? "Clear non-working day"
            : "Mark non-working"}
      </ContextMenuItem>
    </>
  );
}
