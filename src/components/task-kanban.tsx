import { Fragment, useMemo, useState } from "react";
import { Archive, ChevronDown, ClipboardList } from "lucide-react";
import { ArchiveMoreFooter, type ArchiveFooterProps } from "@/components/archive-more-footer";
import { Badge } from "@/components/ui/badge";
import { Hint } from "@/components/ui/hint";
import { BlockedBadge, BlockedMark } from "@/components/blocked-badge";
import { ClaudeDesktopButton } from "@/components/claude-desktop-button";
import { DependencyBadge } from "@/components/dependency-badge";
import { CopyPromptButton } from "@/components/copy-prompt-button";
import { LaunchAgentButton } from "@/components/launch-agent-button";
import { OpenInObsidianButton } from "@/components/open-in-obsidian-button";
import { PriorityBadge } from "@/components/priority-badge";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useT, type MessageKey } from "@/lib/i18n";
import { parseBody } from "@/lib/task-body";
import { dueTone } from "@/lib/task-due";
import { projectLanes, type Lane } from "@/lib/task-lanes";
import { priorityTintClass } from "@/lib/task-priority";
import { cn } from "@/lib/utils";
import type { Task, TaskPriority, TaskStatus, UpdateTaskInput } from "@/types";

const COLUMNS: { key: TaskStatus; labelKey: MessageKey }[] = [
  { key: "inbox", labelKey: "task.status.inbox" },
  { key: "todo", labelKey: "task.status.todo" },
  { key: "doing", labelKey: "task.status.doing" },
  { key: "review", labelKey: "task.status.review" },
  { key: "done", labelKey: "task.status.done" },
];

/** Sorted column items plus effective numeric orders for midpoint math.
 * Tasks without an explicit order sort last (by id) and get a synthetic
 * effective order continuing the sequence. */
function columnWithEffectiveOrders(tasks: Task[], status: TaskStatus) {
  const items = tasks
    .filter((t) => t.status === status)
    .sort((a, b) => {
      const ao = a.order ?? Number.POSITIVE_INFINITY;
      const bo = b.order ?? Number.POSITIVE_INFINITY;
      if (ao !== bo) return ao - bo;
      return a.id.localeCompare(b.id);
    });
  const eff: number[] = [];
  let prev = 0;
  for (const t of items) {
    const e = t.order ?? prev + 1;
    eff.push(e);
    prev = e;
  }
  return { items, eff };
}

/** How the board is split: one set of columns, or one row of columns per
 * project (T-0646). */
export type KanbanGroupBy = "none" | "project";


const NO_LANE = "";

/** Insertion position (drop target): lane, column, and index within it. */
type DropPos = { lane: string; col: TaskStatus; index: number } | null;

const COLLAPSED_KEY = "workhub.tasks.collapsedLanes";

