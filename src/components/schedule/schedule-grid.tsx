import { useCallback, useEffect, useRef, useState } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { buildLayout, calendarDays, countWorkingDays, type LayoutBar } from "@/lib/schedule/layout";
import { COLOR_HEX, type ScheduleDocModel, type ScheduleItem } from "@/lib/schedule/parse";
import { cn } from "@/lib/utils";
import type { Task } from "@/types";

/**
 * The continuous week grid (design note §3.1 / §6).
 *
 * Interaction is handled with raw pointer events rather than `@dnd-kit`. The
 * three gestures this grid needs — move an element by a whole number of days,
 * drag one *edge* of a bar, and sweep an empty range — are all "how many
 * columns did the pointer travel", which is a bounding-rect subtraction. A
 * drag-and-drop library models "which droppable did this land on", which would
 * mean 7 droppables per week row and still no answer for edge-resize or range
 * sweep. No dependency is added either way.
 *
 * Rendering is driven entirely by `buildLayout`, so this component owns
 * appearance and gestures — never geometry.
 */

const WEEKDAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** Height of one bar lane, in px. Mirrored in the row height calculation. */
const LANE_H = 22;

interface Props {
  doc: ScheduleDocModel;
  start: string;
  end: string;
  /** Tasks of the displayed project that carry a `due` (T-0089). */
  tasks: Task[];
  /** True while an AI edit is running: every gesture is disabled so an app
   * write cannot race the agent's. */
  readOnly?: boolean;
  onMoveItem: (id: string, deltaDays: number) => void;
  onResizeItem: (id: string, edge: "start" | "end", deltaDays: number) => void;
  onSelectItem: (item: ScheduleItem) => void;
  onToggleNonWorking: (date: string) => void;
  onCreateBar: (start: string, end: string) => void;
  onMoveTaskDue: (taskId: string, date: string) => void;
}

/** What the pointer is currently doing. `null` means nothing. */
type Drag =
  | { kind: "item"; id: string; edge?: "start" | "end"; originX: number; delta: number }
  | { kind: "task"; taskId: string; originX: number; date: string }
  // `active` distinguishes a sweep in progress from the selection it leaves
  // behind: the result stays on screen (with its day counts and the
  // "make this a bar" action) until the next press clears it.
  | { kind: "range"; anchorDate: string; start: string; end: string; active: boolean }
  | null;

