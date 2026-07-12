import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { Switch } from "@/components/ui/switch";
import { DatePicker } from "@/components/ui/date-picker";
import { Textarea } from "@/components/ui/textarea";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { parseBody } from "@/lib/task-body";
import type { Task, TaskAssignee, TaskPriority, TaskStatus } from "@/types";

export interface TaskDraft {
  title: string;
  status: TaskStatus;
  assignee: TaskAssignee;
  project: string;
  priority: TaskPriority;
  model: string;
  confirm: boolean;
  worktree: boolean;
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
  model: "",
  confirm: false,
  worktree: false,
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
    model: task.model,
    confirm: task.confirm,
    worktree: task.worktree,
    due: task.due,
    tags: task.tags.join(", "),
    content: parseBody(task.body).content,
  };
}

const STATUSES: TaskStatus[] = ["inbox", "todo", "doing", "review", "done"];
const ASSIGNEES: TaskAssignee[] = ["me", "claude-code", "opencode"];
const PRIORITIES: TaskPriority[] = ["low", "medium", "high"];

const CLAUDE_MODELS = ["haiku", "sonnet", "opus"];

const CREATE_DRAFT_KEY = "workhub:task-draft:create";

function loadCreateDraft(): TaskDraft | null {
  try {
    const raw = localStorage.getItem(CREATE_DRAFT_KEY);
    return raw ? (JSON.parse(raw) as TaskDraft) : null;
  } catch {
    return null;
  }
}

