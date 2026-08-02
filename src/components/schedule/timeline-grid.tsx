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
import { dayDelta, isWeeklyNonWorking, shiftDate } from "@/lib/schedule/layout";
import {
  COLOR_HEX,
  type ItemKind,
  type ScheduleDocModel,
  type ScheduleItem,
} from "@/lib/schedule/parse";
import {
  buildTimeline,
  dateAtFrac,
  snapWeeks,
  type TimelineBar,
  type TimelineLayout,
} from "@/lib/schedule/timeline";
import { cn } from "@/lib/utils";
import type { Task } from "@/types";

/**
 * The long-range ("大日程") view of a schedule note (T-0111).
 *
 * This is the paper the owner already plans on: months across the top, phases
 * as bands running left to right, milestones as diamonds on the line. The
 * calendar grid answers "which days do I have"; this answers "does this shape
 * of plan fit in the time there is" — and both draw the same note, so a phase
 * moved here is the same line of Markdown moved there.
 *
 * It shares the calendar's two governing habits and adds one of its own.
 *
 * - **Gestures are measured in dates.** There are no day cells to hit-test
 *   against here, so the pointer's position along the track is inverted through
 *   `dateAtFrac`. The delta is still a number of days, which is why the same
 *   `onMoveItem` / `onResizeItem` callbacks serve both modes.
 * - **The drag preview is the real model.** The pending delta is applied to a
 *   copy of the document and *that* is laid out, so a drag that pushes a bar
 *   into a new lane shows the new lane while you drag.
 * - **Shift snaps to whole weeks.** At six months across, a pixel is most of a
 *   day; "push this a fortnight" is the edit being made here, and a day of
 *   pointer jitter should not turn it into thirteen.
 */

/** Height of one bar lane, in px. */
const LANE_H = 26;
/** Height of one point-element (milestone/note) lane, in px. */
const POINT_LANE_H = 18;
/** Left gutter holding nothing but keeping the track clear of the edge. */
const TRACK_PAD = 8;

interface Props {
  doc: ScheduleDocModel;
  start: string;
  end: string;
  /** Tasks of the displayed project that carry a `due`. */
  tasks: Task[];
  locale: ScheduleLocale;
  today?: string;
  selectedId?: string | null;
  /** True while an AI edit is running: every gesture is disabled so an app
   * write cannot race the agent's. */
  readOnly?: boolean;
  onMoveItem: (id: string, deltaDays: number) => void;
  onResizeItem: (id: string, edge: "start" | "end", deltaDays: number) => void;
  onSelectItem: (item: ScheduleItem | null) => void;
  onToggleNonWorking: (date: string) => void;
  onCreateItem: (kind: ItemKind, start: string, end: string) => void;
  /** Move the displayed window by whole weeks (Shift + wheel). */
  onPanWindow: (weeks: number) => void;
  /** Grow or shrink the displayed window by whole weeks (Ctrl + wheel). */
  onZoomWindow: (weeks: number) => void;
}

/** Weeks one Ctrl + wheel notch adds or removes. Coarser than the calendar's
 * single week: at this scale a week is a sliver, and the gesture is "show me
 * another month or so". */
const ZOOM_STEP_WEEKS = 4;

type Drag =
  | {
      kind: "item";
      id: string;
      edge?: "start" | "end";
      originDate: string;
      delta: number;
      moved: boolean;
    }
  | { kind: "range"; anchorDate: string; start: string; end: string; active: boolean }
  | null;

