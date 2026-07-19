import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { FileText, Gem, Maximize2, Minimize2 } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Markdown } from "@/components/ui/markdown";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { ModelCombobox } from "@/components/model-combobox";
import { Switch } from "@/components/ui/switch";
import { DatePicker } from "@/components/ui/date-picker";
import { Textarea } from "@/components/ui/textarea";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { CopyPromptButton } from "@/components/copy-prompt-button";
import { LaunchAgentButton } from "@/components/launch-agent-button";
import { OpenInObsidianButton } from "@/components/open-in-obsidian-button";
import { PriorityBadge } from "@/components/priority-badge";
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

interface Props {
  open: boolean;
  mode: "create" | "edit";
  task: Task | null;
  knownProjects: string[];
  onClose: () => void;
  /** Called once when the user confirms creation of a new task. Returns the
   *  created task (null on failure) so follow-up actions can target its file. */
  onCreate?: (draft: TaskDraft) => Promise<Task | null>;
  /** Called while editing an existing task, both on idle and on close. */
  onAutoSave?: (draft: TaskDraft) => Promise<void>;
  /** Launches an agent for the edited task; flushed edits are read from disk. */
  onLaunchAgent?: (task: Task) => Promise<unknown>;
  /** Copies the agent prompt for the edited task to the clipboard. */
  onCopyTaskPrompt?: (task: Task) => Promise<unknown>;
}