function loadCollapsed(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

interface Props {
  tasks: Task[];
  /** `project` draws one row of columns per project. */
  groupBy?: KanbanGroupBy;
  /** Project slugs in display order, for the project rows. */
  projectOrder?: readonly string[];
  /** Footer props while archived tasks are capped; omit when all are drawn. */
  archiveFooter?: ArchiveFooterProps;
  /** Open predecessors per task id; absent for a task that is not waiting. */
  waiting: ReadonlyMap<string, Task[]>;
  onOpen: (task: Task) => void;
  /** Applies one or more frontmatter updates (order and/or status), then refreshes. */
  onMove: (updates: UpdateTaskInput[]) => void;
  onLaunchAgent: (task: Task) => Promise<unknown>;
  onCopyTaskPrompt: (task: Task) => Promise<unknown>;
  onSendToClaudeDesktop: (task: Task) => Promise<unknown>;
  /** `claude_desktop_mode` setting, shown in the send button's tooltip. */
  claudeDesktopMode: string;
  onOpenInObsidian: (task: Task) => Promise<unknown>;
  onCyclePriority: (task: Task, next: TaskPriority) => void;
  /** Opens the one-field reason editor (blocking the task if it wasn't). */
  onEditBlocked: (task: Task) => void;
  /** Clears a task's blocked flag along with its note and date. */
  onUnblock: (task: Task) => void;
  onArchive: (task: Task, archived: boolean) => void;
  /** Archives every non-archived task in the Done column in one action. */
  onArchiveDone: () => void;
  onDelete: (task: Task) => void;
}

export function TaskKanban({ tasks, groupBy = "none", projectOrder = [], archiveFooter, waiting, onOpen, onMove, onLaunchAgent, onCopyTaskPrompt, onSendToClaudeDesktop, claudeDesktopMode, onOpenInObsidian, onCyclePriority, onEditBlocked, onUnblock, onArchive, onArchiveDone, onDelete }: Props) {
  const t = useT();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropPos, setDropPos] = useState<DropPos>(null);

  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);

  const toggleLane = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {
        // Storage unavailable: the fold just does not survive a restart.
      }
      return next;
    });

  const lanes = useMemo<Lane[]>(
    () =>
      groupBy === "project"
        ? projectLanes(tasks, projectOrder)
        : [{ key: NO_LANE, project: null, tasks }],
    [tasks, groupBy, projectOrder],
  );

  const laneColumns = useMemo(
    () =>
      lanes.map((lane) => ({
        lane,
        columns: COLUMNS.map((col) => ({ ...col, ...columnWithEffectiveOrders(lane.tasks, col.key) })),
      })),
    [lanes],
  );

  const handleDrop = (lane: Lane, col: TaskStatus, index: number) => {
    setDropPos(null);
    const dragged = tasks.find((t) => t.id === draggedId);
    setDraggedId(null);
    if (!dragged) return;

    // Dropping into another project's row re-files the task. Its backlog item
    // belongs to the old project, so it is cleared rather than left dangling.
    const projectChange =
      lane.project !== null && dragged.project !== lane.project
        ? { project: lane.project, backlog: "" }
        : {};
    const sameLane = lane.project === null || dragged.project === lane.project;

    const { items, eff } = columnWithEffectiveOrders(lane.tasks, col);
    // Work against the column without the dragged card, adjusting the
    // insertion index if the card is moving down within the same column.
    const fromIdx = items.findIndex((t) => t.id === dragged.id);
    const rows = items
      .map((t, i) => ({ t, e: eff[i] }))
      .filter(({ t }) => t.id !== dragged.id);
    let insert = index;
    if (fromIdx !== -1 && fromIdx < index) insert -= 1;
    if (sameLane && fromIdx !== -1 && insert === fromIdx && dragged.status === col) return; // no-op drop

    const prev = insert > 0 ? rows[insert - 1].e : null;
    const next = insert < rows.length ? rows[insert].e : null;

    let order: number;
    if (prev === null && next === null) order = 1;
    else if (prev === null) order = (next as number) - 1;
    else if (next === null) order = prev + 1;
    else order = (prev + next) / 2;

    const statusChange = { ...(dragged.status !== col ? { status: col } : {}), ...projectChange };

    // Fractional precision exhausted between equal/adjacent floats: reindex
    // the whole column (rare; one write per card).
    if (prev !== null && next !== null && !(order > prev && order < next)) {
      const finalRows = [...rows.slice(0, insert), { t: dragged, e: 0 }, ...rows.slice(insert)];
      onMove(
        finalRows.map(({ t }, i) => ({
          id: t.id,
          order: i + 1,
          ...(t.id === dragged.id ? statusChange : {}),
        })),
      );
      return;
    }

    onMove([{ id: dragged.id, order, ...statusChange }]);
  };

  /** Insertion index from a drag event over a card: before or after it
   * depending on which half of the card the pointer is in. */
  const cardInsertIndex = (e: React.DragEvent, cardIndex: number) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const below = e.clientY > rect.top + rect.height / 2;
    return cardIndex + (below ? 1 : 0);
  };

  const indicator = <div className="h-0.5 rounded bg-ring" />;

  const isDrop = (lane: Lane, col: TaskStatus) =>
    dropPos !== null && dropPos.lane === lane.key && dropPos.col === col;

  type Column = (typeof laneColumns)[number]["columns"][number];

  /** One column of one row. Only the ungrouped board gives it its own header;
   * the project rows share a single sticky header row above them. */
  const renderCell = (lane: Lane, col: Column, withHeader: boolean) => (
    <div
      key={col.key}
      className={cn(
        "flex min-h-0 min-w-0 flex-col rounded-lg border bg-muted/20 transition-colors",
        isDrop(lane, col.key) && "border-ring",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        // Only when over the column padding itself (cards handle their own).
        if (e.target === e.currentTarget)
          setDropPos({ lane: lane.key, col: col.key, index: col.items.length });
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropPos(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        handleDrop(lane, col.key, isDrop(lane, col.key) ? (dropPos?.index ?? col.items.length) : col.items.length);
      }}
    >
      {withHeader && (
        <div className="flex items-center justify-between border-b px-2.5 py-2">
          <span className="text-xs font-semibold">{t(col.labelKey)}</span>
          <div className="flex items-center gap-1.5">
            {doneArchiveButton(col)}
            <span className="text-[11px] text-muted-foreground">{col.items.length}</span>
          </div>
        </div>
      )}
      <div
        className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2"
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (e.target === e.currentTarget)
            setDropPos({ lane: lane.key, col: col.key, index: col.items.length });
        }}
      >
            {col.items.map((task, i) => (
              <div key={task.id}>
                {isDrop(lane, col.key) && dropPos?.index === i && indicator}
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                <div
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", task.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDraggedId(task.id);
                  }}
                  onDragEnd={() => {
                    setDraggedId(null);
                    setDropPos(null);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = "move";
                    setDropPos({ lane: lane.key, col: col.key, index: cardInsertIndex(e, i) });
                  }}
                  className={cn(
                    "cursor-grab space-y-1.5 rounded-md border bg-background p-2.5 shadow-xs hover:border-ring active:cursor-grabbing",
                    priorityTintClass(task),
                    (draggedId === task.id || task.archived) && "opacity-50",
                    // Blocked tasks aren't actionable right now, so they recede
                    // — but less than archived ones, which are gone for good.
                    !task.archived && task.blocked && "opacity-75",
                  )}
                  onClick={() => onOpen(task)}
                >
                  <div className="flex items-start justify-between gap-1">
                    <span className="text-xs font-medium leading-tight">
                      {task.blocked && <BlockedMark />}
                      {task.title}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      {task.archived && (
                        <Badge variant="outline">{t("task.list.archivedBadge")}</Badge>
                      )}
                      <PriorityBadge
                        priority={task.priority}
                        onCycle={(next) => onCyclePriority(task, next)}
                      />
                    </div>
                  </div>
                  {task.blocked && (
                    <BlockedBadge
                      note={task.blocked_note}
                      since={task.blocked_since}
                      onEdit={() => onEditBlocked(task)}
                      className="w-full"
                    />
                  )}
                  {waiting.has(task.id) && (
                    <DependencyBadge waiting={waiting.get(task.id) ?? []} className="w-full" />
                  )}
                  <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                    <span>{task.id}</span>
                    {parseBody(task.body).plan && (
                      <Hint label={t("task.list.planRecorded")}>
                        <span className="flex shrink-0">
                          <ClipboardList
                            className="size-3"
                            aria-label={t("task.list.planRecorded")}
                          />
                        </span>
                      </Hint>
                    )}
                    {task.project && (
                      <span>
                        {"· "}
                        {task.project}
                        {/* The item id rides on the project rather than
                            standing alone: `B-007` means nothing without the
                            project whose backlog it is in (T-0253). */}
                        {task.backlog ? `/${task.backlog}` : ""}
                      </span>
                    )}
                    <span>· {task.assignee}</span>
                    {task.due && (
                      <span className={dueTone(task.due, task.status)}>· {task.due}</span>
                    )}
                    <span className="ml-auto flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      {(task.assignee === "claude-code" || task.assignee === "opencode") && (
                        <>
                          <CopyPromptButton onCopy={() => onCopyTaskPrompt(task)} />
                          <ClaudeDesktopButton
                            mode={claudeDesktopMode === "chat" ? "chat" : "code"}
                            onSend={() => onSendToClaudeDesktop(task)}
                          />
                          <LaunchAgentButton onLaunch={() => onLaunchAgent(task)} />
                        </>
                      )}
                      <OpenInObsidianButton onOpen={() => onOpenInObsidian(task)} />
                    </span>
                  </div>
                  {task.tags.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1">
                      {task.tags.map((t) => (
                        <Badge
                          key={t}
                          variant="secondary"
                          className="h-4 px-1 text-[10px] text-primary/90"
                        >
                          #{t}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onSelect={() => onEditBlocked(task)}>
                      {task.blocked
                        ? t("task.list.editBlockedReason")
                        : t("task.list.markBlocked")}
                    </ContextMenuItem>
                    {task.blocked && (
                      <ContextMenuItem onSelect={() => onUnblock(task)}>
                        {t("task.list.unblock")}
                      </ContextMenuItem>
                    )}
                    <ContextMenuSeparator />
                    <ContextMenuItem onSelect={() => onArchive(task, !task.archived)}>
                      {task.archived ? t("task.list.unarchive") : t("task.list.archive")}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem variant="destructive" onSelect={() => onDelete(task)}>
                      {t("task.list.deleteEllipsis")}
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              </div>
            ))}
        {isDrop(lane, col.key) && dropPos?.index === col.items.length && indicator}
        {withHeader && col.key === "done" && archiveFooter && <ArchiveMoreFooter {...archiveFooter} />}
      </div>
    </div>
  );

  const doneArchiveButton = (col: Column) =>
    col.key === "done" && col.items.some((t) => !t.archived) ? (
      <Hint label={t("task.kanban.archiveAllDone")}>
        <button
          className="flex items-center rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
          onClick={onArchiveDone}
        >
          <Archive className="size-3.5" />
        </button>
      </Hint>
    ) : null;

  if (groupBy !== "project") {
    return (
      <div className="grid h-full min-h-0 grid-cols-5 gap-3 overflow-x-auto overflow-y-hidden p-3">
        {laneColumns[0].columns.map((col) => renderCell(laneColumns[0].lane, col, true))}
      </div>
    );
  }

  const allColumns = COLUMNS.map((col) => ({
    ...col,
    count: tasks.filter((x) => x.status === col.key).length,
  }));
  return (
    <div className="h-full min-h-0 overflow-y-auto overflow-x-hidden px-3 pb-3">
      {/* One status header row for the whole board, kept in view while the
          project rows scroll under it. The project name is a band above each
          row rather than a column beside it, so the five status columns keep
          the full width and the board never needs a horizontal scrollbar. */}
      <div className="sticky top-0 z-10 grid grid-cols-5 gap-2 bg-background pt-3 pb-2">
        {allColumns.map((col) => (
          <div
            key={col.key}
            className="flex min-w-0 items-center justify-between rounded-lg border bg-background px-2.5 py-2"
          >
            <span className="text-xs font-semibold">{t(col.labelKey)}</span>
            <div className="flex items-center gap-1.5">
              {doneArchiveButton({
                ...col,
                ...columnWithEffectiveOrders(tasks, col.key),
              })}
              <span className="text-[11px] text-muted-foreground">{col.count}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-5 gap-2">
        {laneColumns.map(({ lane, columns }) => {
          const isCollapsed = collapsed.has(lane.key);
          const doing = lane.tasks.filter((x) => x.status === "doing").length;
          return (
            <Fragment key={lane.key}>
              <button
                type="button"
                aria-expanded={!isCollapsed}
                className="col-span-5 mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md border bg-muted/30 px-2.5 py-1.5 text-left hover:border-ring"
                onClick={() => toggleLane(lane.key)}
              >
                <ChevronDown
                  className={cn("size-3.5 shrink-0 transition-transform", isCollapsed && "-rotate-90")}
                />
                <span className="min-w-0 truncate text-xs font-semibold">
                  {lane.project === "" ? t("task.kanban.noProject") : lane.project}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {t("task.kanban.laneSummary", { count: lane.tasks.length, doing })}
                </span>
                {isCollapsed && (
                  <span className="ml-auto flex flex-wrap items-center gap-1">
                    {columns.map((col) => (
                      <Badge key={col.key} variant="outline" className="text-[10px]">
                        {t(col.labelKey)} {col.items.length}
                      </Badge>
                    ))}
                  </span>
                )}
              </button>
              {!isCollapsed && columns.map((col) => renderCell(lane, col, false))}
            </Fragment>
          );
        })}
      </div>
      {archiveFooter && <ArchiveMoreFooter {...archiveFooter} />}
    </div>
  );
}
