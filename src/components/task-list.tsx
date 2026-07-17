import { Badge } from "@/components/ui/badge";
import { CopyPromptButton } from "@/components/copy-prompt-button";
import { LaunchAgentButton } from "@/components/launch-agent-button";
import { OpenInObsidianButton } from "@/components/open-in-obsidian-button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { dueTone } from "@/lib/task-due";
import { cn } from "@/lib/utils";
import type { Task } from "@/types";

const priorityVariant: Record<Task["priority"], "outline" | "secondary" | "destructive"> = {
  low: "outline",
  medium: "secondary",
  high: "destructive",
};

interface Props {
  tasks: Task[];
  onOpen: (task: Task) => void;
  onLaunchAgent: (task: Task) => Promise<unknown>;
  onCopyTaskPrompt: (task: Task) => Promise<unknown>;
  onOpenInObsidian: (task: Task) => Promise<unknown>;
  onArchive: (task: Task, archived: boolean) => void;
  onDelete: (task: Task) => void;
}

export function TaskList({ tasks, onOpen, onLaunchAgent, onCopyTaskPrompt, onOpenInObsidian, onArchive, onDelete }: Props) {
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
        <ContextMenu key={task.id}>
          <ContextMenuTrigger asChild>
            <div
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-md border bg-background px-3 py-2 hover:border-ring",
                task.archived && "opacity-50",
              )}
              onClick={() => onOpen(task)}
            >
              <span className="w-16 shrink-0 font-mono text-[11px] text-muted-foreground">
                {task.id}
              </span>
              <Badge variant="outline" className="shrink-0 capitalize">
                {task.status}
              </Badge>
              {task.archived && (
                <Badge variant="outline" className="shrink-0">
                  archived
                </Badge>
              )}
              <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
              {task.tags.map((t) => (
                <Badge
                  key={t}
                  variant="secondary"
                  className="hidden h-5 shrink-0 px-1.5 text-[10px] text-primary/90 lg:inline-flex"
                >
                  #{t}
                </Badge>
              ))}
              {task.project && (
                <span className="shrink-0 text-xs text-muted-foreground">{task.project}</span>
              )}
              <span className="shrink-0 text-xs text-muted-foreground">{task.assignee}</span>
              <Badge variant={priorityVariant[task.priority]} className="shrink-0">
                {task.priority}
              </Badge>
              {task.due && (
                <span className={cn("shrink-0 text-xs", dueTone(task.due, task.status))}>
                  {task.due}
                </span>
              )}
              {(task.assignee === "claude-code" || task.assignee === "opencode") && (
                <>
                  <CopyPromptButton
                    className="shrink-0"
                    onCopy={() => onCopyTaskPrompt(task)}
                  />
                  <LaunchAgentButton
                    className="shrink-0"
                    onLaunch={() => onLaunchAgent(task)}
                  />
                </>
              )}
              <OpenInObsidianButton
                className="shrink-0"
                onOpen={() => onOpenInObsidian(task)}
              />
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
      ))}
    </div>
  );
}