export function ScheduleGrid({
  doc,
  start,
  end,
  tasks,
  readOnly,
  onMoveItem,
  onResizeItem,
  onSelectItem,
  onToggleNonWorking,
  onCreateBar,
  onMoveTaskDue,
}: Props) {
  const layout = buildLayout(doc, start, end);
  const [drag, setDrag] = useState<Drag>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // Kept in a ref as well so the window-level pointer handlers below (which are
  // installed once per drag) always read the live value.
  const dragRef = useRef<Drag>(null);
  dragRef.current = drag;

  const tasksByDate = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!task.due) continue;
    const list = tasksByDate.get(task.due);
    if (list) list.push(task);
    else tasksByDate.set(task.due, [task]);
  }
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  /** Status of the task an element is linked to via `task:`, shown on the
   * element so the plan reflects what has actually happened (§7). */
  const linkedStatus = (item: ScheduleItem) =>
    item.task ? taskById.get(item.task)?.status : undefined;

  /** Column width in px, measured from the live grid so zoom and window
   * resizing need no recalculation elsewhere. */
  const colWidth = useCallback(() => {
    const row = gridRef.current?.querySelector<HTMLElement>("[data-week-body]");
    return row ? row.getBoundingClientRect().width / 7 : 0;
  }, []);

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
      if (current.kind === "range") {
        if (!current.active) return;
        const date = dateAt(e.clientX, e.clientY);
        if (!date) return;
        const [a, b] = date < current.anchorDate ? [date, current.anchorDate] : [current.anchorDate, date];
        setDrag({ ...current, start: a, end: b });
        return;
      }
      if (current.kind === "task") {
        const date = dateAt(e.clientX, e.clientY);
        if (date) setDrag({ ...current, date });
        return;
      }
      const w = colWidth();
      if (!w) return;
      setDrag({ ...current, delta: Math.round((e.clientX - current.originX) / w) });
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
      if (!current.delta) return;
      if (current.edge) onResizeItem(current.id, current.edge, current.delta);
      else onMoveItem(current.id, current.delta);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, colWidth, dateAt, onMoveItem, onResizeItem, onMoveTaskDue]);

  /** Live pixel offset for the element currently being dragged, so the bar
   * follows the pointer before the document is actually changed. */
  const dragOffset = (bar: LayoutBar) => {
    if (!drag || drag.kind !== "item" || drag.id !== bar.item.id) return null;
    const w = colWidth();
    return { px: drag.delta * w, edge: drag.edge };
  };

  const beginItemDrag = (e: React.PointerEvent, id: string, edge?: "start" | "end") => {
    if (readOnly || e.button !== 0) return;
    e.stopPropagation();
    setDrag({ kind: "item", id, edge, originX: e.clientX, delta: 0 });
  };

  return (
    <div ref={gridRef} className="select-none text-xs">
      <div className="sticky top-0 z-10 flex border-b bg-background">
        <div className="w-11 shrink-0" />
        <div className="grid flex-1 grid-cols-7">
          {WEEKDAY_HEADERS.map((h, i) => (
            <div
              key={h}
              className={cn(
                "px-1.5 py-1 text-[11px] font-medium text-muted-foreground",
                i >= 5 && "text-muted-foreground/60",
              )}
            >
              {h}
            </div>
          ))}
        </div>
      </div>

      {layout.weeks.map((week) => (
        <div key={week.days[0].date} className="flex border-b last:border-b-0">
          <div className="w-11 shrink-0 py-1 pr-2 text-right text-[11px] text-muted-foreground">
            {week.days[0].day <= 7 || week.days.some((d) => d.isMonthStart) ? week.monthLabel : ""}
          </div>
          <div data-week-body className="relative flex-1">
            {/* Day cells: the backdrop, the right-click target, and the
                measurement surface `dateAt` hit-tests against. */}
            <div className="grid grid-cols-7">
              {week.days.map((day) => (
                <ContextMenu key={day.date}>
                  <ContextMenuTrigger asChild>
                    <div
                      data-date={day.date}
                      onPointerDown={(e) => {
                        if (readOnly || e.button !== 0) return;
                        setDrag({
                          kind: "range",
                          anchorDate: day.date,
                          start: day.date,
                          end: day.date,
                          active: true,
                        });
                      }}
                      className={cn(
                        "min-h-24 border-r border-border/60 px-1 pb-1 pt-0.5 last:border-r-0",
                        day.isNonWorking && "bg-muted/60",
                        day.isOutside && "opacity-40",
                        day.isMonthStart && "border-l-2 border-l-foreground/40",
                        drag?.kind === "range" &&
                          day.date >= drag.start &&
                          day.date <= drag.end &&
                          "bg-primary/10",
                      )}
                    >
                      <div
                        className={cn(
                          "text-[11px] tabular-nums",
                          day.isMonthStart ? "font-bold" : "text-muted-foreground",
                        )}
                      >
                        {day.isMonthStart ? `${day.month}/${day.day}` : day.day}
                      </div>
                      {day.nonWorkingLabel && (
                        <div className="truncate text-[9px] text-muted-foreground">
                          {day.nonWorkingLabel}
                        </div>
                      )}
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem
                      disabled={readOnly}
                      onSelect={() => onToggleNonWorking(day.date)}
                    >
                      {day.isNonWorking ? "Clear non-working day" : "Mark non-working"}
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))}
            </div>

            {/* Bars float above the cells, positioned in column percentages so
                they stay aligned with the grid at any width. */}
            <div className="pointer-events-none absolute inset-x-0 top-6">
              {week.bars.map((bar) => {
                const offset = dragOffset(bar);
                const left = (bar.startCol / 7) * 100;
                const width = ((bar.endCol - bar.startCol + 1) / 7) * 100;
                const style: React.CSSProperties = {
                  left: `${left}%`,
                  width: `${width}%`,
                  top: bar.lane * LANE_H,
                  background: bar.item.color ? COLOR_HEX[bar.item.color] : COLOR_HEX.gray,
                };
                if (offset) {
                  if (!offset.edge) style.transform = `translateX(${offset.px}px)`;
                  else if (offset.edge === "start") {
                    style.marginLeft = offset.px;
                    style.width = `calc(${width}% - ${offset.px}px)`;
                  } else {
                    style.width = `calc(${width}% + ${offset.px}px)`;
                  }
                }
                return (
                  <div
                    key={`${bar.item.id}-${bar.startCol}`}
                    style={style}
                    onPointerDown={(e) => beginItemDrag(e, bar.item.id)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectItem(bar.item);
                    }}
                    className={cn(
                      "pointer-events-auto absolute flex h-[18px] items-center gap-1 overflow-hidden px-1.5 text-[10px] text-white",
                      !readOnly && "cursor-grab active:cursor-grabbing",
                      bar.isStart && "rounded-l",
                      bar.isEnd && "rounded-r",
                    )}
                    title={`${bar.item.title} · ${bar.item.start} to ${bar.item.end} · ${bar.workingDays} working days`}
                  >
                    {bar.isStart && !readOnly && (
                      <span
                        onPointerDown={(e) => beginItemDrag(e, bar.item.id, "start")}
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
                        onPointerDown={(e) => beginItemDrag(e, bar.item.id, "end")}
                        className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize"
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Milestones, notes and task chips sit below the bar lanes. */}
            <div
              className="pointer-events-none absolute inset-x-0 grid grid-cols-7"
              style={{ top: 24 + week.lanes * LANE_H }}
            >
              {week.days.map((day) => (
                <div key={day.date} className="min-w-0 px-1">
                  {day.points.map((point) => (
                    <div
                      key={point.id}
                      onPointerDown={(e) => beginItemDrag(e, point.id)}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectItem(point);
                      }}
                      style={{
                        transform:
                          drag?.kind === "item" && drag.id === point.id
                            ? `translateX(${drag.delta * colWidth()}px)`
                            : undefined,
                      }}
                      className={cn(
                        "pointer-events-auto mb-0.5 flex items-center gap-1 truncate text-[10px]",
                        !readOnly && "cursor-grab active:cursor-grabbing",
                      )}
                      title={`${point.title} · ${point.start}`}
                    >
                      <span
                        className={cn(
                          "size-1.5 shrink-0",
                          point.kind === "milestone" ? "rotate-45" : "rounded-full",
                        )}
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
                        setDrag({
                          kind: "task",
                          taskId: task.id,
                          originX: e.clientX,
                          date: day.date,
                        });
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
                      (d) => d.points.length * 14 + (tasksByDate.get(d.date)?.length ?? 0) * 16,
                    ),
                    0,
                  ),
              }}
            />
          </div>
        </div>
      ))}

      {drag?.kind === "range" && !readOnly && (
        <div className="flex items-center gap-3 border-t bg-muted/40 px-3 py-1.5 text-[11px]">
          <span>
            Selected {drag.start} to {drag.end} · {calendarDays(drag.start, drag.end)} calendar
            days · {countWorkingDays(drag.start, drag.end, doc.nonWorking)} working days
          </span>
          <button
            type="button"
            onClick={() => {
              onCreateBar(drag.start, drag.end);
              setDrag(null);
            }}
            className="rounded border px-2 py-0.5 hover:bg-muted"
          >
            Create a bar here
          </button>
          <button
            type="button"
            onClick={() => setDrag(null)}
            className="text-muted-foreground hover:text-foreground"
          >
            Clear selection
          </button>
        </div>
      )}
    </div>
  );
}