export function TaskDialog({
  open,
  mode,
  task,
  knownProjects,
  onClose,
  onCreate,
  onAutoSave,
  onLaunchAgent,
  onCopyTaskPrompt,
}: Props) {
  const [draft, setDraft] = useState<TaskDraft>(EMPTY_DRAFT);
  // Keep the rendered mode stable while the dialog is closing so the footer
  // (e.g. the Create button) does not flash during the exit animation.
  const [displayMode, setDisplayMode] = useState<"create" | "edit">(mode);
  useEffect(() => {
    if (open) {
      setDisplayMode(mode);
    }
  }, [open, mode]);

  // Description shows a rendered markdown preview (URLs clickable) until the
  // user clicks into it to edit — an Obsidian-like reading/editing toggle.
  const [descEditing, setDescEditing] = useState(false);
  // Results are read-only; they open in a slide-over sheet from the header.
  const [resultsOpen, setResultsOpen] = useState(false);
  // Near-fullscreen mode for long descriptions; the description field absorbs
  // the extra space.
  const [maximized, setMaximized] = useState(false);
  // Error from the "open in Obsidian" flows (e.g. Obsidian not installed);
  // shown inline so the dialog can stay open for the user to read it.
  const [obsidianError, setObsidianError] = useState<string | null>(null);
  // Guards the create buttons against double-submits while creation runs.
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    if (open) {
      setDescEditing(false);
      setResultsOpen(false);
      setMaximized(false);
      setObsidianError(null);
      setCreating(false);
      skipAutoSaveOnCloseRef.current = false;
    }
  }, [open]);

  const resultRaw = task ? parseBody(task.body).resultRaw : "";
  // resultRaw always starts with the "## Results" header; treat "header only"
  // (nothing after it) as empty so the sheet can show a placeholder instead.
  const hasResults = resultRaw.replace(/^##\s*Results\s*/i, "").trim().length > 0;

  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  // After a successful agent launch we close the dialog so the user does not
  // later dismiss it and flush a stale draft (e.g. the old status) back to disk,
  // overwriting the agent's own edits. This ref suppresses the autosave-on-close
  // path in that specific case.
  const skipAutoSaveOnCloseRef = useRef(false);

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

  const field = (label: string, node: ReactNode, className?: string) => (
    <div className={cn("space-y-1.5", className)}>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {node}
    </div>
  );

  const handleModelChange = useCallback((nextModel: string) => {
    setDraft((prev) => ({ ...prev, model: nextModel }));
  }, []);

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

  const hasOptionalDetails = Boolean(draft.due || draft.tags.trim());
  const optionalSummary = [
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
      if (mode === "edit" && onAutoSave && draftRef.current.title.trim() && !skipAutoSaveOnCloseRef.current) {
        void onAutoSave(draftRef.current).finally(() => onClose());
      } else {
        onClose();
      }
    },
    [mode, onAutoSave, onClose],
  );

  // Launch from the editor: flush the debounced autosave first so the agent
  // reads current content, pass the draft's launch fields so a not-yet-
  // refreshed `task` prop can't leak stale title/model/flags into the launch,
  // and close the dialog so a later dismiss cannot overwrite the agent's edits.
  const handleLaunch = useCallback(async () => {
    if (!task || !onLaunchAgent) return;
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    const d = draftRef.current;
    if (onAutoSave && d.title.trim()) {
      await onAutoSave(d);
    }
    await onLaunchAgent({
      ...task,
      title: d.title,
      assignee: d.assignee,
      project: d.project,
      model: d.model,
      confirm: d.confirm,
      worktree: d.worktree,
    });
    skipAutoSaveOnCloseRef.current = true;
    onClose();
  }, [task, onAutoSave, onLaunchAgent, onClose]);

  // Copy the prompt from the editor using the draft's current launch fields.
  const handleCopyPrompt = useCallback(async () => {
    if (!task || !onCopyTaskPrompt) return;
    const d = draftRef.current;
    await onCopyTaskPrompt({
      ...task,
      title: d.title,
      assignee: d.assignee,
      project: d.project,
      model: d.model,
      confirm: d.confirm,
      worktree: d.worktree,
    });
  }, [task, onCopyTaskPrompt]);

  // Edit mode: jump to the task file in Obsidian. Mirrors handleLaunch —
  // flush the debounced autosave first so Obsidian shows current content,
  // then close without the autosave-on-close so a later dismiss cannot
  // overwrite edits made in Obsidian with a stale draft.
  const handleOpenInObsidian = useCallback(async () => {
    if (!task) return;
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    const d = draftRef.current;
    if (onAutoSave && d.title.trim()) {
      await onAutoSave(d);
    }
    try {
      await api.openInObsidian(task.file);
    } catch (e) {
      setObsidianError(String(e));
      return;
    }
    skipAutoSaveOnCloseRef.current = true;
    onClose();
  }, [task, onAutoSave, onClose]);

  // Create mode: create the task first (the file must exist before Obsidian
  // can open it), then jump to the new file. On create failure the tasks view
  // already surfaces the error in its status bar, so just close.
  const handleCreateAndOpen = useCallback(async () => {
    if (!onCreate) return;
    setCreating(true);
    try {
      clearCreateDraft();
      const created = await onCreate(draftRef.current);
      if (created) {
        try {
          await api.openInObsidian(created.file);
        } catch (e) {
          // Task exists at this point — keep the dialog open so the user
          // sees why the jump failed instead of silently closing.
          setObsidianError(String(e));
          return;
        }
      }
      onClose();
    } finally {
      setCreating(false);
    }
  }, [onCreate, onClose]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {/* Flex column (overrides the default grid) so the form area can shrink
          and scroll instead of growing the dialog past the viewport. */}
      <DialogContent
        className={cn(
          "flex max-h-[calc(100vh-3rem)] flex-col",
          maximized
            ? "h-[calc(100vh-3rem)] sm:max-w-[calc(100vw-3rem)]"
            : "sm:max-w-lg",
        )}
      >
        <DialogHeader>
          <div className="flex items-center justify-between gap-2 pr-6">
            <DialogTitle>
              {displayMode === "create" ? "New task" : `${task?.id} — Edit task`}
            </DialogTitle>
            <div className="flex items-center gap-2">
              {displayMode === "edit" && (
                <>
                  {task &&
                    (draft.assignee === "claude-code" || draft.assignee === "opencode") && (
                      <>
                        {onCopyTaskPrompt && (
                          <CopyPromptButton size="icon-sm" onCopy={handleCopyPrompt} />
                        )}
                        {onLaunchAgent && (
                          <LaunchAgentButton size="icon-sm" onLaunch={handleLaunch} />
                        )}
                      </>
                    )}
                  <OpenInObsidianButton size="icon-sm" onOpen={handleOpenInObsidian} />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    onClick={() => setResultsOpen(true)}
                  >
                    <FileText className="size-3.5" /> Results
                  </Button>
                </>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={maximized ? "Exit full screen" : "Full screen"}
                title={maximized ? "Exit full screen" : "Full screen"}
                onClick={() => setMaximized((m) => !m)}
              >
                {maximized ? (
                  <Minimize2 className="size-3.5" />
                ) : (
                  <Maximize2 className="size-3.5" />
                )}
              </Button>
            </div>
          </div>
        </DialogHeader>
        {/* min-w-0 keeps wide content (e.g. code blocks) from stretching the
            dialog; the pre's own overflow-x handles horizontal scrolling. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto">
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
          <div className="grid grid-cols-[1fr_1fr_auto] gap-3">
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
            {field(
              "Priority",
              // Click cycles low → medium → high → low; no more dropdown.
              <div className="flex h-8 items-center">
                <PriorityBadge
                  priority={draft.priority}
                  onCycle={(next) => setDraft({ ...draft, priority: next })}
                />
              </div>,
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
                // Lives inside a modal Radix Dialog; without `modal` the
                // dialog's scroll/pointer guard eats wheel scrolls on the
                // portaled popover (same bug fixed for BranchCombobox in
                // ce4ea2c).
                modal
                placeholder="repo name or path"
                emptyText="No known projects."
              />,
            )}
            {field(
              "Model (AI launches)",
              <ModelCombobox
                assignee={draft.assignee}
                value={draft.model}
                onChange={handleModelChange}
                // Gates the opencode catalog fetch: a closed dialog pays for
                // no CLI spawn.
                active={open}
                // Lives inside a modal Radix Dialog; without `modal` the
                // dialog's scroll/pointer guard eats wheel scrolls on the
                // portaled popover (same bug fixed for BranchCombobox in
                // ce4ea2c).
                modal
                // A "me" (human) task launches no AI agent, so a model is
                // meaningless — disable the field. Assignee changes already
                // clear draft.model, so nothing stale lingers here.
                disabled={draft.assignee === "me"}
                placeholder={draft.assignee === "me" ? "n/a for me" : "agent default"}
              />,
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
                  <div className="grid grid-cols-2 gap-3">
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
            descEditing ? (
              <Textarea
                autoFocus
                value={draft.content}
                onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                onBlur={() => setDescEditing(false)}
                rows={6}
                // Maximized: fill the freed space with a fixed-size scrolling
                // editor instead of the default grow-with-content sizing.
                className={
                  maximized ? "min-h-0 flex-1 field-sizing-fixed resize-none" : undefined
                }
                placeholder="Task description — this is the prompt context handed to AI agents."
              />
            ) : (
              <div
                role="button"
                tabIndex={0}
                onClick={() => setDescEditing(true)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setDescEditing(true);
                  }
                }}
                className={cn(
                  "min-h-[8.5rem] max-h-[12rem] min-w-0 cursor-text overflow-y-auto rounded-md border border-input bg-transparent px-3 py-2 text-sm hover:border-ring/50",
                  maximized && "max-h-none flex-1",
                )}
                title="Click to edit"
              >
                {draft.content.trim() ? (
                  <Markdown>{draft.content}</Markdown>
                ) : (
                  <span className="text-muted-foreground">
                    Task description — this is the prompt context handed to AI agents.
                  </span>
                )}
              </div>
            ),
            maximized ? "flex min-h-0 flex-1 flex-col" : undefined,
          )}
        </div>
        {obsidianError && (
          <p className="text-[10px] text-destructive/80">
            Could not open Obsidian — {obsidianError}
          </p>
        )}
        {displayMode === "create" && (
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={!draft.title.trim() || creating}
              onClick={() => void handleCreateAndOpen()}
            >
              <Gem className="size-3.5" /> Create & edit in Obsidian
            </Button>
            <Button
              disabled={!draft.title.trim() || creating}
              onClick={() => {
                clearCreateDraft();
                void onCreate?.(draft);
                onClose();
              }}
            >
              Create
            </Button>
          </DialogFooter>
        )}
      </DialogContent>

      {/* Read-only Results preview. Rendered markdown with copyable code blocks;
          the app never writes this section (see task-body.ts). */}
      <Sheet open={resultsOpen} onOpenChange={setResultsOpen}>
        <SheetContent side="right" className="w-[90vw] gap-0 sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>{task?.id ? `${task.id} — Results` : "Results"}</SheetTitle>
            <SheetDescription className="sr-only">
              Rendered results for this task.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
            {hasResults ? (
              <Markdown>{resultRaw}</Markdown>
            ) : (
              <p className="mt-8 text-center text-sm text-muted-foreground">
                No results recorded yet.
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </Dialog>
  );
}
