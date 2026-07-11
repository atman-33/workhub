import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Task } from "@/types";

const priorityVariant: Record<Task["priority"], "outline" | "secondary" | "destructive"> = {
  low: "outline",
  medium: "secondary",
  high: "destructive",
};

interface Props {
  tasks: Task[];
  onOpen: (task: Task) => void;
  onLaunchAgent: (task: Task) => void;
}

export function TaskList({ tasks, onOpen, onLaunchAgent }: Props) {
  if (tasks.length === 0) {
    return (
      <p className="mt-16 text-center text-sm text-muted-foreground">
        No tasks match the current filter.
      </p>
    );
  }

  return (
    <div className="space-y-1 overflow-y-auto p-3">
      {tasks.map((task) => (
        <div
          key={task.id}
          className="flex cursor-pointer items-center gap-3 rounded-md border bg-background px-3 py-2 hover:border-ring"
          onClick={() => onOpen(task)}
        >
          <span className="w-16 shrink-0 font-mono text-[11px] text-muted-foreground">
            {task.id}
          </span>
          <Badge variant="outline" className="shrink-0 capitalize">
            {task.status}
          </Badge>
          <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
          {task.project && (
            <span className="shrink-0 text-xs text-muted-foreground">{task.project}</span>
          )}
          <span className="shrink-0 text-xs text-muted-foreground">{task.assignee}</span>
          <Badge variant={priorityVariant[task.priority]} className="shrink-0">
            {task.priority}
          </Badge>
          {task.due && <span className="shrink-0 text-xs text-muted-foreground">{task.due}</span>}
          {(task.assignee === "claude-code" || task.assignee === "opencode") && (
            <Button
              size="xs"
              variant="outline"
              className="shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                onLaunchAgent(task);
              }}
            >
              Launch agent
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