function saveCreateDraft(draft: TaskDraft): void {
  try {
    localStorage.setItem(CREATE_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Storage can be unavailable or full; ignore silently.
  }
}

function clearCreateDraft(): void {
  try {
    localStorage.removeItem(CREATE_DRAFT_KEY);
  } catch {
    // Ignore storage errors.
  }
}

// `opencode models` is a CLI spawn; fetch once per app run and share the
// result across dialog opens.
let opencodeModelsCache: string[] | null = null;
let opencodeModelsErrorCache: string | null = null;

interface Props {
  open: boolean;
  mode: "create" | "edit";
  task: Task | null;
  knownProjects: string[];
  onClose: () => void;
  /** Called once when the user confirms creation of a new task. */
  onCreate?: (draft: TaskDraft) => void;
  /** Called while editing an existing task, both on idle and on close. */
  onAutoSave?: (draft: TaskDraft) => Promise<void>;
}

export function TaskDialog({ open, mode, task, knownProjects, onClose, onCreate, onAutoSave }: Props) {
  const [draft, setDraft] = useState<TaskDraft>(EMPTY_DRAFT);
  const [opencodeModels, setOpencodeModels] = useState<string[]>(opencodeModelsCache ?? []);
  const [opencodeModelsError, setOpencodeModelsError] = useState<string | null>(
    opencodeModelsErrorCache,
  );

  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // On open, initialize the form. Edit mode uses the task file as the source
  // of truth; create mode restores a localStorage draft so an accidental close
  // before creation does not lose input.
  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && task) {
      setDraft(draftFromTask(task));
    } else {
      setDraft(loadCreateDraft() ?? EMPTY_DRAFT);
    }
  }, [open, mode, task]);

  // Create mode: persist the draft to localStorage until the user confirms.
  useEffect(() => {
    if (!open || mode !== "create") return;
    const timer = setTimeout(() => saveCreateDraft(draft), 500);
    return () => clearTimeout(timer);
  }, [draft, mode, open]);

  // Edit mode: auto-save to the task file shortly after the user stops editing.
  useEffect(() => {
    if (!open || mode !== "edit" || !onAutoSave || !draft.title.trim()) return;
    autoSaveTimerRef.current = setTimeout(() => {
      void onAutoSave(draft);
    }, 1000);
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [draft, mode, onAutoSave, open]);

  // Lazily fetch the opencode model catalog the first time an opencode task
  // is edited; later opens reuse the module-level cache.
  useEffect(() => {
    if (!open || draft.assignee !== "opencode" || opencodeModelsCache !== null) return;
    let cancelled = false;
    void api
      .opencodeModels()
      .then((models) => {
        opencodeModelsCache = models;
        opencodeModelsErrorCache = null;
        if (!cancelled) {
          setOpencodeModels(models);
          setOpencodeModelsError(null);
        }
      })
      .catch((e) => {
        opencodeModelsErrorCache = String(e);
        if (!cancelled) setOpencodeModelsError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [open, draft.assignee]);

  const field = (label: string, node: ReactNode) => (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {node}
    </div>
  );

  // Launch-mode toggles (confirm / worktree) only affect AI agent launches, so
  // they are disabled for "me" tasks, which spawn no agent.
  const toggle = (
    label: string,
    description: string,
    checked: boolean,
    onCheckedChange: (v: boolean) => void,
    disabled: boolean,
  ) => (
    <div
      className="flex items-start justify-between gap-2 rounded-md border px-3 py-2"
      data-disabled={disabled || undefined}
    >
      <div className="space-y-0.5">
        <label className="text-xs font-medium text-muted-foreground">{label}</label>
        <p className="text-[10px] leading-tight text-muted-foreground/70">{description}</p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="mt-0.5"
      />
    </div>
  );

  const hasOptionalDetails =
    draft.priority !== "medium" || draft.due || draft.tags.trim();
  const optionalSummary = [
    draft.priority !== "medium" ? `Priority: ${draft.priority}` : "",
    draft.due ? `Due: ${draft.due}` : "",
    draft.tags.trim() ? `Tags: ${draft.tags.trim()}` : "",
  ]
    .filter(Boolean)
    .join(" · ") || "None set";

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) return;
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      if (mode === "edit" && onAutoSave && draftRef.current.title.trim()) {
        void onAutoSave(draftRef.current).finally(() => onClose());
      } else {
        onClose();
      }
    },
    [mode, onAutoSave, onClose],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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
          <div className="grid grid-cols-2 gap-3">
            {field(
              "Status",
              <Select
                value={draft.status}
                onValueChange={(v) => setDraft({ ...draft, status: v as TaskStatus })}
              >
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>,
            )}
            {field(
              "Assignee",
              <Select
                value={draft.assignee}
                onValueChange={(v) =>
                  // Clear the model when the assignee changes — model catalogs
                  // differ per agent, so a stale carry-over is never valid.
                  setDraft({ ...draft, assignee: v as TaskAssignee, model: "" })
                }
              >
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNEES.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>,
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field(
              "Project",
              <Combobox
                value={draft.project}
                onChange={(v) => setDraft({ ...draft, project: v })}
                options={knownProjects}
                allowCustom
                placeholder="repo name or path"
                emptyText="No known projects."
              />,
            )}
            {field(
              "Model (AI launches)",
              <div className="space-y-1">
                <Combobox
                  value={draft.model}
                  onChange={(v) => setDraft({ ...draft, model: v })}
                  options={draft.assignee === "opencode" ? opencodeModels : CLAUDE_MODELS}
                  allowCustom
                  // A "me" (human) task launches no AI agent, so a model is
                  // meaningless — disable the field. Assignee changes already
                  // clear draft.model, so nothing stale lingers here.
                  disabled={draft.assignee === "me"}
                  placeholder={draft.assignee === "me" ? "n/a for me" : "agent default"}
                  emptyText="No models."
                />
                {draft.assignee === "opencode" && opencodeModelsError && (
                  <p className="text-[10px] text-destructive/80">
                    opencode model list unavailable — {opencodeModelsError}
                  </p>
                )}
              </div>,
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {toggle(
              "Confirm mode",
              "Agent drafts a plan and waits for your approval before executing.",
              draft.confirm,
              (v) => setDraft({ ...draft, confirm: v }),
              draft.assignee === "me",
            )}
            {toggle(
              "Git worktree",
              "Agent works in a dedicated worktree so parallel tasks don't collide.",
              draft.worktree,
              (v) => setDraft({ ...draft, worktree: v }),
              draft.assignee === "me",
            )}
          </div>
          <Accordion
            type="single"
            collapsible
            defaultValue={hasOptionalDetails ? "optional" : undefined}
          >
            <AccordionItem value="optional">
              <AccordionTrigger>
                <span className="flex flex-col items-start">
                  <span>Optional details</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {optionalSummary}
                  </span>
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    {field(
                      "Priority",
                      <Select
                        value={draft.priority}
                        onValueChange={(v) =>
                          setDraft({ ...draft, priority: v as TaskPriority })
                        }
                      >
                        <SelectTrigger size="sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PRIORITIES.map((p) => (
                            <SelectItem key={p} value={p}>
                              {p}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>,
                    )}
                    {field(
                      "Due",
                      <DatePicker
                        value={draft.due}
                        onChange={(v) => setDraft({ ...draft, due: v })}
                      />,
                    )}
                    {field(
                      "Tags (comma separated)",
                      <Input
                        value={draft.tags}
                        onChange={(e) =>
                          setDraft({ ...draft, tags: e.target.value })
                        }
                        className="h-8 text-xs"
                        placeholder="feature, bug"
                      />,
                    )}
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
          {field(
            "Description",
            <Textarea
              value={draft.content}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
              rows={6}
              placeholder="Task description — this is the prompt context handed to AI agents."
            />,
          )}
        </div>
        {mode === "create" && (
          <DialogFooter>
            <Button
              disabled={!draft.title.trim()}
              onClick={() => {
                clearCreateDraft();
                onCreate?.(draft);
                onClose();
              }}
            >
              Create
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
