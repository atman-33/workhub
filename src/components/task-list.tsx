import { ClipboardList } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BlockedBadge } from "@/components/blocked-badge";
import { ClaudeDesktopButton } from "@/components/claude-desktop-button";
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
import { parseBody } from "@/lib/task-body";
import { dueTone } from "@/lib/task-due";
import { cn } from "@/lib/utils";
import type { Task, TaskPriority } from "@/types";

interface Props {
  tasks: Task[];
  onOpen: (task: Task) => void;
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
  onDelete: (task: Task) => void;
}

export function TaskList({ tasks, onOpen, onLaunchAgent, onCopyTaskPrompt, onSendToClaudeDesktop, claudeDesktopMode, onOpenInObsidian, onCyclePriority, onEditBlocked, onUnblock, onArchive, onDelete }: Props) {
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
                // Blocked rows recede, but less than archived ones. The left
                // rule matches the kanban card's, so a stack of rows is scanned
                // down its edge without spending colour on unworkable tasks.
                // No pause icon on the title here — unlike the card, the badge
                // already sits right next to it.
                !task.archived && task.blocked && "border-l-2 border-l-muted-foreground/50 opacity-75",
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
              {task.blocked && (
                <BlockedBadge
                  note={task.blocked_note}
                  since={task.blocked_since}
                  onEdit={() => onEditBlocked(task)}
                  // Capped so a long reason can't squeeze the title out.
                  className="max-w-[16rem]"
                />
              )}
              {parseBody(task.body).plan && (
                <span title="Plan recorded" className="flex shrink-0">
                  <ClipboardList
                    className="size-3.5 text-muted-foreground"
                    aria-label="Plan recorded"
                  />
                </span>
              )}
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
              <PriorityBadge
                priority={task.priority}
                onCycle={(next) => onCyclePriority(task, next)}
                className="shrink-0"
              />
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
                  <ClaudeDesktopButton
                    className="shrink-0"
                    mode={claudeDesktopMode === "chat" ? "chat" : "code session"}
                    onSend={() => onSendToClaudeDesktop(task)}
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
            <ContextMenuItem onSelect={() => onEditBlocked(task)}>
              {task.blocked ? "Edit blocked reason…" : "Mark as blocked…"}
            </ContextMenuItem>
            {task.blocked && (
              <ContextMenuItem onSelect={() => onUnblock(task)}>Unblock</ContextMenuItem>
            )}
            <ContextMenuSeparator />
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
