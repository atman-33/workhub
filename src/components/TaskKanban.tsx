import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Task, TaskStatus } from "@/types";

const COLUMNS: { key: TaskStatus; label: string }[] = [
  { key: "inbox", label: "Inbox" },
  { key: "todo", label: "Todo" },
  { key: "doing", label: "Doing" },
  { key: "review", label: "Review" },
  { key: "done", label: "Done" },
];

const priorityVariant: Record<Task["priority"], "outline" | "secondary" | "destructive"> = {
  low: "outline",
  medium: "secondary",
  high: "destructive",
};

interface Props {
  tasks: Task[];
  onOpen: (task: Task) => void;
  onStatusChange: (task: Task, status: TaskStatus) => void;
  onLaunchAgent: (task: Task) => void;
}

export function TaskKanban({ tasks, onOpen, onStatusChange, onLaunchAgent }: Props) {
  const [dragOverCol, setDragOverCol] = useState<TaskStatus | null>(null);

  const handleDrop = (col: TaskStatus, e: React.DragEvent) => {
    e.preventDefault();
    setDragOverCol(null);
    const id = e.dataTransfer.getData("text/plain");
    const task = tasks.find((t) => t.id === id);
    if (task && task.status !== col) onStatusChange(task, col);
  };

  return (
    <div className="grid h-full grid-cols-5 gap-3 overflow-x-auto p-3">
      {COLUMNS.map((col) => {
        const items = tasks.filter((t) => t.status === col.key);
        return (
          <div
            key={col.key}
            className={cn(
              "flex min-w-0 flex-col rounded-lg border bg-muted/20 transition-colors",
              dragOverCol === col.key && "border-ring bg-accent/40",
            )}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setDragOverCol(col.key);
            }}
            onDragLeave={(e) => {
              // Only clear when leaving the column itself, not moving between children.
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverCol(null);
            }}
            onDrop={(e) => handleDrop(col.key, e)}
          >
            <div className="flex items-center justify-between border-b px-2.5 py-2">
              <span className="text-xs font-semibold">{col.label}</span>
              <span className="text-[11px] text-muted-foreground">{items.length}</span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-2">
              {items.map((task) => (
                <div
                  key={task.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", task.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  className="cursor-grab space-y-1.5 rounded-md border bg-background p-2.5 shadow-xs hover:border-ring active:cursor-grabbing"
                  onClick={() => onOpen(task)}
                >
                  <div className="flex items-start justify-between gap-1">
                    <span className="text-xs font-medium leading-tight">{task.title}</span>
                    <Badge variant={priorityVariant[task.priority]} className="shrink-0">
                      {task.priority}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                    <span>{task.id}</span>
                    {task.project && <span>· {task.project}</span>}
                    <span>· {task.assignee}</span>
                  </div>
                  {(task.assignee === "claude-code" || task.assignee === "opencode") && (
                    <div className="pt-1" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="xs"
                        variant="outline"
                        className="w-full"
                        onClick={() => onLaunchAgent(task)}
                      >
                        AI で実行
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
