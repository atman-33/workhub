import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { parseBody } from "@/lib/taskBody";
import type { Task, TaskAssignee, TaskPriority, TaskStatus } from "@/types";

export interface TaskDraft {
  title: string;
  status: TaskStatus;
  assignee: TaskAssignee;
  project: string;
  priority: TaskPriority;
  due: string;
  tags: string; // comma-separated for editing
  content: string;
}

const EMPTY_DRAFT: TaskDraft = {
  title: "",
  status: "inbox",
  assignee: "me",
  project: "",
  priority: "medium",
  due: "",
  tags: "",
  content: "",
};

function draftFromTask(task: Task): TaskDraft {
  return {
    title: task.title,
    status: task.status,
    assignee: task.assignee,
    project: task.project,
    priority: task.priority,
    due: task.due,
    tags: task.tags.join(", "),
    content: parseBody(task.body).content,
  };
}

const STATUSES: TaskStatus[] = ["inbox", "todo", "doing", "review", "done"];
const ASSIGNEES: TaskAssignee[] = ["me", "claude-code", "opencode"];
const PRIORITIES: TaskPriority[] = ["low", "medium", "high"];

const selectClass =
  "h-8 rounded-md border border-input bg-transparent px-2 text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

interface Props {
  open: boolean;
  mode: "create" | "edit";
  task: Task | null;
  knownProjects: string[];
  onClose: () => void;
  onSubmit: (draft: TaskDraft) => void;
}

export function TaskDialog({ open, mode, task, knownProjects, onClose, onSubmit }: Props) {
  const [draft, setDraft] = useState<TaskDraft>(EMPTY_DRAFT);

  useEffect(() => {
    if (!open) return;
    setDraft(task ? draftFromTask(task) : EMPTY_DRAFT);
  }, [open, task]);

  const field = (label: string, node: ReactNode) => (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {node}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "New task" : `${task?.id} — Edit task`}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {field(
            "Title",
            <Input
              autoFocus
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className="h-8 text-sm"
              placeholder="Task title"
            />,
          )}
          <div className="grid grid-cols-3 gap-3">
            {field(
              "Status",
              <select
                className={selectClass}
                value={draft.status}
                onChange={(e) => setDraft({ ...draft, status: e.target.value as TaskStatus })}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>,
            )}
            {field(
              "Assignee",
              <select
                className={selectClass}
                value={draft.assignee}
                onChange={(e) => setDraft({ ...draft, assignee: e.target.value as TaskAssignee })}
              >
                {ASSIGNEES.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>,
            )}
            {field(
              "Priority",
              <select
                className={selectClass}
                value={draft.priority}
                onChange={(e) => setDraft({ ...draft, priority: e.target.value as TaskPriority })}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>,
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field(
              "Project",
              <Input
                list="task-known-projects"
                value={draft.project}
                onChange={(e) => setDraft({ ...draft, project: e.target.value })}
                className="h-8 text-xs"
                placeholder="repo name or path"
              />,
            )}
            {field(
              "Due",
              <Input
                type="date"
                value={draft.due}
                onChange={(e) => setDraft({ ...draft, due: e.target.value })}
                className="h-8 text-xs"
              />,
            )}
          </div>
          <datalist id="task-known-projects">
            {knownProjects.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          {field(
            "Tags (comma separated)",
            <Input
              value={draft.tags}
              onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
              className="h-8 text-xs"
              placeholder="feature, bug"
            />,
          )}
          {field(
            "内容",
            <Textarea
              value={draft.content}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
              rows={6}
              placeholder="Task description — this is the prompt context handed to AI agents."
            />,
          )}
        </div>
        <DialogFooter>
          <Button
            disabled={!draft.title.trim()}
            onClick={() => {
              onSubmit(draft);
              onClose();
            }}
          >
            {mode === "create" ? "Create" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