export function TimelineGrid({
  doc,
  start,
  end,
  tasks,
  locale,
  today,
  selectedId,
  readOnly,
  onMoveItem,
  onResizeItem,
  onSelectItem,
  onToggleNonWorking,
  onCreateItem,
  onPanWindow,
  onZoomWindow,
}: Props) {
  const [drag, setDrag] = useState<Drag>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  /** The axis itself — what a client x position is measured against. */
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag>(null);
  dragRef.current = drag;

  const t = strings(locale);
  const layout = buildTimeline(previewDoc(doc, drag), start, end, today);

  /** ISO date under a client x position, or null when the track is not laid
   * out yet. */
  const dateAt = useCallback(
    (clientX: number): string | null => {
      const el = trackRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) return null;
      return dateAtFrac(layout, (clientX - rect.left) / rect.width);
    },
    [layout],
  );

  // One window-level listener pair per drag: the pointer routinely leaves the
  // bar it started on, and at this scale it leaves the track entirely.
  useEffect(() => {
    if (!drag) return;

    const onMove = (e: PointerEvent) => {
      const current = dragRef.current;
      if (!current) return;
      const date = dateAt(e.clientX);
      if (!date) return;

      if (current.kind === "range") {
        if (!current.active) return;
        const [a, b] =
          date < current.anchorDate ? [date, current.anchorDate] : [current.anchorDate, date];
        if (a !== current.start || b !== current.end) setDrag({ ...current, start: a, end: b });
        return;
      }
      const raw = dayDelta(current.originDate, date);
      const delta = e.shiftKey ? snapWeeks(raw) : raw;
      if (delta !== current.delta) setDrag({ ...current, delta, moved: true });
    };

    const onUp = () => {
      const current = dragRef.current;
      if (current?.kind === "range") {
        setDrag({ ...current, active: false });
        return;
      }
      setDrag(null);
      if (!current) return;
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
  }, [drag, dateAt, onMoveItem, onResizeItem]);

  /**
   * Modified wheel changes the window; a plain wheel still scrolls the page.
   * Registered by hand and non-passively for the reason in
   * `.claude/rules/ui-conventions.md` — React's root listener is passive, so a
   * JSX handler could not stop Ctrl + wheel from zooming the WebView.
   */
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.shiftKey) return;
      if (!e.deltaY) return;
      e.preventDefault();
      const step = e.deltaY > 0 ? 1 : -1;
      if (e.ctrlKey) onZoomWindow(step * ZOOM_STEP_WEEKS);
      else onPanWindow(step);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onPanWindow, onZoomWindow]);

  const beginItemDrag = (e: React.PointerEvent, item: ScheduleItem, edge?: "start" | "end") => {
    if (readOnly || e.button !== 0) return;
    e.stopPropagation();
    const originDate = dateAt(e.clientX);
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
  const selectionSpan = selection
    ? {
        left: fracOf(selection.start, layout) * 100,
        width: (fracOf(shiftDate(selection.end, 1), layout) - fracOf(selection.start, layout)) * 100,
      }
    : null;

  /** Tasks with a due date inside the window, as tick marks under the axis. */
  const dueTasks = tasks.filter((task) => task.due && task.due >= start && task.due <= end);

  const barsHeight = Math.max(layout.laneCount, 1) * LANE_H;
  const pointsHeight = layout.pointLaneCount * POINT_LANE_H;

  return (
    <div ref={rootRef} className="select-none p-3 text-xs">
      <div style={{ paddingLeft: TRACK_PAD, paddingRight: TRACK_PAD }}>
        <div ref={trackRef} className="relative">
          {/* Header: coarse band, columns, then the sprint strip. */}
          <div className="relative h-5 border-b border-border/60">
            {layout.bands.map((band) => (
              <div
                key={`${band.year}-${band.label}`}
                style={{ left: `${band.startFrac * 100}%`, width: `${band.widthFrac * 100}%` }}
                className="absolute inset-y-0 truncate border-l border-border px-1 text-[11px] font-medium"
              >
                {band.month ? monthLabel(band.month, locale) : band.label}
              </div>
            ))}
          </div>

          <div className="relative h-5 border-b border-border/60">
            {layout.columns.map((col) => (
              <div
                key={col.start}
                style={{ left: `${col.startFrac * 100}%`, width: `${col.widthFrac * 100}%` }}
                className={cn(
                  "absolute inset-y-0 overflow-hidden px-1 text-[10px] tabular-nums text-muted-foreground",
                  col.isMonthStart ? "border-l border-l-foreground/40" : "border-l border-border/50",
                )}
                title={`${col.start} → ${col.end} · ${t.workingDays(col.workingDays)}`}
              >
                {layout.unit === "week" ? `${col.day}` : monthLabel(col.month, locale)}
                {/* The working-day count is the whole point of a non-working
                    day being marked at all; at month width there is room to
                    just say it. */}
                {layout.unit === "month" && (
                  <span className="ml-1 opacity-70">{col.workingDays}d</span>
                )}
              </div>
            ))}
          </div>

          {layout.sprints.length > 0 && (
            <div className="relative h-4 border-b border-border/60">
              {layout.sprints.map((sprint) => (
                <div
                  key={sprint.number}
                  style={{
                    left: `${sprint.startFrac * 100}%`,
                    width: `${sprint.widthFrac * 100}%`,
                  }}
                  className={cn(
                    "absolute inset-y-0 overflow-hidden bg-muted/40 px-1 text-[10px] tabular-nums text-muted-foreground",
                    // Only a slice holding the sprint's real first day draws
                    // the boundary; a sprint continuing in from before the
                    // window would otherwise invent one at the window edge.
                    sprint.isStart && "border-l-2 border-l-primary/60",
                  )}
                  title={`S${sprint.number} · ${sprint.start} → ${sprint.end}`}
                >
                  {sprint.isStart ? `S${sprint.number}` : ""}
                </div>
              ))}
            </div>
          )}

          {/* The plot: column rules and non-working shading behind, elements
              in front. The backdrop is also the press target for a range
              sweep and the right-click menu. */}
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div
                className="relative"
                style={{ height: barsHeight + pointsHeight + 10 }}
                onPointerDown={(e) => {
                  if (readOnly || e.button !== 0) return;
                  const date = dateAt(e.clientX);
                  if (!date) return;
                  onSelectItem(null);
                  setDrag({
                    kind: "range",
                    anchorDate: date,
                    start: date,
                    end: date,
                    active: true,
                  });
                }}
              >
                {layout.columns.map((col) => (
                  <div
                    key={col.start}
                    style={{ left: `${col.startFrac * 100}%`, width: `${col.widthFrac * 100}%` }}
                    className={cn(
                      "absolute inset-y-0",
                      col.isMonthStart ? "border-l border-l-foreground/25" : "border-l border-border/40",
                      // A column with no working days at all is the shape a
                      // holiday week has; shading it is what makes the gap in
                      // capacity visible at this zoom.
                      col.workingDays === 0 && "bg-muted/60",
                    )}
                  />
                ))}

                {selectionSpan && (
                  <div
                    className="pointer-events-none absolute inset-y-0 z-10 rounded-sm bg-primary/10 ring-2 ring-primary/70"
                    style={{ left: `${selectionSpan.left}%`, width: `${selectionSpan.width}%` }}
                  />
                )}

                {layout.todayFrac !== null && (
                  <div
                    data-today
                    className="pointer-events-none absolute inset-y-0 z-10 w-px bg-primary"
                    style={{ left: `${layout.todayFrac * 100}%` }}
                  />
                )}

                {layout.bars.map((bar) =>
                  bar.item.kind === "arrow" ? (
                    <TimelineArrow
                      key={bar.item.id}
                      bar={bar}
                      selected={selectedId === bar.item.id}
                      readOnly={readOnly}
                      title={rangeTooltip(bar, t)}
                      onDrag={beginItemDrag}
                      onPress={endItemPress}
                    />
                  ) : (
                    <div
                      key={bar.item.id}
                      style={{
                        left: `${bar.startFrac * 100}%`,
                        width: `${bar.widthFrac * 100}%`,
                        top: bar.lane * LANE_H,
                        background: bar.item.color ? COLOR_HEX[bar.item.color] : COLOR_HEX.gray,
                      }}
                      onPointerDown={(e) => beginItemDrag(e, bar.item)}
                      onPointerUp={() => endItemPress(bar.item)}
                      className={cn(
                        "absolute flex h-[20px] items-center gap-1 overflow-hidden px-1.5 text-[10px] text-white",
                        !readOnly && "cursor-grab active:cursor-grabbing",
                        bar.isStart && "rounded-l",
                        bar.isEnd && "rounded-r",
                        selectedId === bar.item.id && "ring-2 ring-foreground ring-offset-1",
                      )}
                      title={rangeTooltip(bar, t)}
                    >
                      {bar.isStart && !readOnly && (
                        <span
                          onPointerDown={(e) => beginItemDrag(e, bar.item, "start")}
                          className="absolute inset-y-0 left-0 w-2 cursor-ew-resize"
                        />
                      )}
                      <span className="truncate">
                        {bar.item.title}
                        <span className="ml-1 opacity-80">{bar.workingDays}d</span>
                      </span>
                      {bar.isEnd && !readOnly && (
                        <span
                          onPointerDown={(e) => beginItemDrag(e, bar.item, "end")}
                          className="absolute inset-y-0 right-0 w-2 cursor-ew-resize"
                        />
                      )}
                    </div>
                  ),
                )}

                {/* Milestones and notes below the bands, on their own lanes so
                    a long label never sits on top of a phase. */}
                {layout.points.map((point) => (
                  <TimelinePointMarker
                    key={point.item.id}
                    item={point.item}
                    left={point.frac * 100}
                    top={barsHeight + point.lane * POINT_LANE_H}
                    selected={selectedId === point.item.id}
                    readOnly={readOnly}
                    onDrag={beginItemDrag}
                    onPress={endItemPress}
                  />
                ))}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <TimelineMenuItems
                readOnly={readOnly}
                selection={selection}
                weekly={
                  selection ? isWeeklyNonWorking(selection.start, doc.nonWorking) : false
                }
                onCreateItem={(kind, from, to) => {
                  setDrag(null);
                  onCreateItem(kind, from, to);
                }}
                onToggleNonWorking={onToggleNonWorking}
              />
            </ContextMenuContent>
          </ContextMenu>

          {/* Tasks are ticks under the axis rather than draggable chips: at
              this zoom a chip would be wider than the month it belongs to, and
              a due date is a fact about work that exists — the calendar mode is
              where it is nudged. */}
          {dueTasks.length > 0 && (
            <div className="relative h-5 border-t border-border/60">
              {dueTasks.map((task) => (
                <Tooltip key={task.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      style={{ left: `${fracOf(task.due as string, layout) * 100}%` }}
                      className="absolute top-1 -ml-1 size-2 rounded-full border border-dashed border-muted-foreground/70 bg-background"
                      aria-label={`${task.id} ${task.title}`}
                    />
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {task.id} {task.title} · {task.status} · {task.due}
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-3 border-t pt-1.5 text-[11px] text-muted-foreground">
        <span>
          {t.range(layout.start, layout.end)} · {t.workingDays(layout.workingDays)}
        </span>
        {selection && (
          <span className="text-foreground">
            {t.range(selection.start, selection.end)} · Right-click to add an element
          </span>
        )}
        {selection && (
          <button
            type="button"
            onClick={() => setDrag(null)}
            className="ml-auto hover:text-foreground"
          >
            Clear selection
          </button>
        )}
        {!selection && (
          <span className="ml-auto">
            Drag to move · Shift+drag snaps to weeks · Shift/Ctrl + wheel pans and zooms
          </span>
        )}
      </div>
    </div>
  );
}

/** Position of a date on the axis, 0..1. Dates outside the window clamp to its
 * edges, which is what keeps a tick for an out-of-range task off the page
 * rather than off the element. */
function fracOf(date: string, layout: TimelineLayout): number {
  if (layout.totalDays === 0) return 0;
  const offset = dayDelta(layout.start, date);
  return Math.max(0, Math.min(1, offset / layout.totalDays));
}

function rangeTooltip(bar: TimelineBar, t: ReturnType<typeof strings>): string {
  return [
    `${bar.item.title} · ${t.range(bar.item.start, bar.item.end)} · ${t.workingDays(
      bar.workingDays,
    )}`,
    bar.item.body,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * An `arrow` at timeline scale: a hairline between two heads, with the title
 * above it. Same meaning as in the calendar — a span that is still an estimate
 * — drawn with far less ink than a bar so the settled work stays dominant.
 */
function TimelineArrow({
  bar,
  selected,
  readOnly,
  title,
  onDrag,
  onPress,
}: {
  bar: TimelineBar;
  selected: boolean;
  readOnly?: boolean;
  title: string;
  onDrag: (e: React.PointerEvent, item: ScheduleItem, edge?: "start" | "end") => void;
  onPress: (item: ScheduleItem) => void;
}) {
  const color = bar.item.color ? COLOR_HEX[bar.item.color] : COLOR_HEX.gray;
  return (
    <div
      style={{
        left: `${bar.startFrac * 100}%`,
        width: `${bar.widthFrac * 100}%`,
        top: bar.lane * LANE_H,
      }}
      onPointerDown={(e) => onDrag(e, bar.item)}
      onPointerUp={() => onPress(bar.item)}
      className={cn(
        "absolute h-[20px]",
        !readOnly && "cursor-grab active:cursor-grabbing",
        selected && "rounded ring-1 ring-foreground",
      )}
      title={title}
    >
      {bar.isStart && !readOnly && (
        <span
          onPointerDown={(e) => onDrag(e, bar.item, "start")}
          className="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize"
        />
      )}
      <span
        className="absolute inset-x-0 top-0 flex items-center gap-1 truncate px-1 text-[10px] leading-[11px]"
        style={{ color }}
      >
        <span className="truncate">{bar.item.title}</span>
        <span className="shrink-0 opacity-80">{bar.workingDays}d</span>
      </span>
      <div className="absolute inset-x-0 top-[14px] flex items-center">
        {bar.isStart && (
          <span
            className="size-0 shrink-0 border-y-[3px] border-r-[5px] border-y-transparent"
            style={{ borderRightColor: color }}
          />
        )}
        <span className="h-px flex-1" style={{ background: color }} />
        {bar.isEnd && (
          <span
            className="size-0 shrink-0 border-y-[3px] border-l-[5px] border-y-transparent"
            style={{ borderLeftColor: color }}
          />
        )}
      </div>
      {bar.isEnd && !readOnly && (
        <span
          onPointerDown={(e) => onDrag(e, bar.item, "end")}
          className="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize"
        />
      )}
    </div>
  );
}

/**
 * A milestone or note on the axis: the marker sits on the day, the label runs
 * to its right. Unlike the calendar, a note is not a corner marker here —
 * there is no cell to put a corner on, and at this zoom a remark about a day
 * is one of the few things worth reading straight off the chart.
 */
function TimelinePointMarker({
  item,
  left,
  top,
  selected,
  readOnly,
  onDrag,
  onPress,
}: {
  item: ScheduleItem;
  left: number;
  top: number;
  selected: boolean;
  readOnly?: boolean;
  onDrag: (e: React.PointerEvent, item: ScheduleItem, edge?: "start" | "end") => void;
  onPress: (item: ScheduleItem) => void;
}) {
  const color = item.color ? COLOR_HEX[item.color] : COLOR_HEX.gray;
  return (
    <div
      style={{ left: `${left}%`, top }}
      onPointerDown={(e) => onDrag(e, item)}
      onPointerUp={() => onPress(item)}
      className={cn(
        "absolute flex h-[16px] max-w-[40%] items-center gap-1 pl-0.5 text-[10px]",
        !readOnly && "cursor-grab active:cursor-grabbing",
        selected && "font-semibold",
      )}
      title={[`${item.title} · ${item.start}`, item.body].filter(Boolean).join("\n")}
    >
      <span
        className={cn("size-1.5 shrink-0", item.kind === "milestone" ? "rotate-45" : "rounded-full")}
        style={{ background: color }}
      />
      <span className="truncate">{item.title}</span>
    </div>
  );
}

/**
 * Right-click menu for the plot. It always acts on a swept range (or the day
 * the sweep collapsed to), because a timeline has no day cell to right-click:
 * without a sweep there is no day the menu could be about.
 */
function TimelineMenuItems({
  readOnly,
  selection,
  weekly,
  onCreateItem,
  onToggleNonWorking,
}: {
  readOnly?: boolean;
  selection: { start: string; end: string } | null;
  weekly: boolean;
  onCreateItem: (kind: ItemKind, start: string, end: string) => void;
  onToggleNonWorking: (date: string) => void;
}) {
  if (!selection) {
    return (
      <ContextMenuLabel className="text-[11px] font-normal text-muted-foreground">
        Drag across the chart to pick a period first
      </ContextMenuLabel>
    );
  }
  const spansDays = selection.start !== selection.end;
  return (
    <>
      <ContextMenuLabel className="text-[11px] font-normal text-muted-foreground">
        {spansDays ? `${selection.start} → ${selection.end}` : selection.start}
      </ContextMenuLabel>
      <ContextMenuItem
        disabled={readOnly}
        onSelect={() => onCreateItem("bar", selection.start, selection.end)}
      >
        Add bar
      </ContextMenuItem>
      <ContextMenuItem
        disabled={readOnly}
        onSelect={() => onCreateItem("arrow", selection.start, selection.end)}
      >
        Add arrow
      </ContextMenuItem>
      <ContextMenuItem
        disabled={readOnly}
        onSelect={() => onCreateItem("milestone", selection.start, selection.start)}
      >
        Add milestone
      </ContextMenuItem>
      <ContextMenuItem
        disabled={readOnly}
        onSelect={() => onCreateItem("note", selection.start, selection.start)}
      >
        Add note
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem disabled={readOnly || weekly} onSelect={() => onToggleNonWorking(selection.start)}>
        {weekly ? "Weekend (set by the weekly: line)" : `Toggle non-working ${selection.start}`}
      </ContextMenuItem>
    </>
  );
}

/**
 * Applies the in-flight drag to a copy of the document, so the timeline lays
 * out the result rather than approximating it with a transform.
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
    return next.end < next.start ? item : next;
  });
  return { ...doc, items };
}
