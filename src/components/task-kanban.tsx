import { useMemo, useState } from "react";
import { Archive } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { dueTone } from "@/lib/task-due";
import { cn } from "@/lib/utils";
import type { Task, TaskPriority, TaskStatus, UpdateTaskInput } from "@/types";

const COLUMNS: { key: TaskStatus; label: string }[] = [
  { key: "inbox", label: "Inbox" },
  { key: "todo", label: "Todo" },
  { key: "doing", label: "Doing" },
  { key: "review", label: "Review" },
  { key: "done", label: "Done" },
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

/** Insertion position (drop target): column plus index within it. */
type DropPos = { col: TaskStatus; index: number } | null;

interface Props {
  tasks: Task[];
  onOpen: (task: Task) => void;
  /** Applies one or more frontmatter updates (order and/or status), then refreshes. */
  onMove: (updates: UpdateTaskInput[]) => void;
  onLaunchAgent: (task: Task) => Promise<unknown>;
  onCopyTaskPrompt: (task: Task) => Promise<unknown>;
  onOpenInObsidian: (task: Task) => Promise<unknown>;
  onCyclePriority: (task: Task, next: TaskPriority) => void;
  onArchive: (task: Task, archived: boolean) => void;
  /** Archives every non-archived task in the Done column in one action. */
  onArchiveDone: () => void;
  onDelete: (task: Task) => void;
}

export function TaskKanban({ tasks, onOpen, onMove, onLaunchAgent, onCopyTaskPrompt, onOpenInObsidian, onCyclePriority, onArchive, onArchiveDone, onDelete }: Props) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropPos, setDropPos] = useState<DropPos>(null);

  const columns = useMemo(
    () => COLUMNS.map((col) => ({ ...col, ...columnWithEffectiveOrders(tasks, col.key) })),
    [tasks],
  );

  const handleDrop = (col: TaskStatus, index: number) => {
    setDropPos(null);
    const dragged = tasks.find((t) => t.id === draggedId);
    setDraggedId(null);
    if (!dragged) return;

    const { items, eff } = columnWithEffectiveOrders(tasks, col);
    // Work against the column without the dragged card, adjusting the
    // insertion index if the card is moving down within the same column.
    const fromIdx = items.findIndex((t) => t.id === dragged.id);
    const rows = items
      .map((t, i) => ({ t, e: eff[i] }))
      .filter(({ t }) => t.id !== dragged.id);
    let insert = index;
    if (fromIdx !== -1 && fromIdx < index) insert -= 1;
    if (fromIdx !== -1 && insert === fromIdx && dragged.status === col) return; // no-op drop

    const prev = insert > 0 ? rows[insert - 1].e : null;
    const next = insert < rows.length ? rows[insert].e : null;

    let order: number;
    if (prev === null && next === null) order = 1;
    else if (prev === null) order = (next as number) - 1;
    else if (next === null) order = prev + 1;
    else order = (prev + next) / 2;

    const statusChange = dragged.status !== col ? { status: col } : {};

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

  return (
    <div className="grid h-full min-h-0 grid-cols-5 gap-3 overflow-x-auto overflow-y-hidden p-3">
      {columns.map((col) => (
        <div
          key={col.key}
          className={cn(
            "flex min-h-0 min-w-0 flex-col rounded-lg border bg-muted/20 transition-colors",
            dropPos?.col === col.key && "border-ring",
          )}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            // Only when over the column padding itself (cards handle their own).
            if (e.target === e.currentTarget) setDropPos({ col: col.key, index: col.items.length });
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropPos(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            handleDrop(col.key, dropPos?.col === col.key ? dropPos.index : col.items.length);
          }}
        >
          <div className="flex items-center justify-between border-b px-2.5 py-2">
            <span className="text-xs font-semibold">{col.label}</span>
            <div className="flex items-center gap-1.5">
              {col.key === "done" && col.items.some((t) => !t.archived) && (
                <button
                  className="flex items-center rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                  title="Archive all Done tasks"
                  onClick={onArchiveDone}
                >
                  <Archive className="size-3.5" />
                </button>
              )}
              <span className="text-[11px] text-muted-foreground">{col.items.length}</span>
            </div>
          </div>
          <div
            className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2"
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (e.target === e.currentTarget)
                setDropPos({ col: col.key, index: col.items.length });
            }}
          >
            {col.items.map((task, i) => (
              <div key={task.id}>
                {dropPos?.col === col.key && dropPos.index === i && indicator}
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
                    setDropPos({ col: col.key, index: cardInsertIndex(e, i) });
                  }}
                  className={cn(
                    "cursor-grab space-y-1.5 rounded-md border bg-background p-2.5 shadow-xs hover:border-ring active:cursor-grabbing",
                    (draggedId === task.id || task.archived) && "opacity-50",
                  )}
                  onClick={() => onOpen(task)}
                >
                  <div className="flex items-start justify-between gap-1">
                    <span className="text-xs font-medium leading-tight">{task.title}</span>
                    <div className="flex shrink-0 items-center gap-1">
                      {task.archived && <Badge variant="outline">archived</Badge>}
                      <PriorityBadge
                        priority={task.priority}
                        onCycle={(next) => onCyclePriority(task, next)}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                    <span>{task.id}</span>
                    {task.project && <span>· {task.project}</span>}
                    <span>· {task.assignee}</span>
                    {task.due && (
                      <span className={dueTone(task.due, task.status)}>· {task.due}</span>
                    )}
                    <span className="ml-auto flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      {(task.assignee === "claude-code" || task.assignee === "opencode") && (
                        <>
                          <CopyPromptButton onCopy={() => onCopyTaskPrompt(task)} />
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
                    <ContextMenuItem onSelect={() => onArchive(task, !task.archived)}>
                      {task.archived ? "Unarchive" : "Archive"}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem variant="destructive" onSelect={() => onDelete(task)}>
                      Delete…
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              </div>
            ))}
            {dropPos?.col === col.key && dropPos.index === col.items.length && indicator}
          </div>
        </div>
      ))}
    </div>
  );
}
