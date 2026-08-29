import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Gem, Maximize2, Minimize2 } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FloatingPanel } from "@/components/ui/floating-panel";
import { Hint } from "@/components/ui/hint";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { ClaudeDesktopButton } from "@/components/claude-desktop-button";
import { CopyPromptButton } from "@/components/copy-prompt-button";
import { LaunchAgentButton } from "@/components/launch-agent-button";
import { OpenInObsidianButton } from "@/components/open-in-obsidian-button";
import { PriorityBadge } from "@/components/priority-badge";
import { todayString } from "@/lib/task-blocked";
import { buildBody, parseBody } from "@/lib/task-body";
import type { Task, TaskAssignee, TaskPriority, TaskStatus } from "@/types";

/** The three views the shared pane switches between. */
type PaneTab = "description" | "plan" | "results";

export interface TaskDraft {
  title: string;
  status: TaskStatus;
  assignee: TaskAssignee;
  project: string;
  priority: TaskPriority;
  model: string;
  confirm: boolean;
  worktree: boolean;
  blocked: boolean;
  blockedNote: string;
  blockedSince: string;
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
  blocked: false,
  blockedNote: "",
  blockedSince: "",
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
    blocked: task.blocked,
    blockedNote: task.blocked_note,
    blockedSince: task.blocked_since,
    due: task.due,
    tags: task.tags.join(", "),
    content: parseBody(task.body).content,
  };
}

const STATUSES: TaskStatus[] = ["inbox", "todo", "doing", "review", "done"];
const ASSIGNEES: TaskAssignee[] = ["me", "claude-code", "opencode"];

const CREATE_DRAFT_KEY = "workhub:task-draft:create";
// Last position/size of the floating editor, restored on the next open.
const RECT_STORAGE_KEY = "workhub:task-dialog:rect";

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
  onSendToClaudeDesktop?: (task: Task) => Promise<unknown>;
  /** `claude_desktop_mode` setting, shown in the send button's tooltip. */
  claudeDesktopMode?: string;
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
  onSendToClaudeDesktop,
  claudeDesktopMode,
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
  // Which of Description / Plan / Results the shared pane is showing. Only
  // Description is editable — Plan is the approval record and Results are the
  // agent's report, both written in Obsidian and only ever displayed here.
  const [pane, setPane] = useState<PaneTab>("description");
  // Near-fullscreen mode for long descriptions; the description field absorbs
  // the extra space.
  const [maximized, setMaximized] = useState(false);
  // Error from the "open in Obsidian" flows (e.g. Obsidian not installed);
  // shown inline so the dialog can stay open for the user to read it.
  const [obsidianError, setObsidianError] = useState<string | null>(null);
  // Guards the create buttons against double-submits while creation runs.
  const [creating, setCreating] = useState(false);
  // Id of the task the draft was loaded from. The panel is non-modal, so while
  // it is open another task can be clicked behind it; the prop `task` then
  // points somewhere else and the form must be re-seeded — otherwise the next
  // autosave would write the old task's fields onto the new task's file.
  const draftTaskIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (open) {
      if (mode === "edit" && task) {
        if (draftTaskIdRef.current === task.id) return;
        draftTaskIdRef.current = task.id;
        setDraft(draftFromTask(task));
      } else {
        draftTaskIdRef.current = null;
        setDraft(loadCreateDraft() ?? EMPTY_DRAFT);
      }
      setDescEditing(false);
      setPane("description");
      setMaximized(false);
      setObsidianError(null);
      setCreating(false);
      skipAutoSaveOnCloseRef.current = false;
    } else {
      draftTaskIdRef.current = null;
    }
  }, [open, mode, task]);

  // `resultRaw` always starts with the "## Results" header. The tab is already
  // labelled Results, so the header is dropped rather than repeated — and what
  // is left doubles as the emptiness test.
  const results = task
    ? parseBody(task.body).resultRaw.replace(/^##\s*Results\s*/i, "").trim()
    : "";
  const hasResults = results.length > 0;
  // Plan is already trimmed by parseBody, so a simple non-empty check suffices.
  const plan = task ? parseBody(task.body).plan : "";
  const hasPlan = plan.length > 0;

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

  // Shared shell for the long-form pane: in full screen it absorbs the freed
  // height instead of the dialog growing a second scrollbar.
  const paneShellClass = maximized ? "flex min-h-0 flex-1 flex-col" : undefined;
  // Read-only rendering of Plan / Results. Same box as the description
  // preview, so switching tabs does not resize the dialog.
  const readerClass = cn(
    "min-h-[8.5rem] max-h-[12rem] min-w-0 overflow-y-auto rounded-md border border-input bg-transparent px-3 py-2 text-sm",
    maximized && "max-h-none flex-1",
  );

  // Reading/editing toggle, Obsidian-style: rendered markdown until clicked.
  const descriptionPane = descEditing ? (
    <Textarea
      autoFocus
      value={draft.content}
      onChange={(e) => setDraft({ ...draft, content: e.target.value })}
      onBlur={() => setDescEditing(false)}
      rows={6}
      // Maximized: fill the freed space with a fixed-size scrolling editor
      // instead of the default grow-with-content sizing.
      className={maximized ? "min-h-0 flex-1 field-sizing-fixed resize-none" : undefined}
      placeholder="Task description — this is the prompt context handed to AI agents."
    />
  ) : (
    <Hint label="Click to edit">
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
          "cursor-text hover:border-ring/50",
          readerClass,
        )}
      >
        {draft.content.trim() ? (
          <Markdown>{draft.content}</Markdown>
        ) : (
          <span className="text-muted-foreground">
            Task description — this is the prompt context handed to AI agents.
          </span>
        )}
      </div>
    </Hint>
  );

  // What "Optional details" holds, and therefore when it opens by itself.
  // The launch toggles and the blocked flag live in here because they are
  // rarely touched — the first two do nothing at all for a task assigned to
  // "me", and blocking is normally set from the board, which has its own
  // dialog for it. Anything already set still opens the section on sight, so
  // a blocked task never hides why it is blocked behind a click.
  const hasOptionalDetails = Boolean(
    draft.due || draft.tags.trim() || draft.confirm || draft.worktree || draft.blocked,
  );
  const optionalSummary = [
    draft.due ? `Due: ${draft.due}` : "",
    draft.tags.trim() ? `Tags: ${draft.tags.trim()}` : "",
    draft.confirm ? "Confirm" : "",
    draft.worktree ? "Worktree" : "",
    draft.blocked ? `Blocked${draft.blockedNote ? `: ${draft.blockedNote}` : ""}` : "",
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
  // Mirrors handleLaunch: the copied prompt is about to be run by an agent that
  // will edit the task file itself, so flush the debounced autosave first and
  // then close without the autosave-on-close — a dialog left open would
  // otherwise overwrite the agent's status change with a stale draft. The short
  // delay lets the button's "Copied" feedback show before the dialog goes away.
  const handleCopyPrompt = useCallback(async () => {
    if (!task || !onCopyTaskPrompt) return;
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    const d = draftRef.current;
    if (onAutoSave && d.title.trim()) {
      await onAutoSave(d);
    }
    await onCopyTaskPrompt({
      ...task,
      title: d.title,
      assignee: d.assignee,
      project: d.project,
      model: d.model,
      confirm: d.confirm,
      worktree: d.worktree,
    });
    skipAutoSaveOnCloseRef.current = true;
    setTimeout(() => onClose(), 700);
  }, [task, onAutoSave, onCopyTaskPrompt, onClose]);

  // Send the prompt to a new Claude Desktop session. Same flush-then-close
  // dance as handleCopyPrompt (the session may edit the task file), plus the
  // draft's Description is folded into the body: chat mode sends the
  // Description, and it should be the text the user is looking at.
  const handleSendToClaudeDesktop = useCallback(async () => {
    if (!task || !onSendToClaudeDesktop) return;
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    const d = draftRef.current;
    if (onAutoSave && d.title.trim()) {
      await onAutoSave(d);
    }
    await onSendToClaudeDesktop({
      ...task,
      title: d.title,
      assignee: d.assignee,
      project: d.project,
      model: d.model,
      confirm: d.confirm,
      worktree: d.worktree,
      body: buildBody(parseBody(task.body), d.content),
    });
    skipAutoSaveOnCloseRef.current = true;
    setTimeout(() => onClose(), 700);
  }, [task, onAutoSave, onSendToClaudeDesktop, onClose]);

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

  const footer =
    obsidianError || displayMode === "create" ? (
      <>
        {obsidianError && (
          <p className="pb-2 text-[10px] text-destructive/80">
            Could not open Obsidian — {obsidianError}
          </p>
        )}
        {displayMode === "create" && (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
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
          </div>
        )}
      </>
    ) : undefined;

  return (
    <FloatingPanel
      open={open}
      onClose={() => handleOpenChange(false)}
      storageKey={RECT_STORAGE_KEY}
      title={displayMode === "create" ? "New task" : `${task?.id} — Edit task`}
      maximized={maximized}
      defaultWidth={640}
      defaultHeight={680}
      minWidth={380}
      minHeight={320}
      footer={footer}
      actions={
        <>
          {displayMode === "edit" && (
            <>
              {task &&
                (draft.assignee === "claude-code" || draft.assignee === "opencode") && (
                  <>
                    {onCopyTaskPrompt && (
                      <CopyPromptButton size="icon-sm" onCopy={handleCopyPrompt} />
                    )}
                    {onSendToClaudeDesktop && (
                      <ClaudeDesktopButton
                        size="icon-sm"
                        mode={claudeDesktopMode === "chat" ? "chat" : "code session"}
                        onSend={handleSendToClaudeDesktop}
                      />
                    )}
                    {onLaunchAgent && (
                      <LaunchAgentButton size="icon-sm" onLaunch={handleLaunch} />
                    )}
                  </>
                )}
              <OpenInObsidianButton size="icon-sm" onOpen={handleOpenInObsidian} />
            </>
          )}
          <Hint label={maximized ? "Exit full screen" : "Full screen"}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={maximized ? "Exit full screen" : "Full screen"}
              onClick={() => setMaximized((m) => !m)}
            >
              {maximized ? (
                <Minimize2 className="size-3.5" />
              ) : (
                <Maximize2 className="size-3.5" />
              )}
            </Button>
          </Hint>
        </>
      }
    >
      {/* min-w-0 keeps wide content (e.g. code blocks) from stretching the
          dialog; the pre's own overflow-x handles horizontal scrolling. */}
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
              <div className="space-y-3">
                {toggle(
                  "Blocked",
                  "Waiting on someone else. The task keeps its status; the board shows how long it has been waiting.",
                  draft.blocked,
                  (v) =>
                    // Turning it on stamps today so the wait is measured from the
                    // moment it was noticed; turning it off clears the details so
                    // no stale note survives into the next block.
                    setDraft(
                      v
                        ? {
                            ...draft,
                            blocked: true,
                            blockedSince: draft.blockedSince || todayString(),
                          }
                        : { ...draft, blocked: false, blockedNote: "", blockedSince: "" },
                    ),
                  false,
                )}
                {draft.blocked && (
                  <div className="grid grid-cols-2 gap-3">
                    {field(
                      "Waiting on",
                      <Input
                        value={draft.blockedNote}
                        onChange={(e) => setDraft({ ...draft, blockedNote: e.target.value })}
                        className="h-8 text-xs"
                        placeholder="e.g. vendor quote, review from Sato"
                      />,
                    )}
                    {field(
                      "Blocked since",
                      <DatePicker
                        value={draft.blockedSince}
                        onChange={(v) => setDraft({ ...draft, blockedSince: v })}
                      />,
                    )}
                  </div>
                )}
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
      {/* Description, Plan and Results share one pane. They are the three
          long-form sections of the same file and are read one after the
          other, so giving each its own slide-over meant losing sight of
          the task while reading about it. Only Description is editable:
          Plan is the approval record and Results the agent's report, both
          written outside the app (see task-body.ts).

          Create mode has no file yet, so it shows the description alone
          rather than two permanently empty tabs. */}
      {displayMode === "create"
        ? field("Description", descriptionPane, paneShellClass)
        : (
          <Tabs
            value={pane}
            onValueChange={(v) => setPane(v as PaneTab)}
            className={cn("gap-1.5", paneShellClass)}
          >
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="description">Description</TabsTrigger>
              {/* Disabled rather than hidden when empty: the tabs are also
                  how the user learns these sections exist at all. */}
              <TabsTrigger value="plan" disabled={!hasPlan}>
                {hasPlan ? "Plan" : "Plan (none)"}
              </TabsTrigger>
              <TabsTrigger value="results" disabled={!hasResults}>
                {hasResults ? "Results" : "Results (none)"}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="description" className={paneShellClass}>
              {descriptionPane}
            </TabsContent>
            <TabsContent value="plan" className={readerClass}>
              <Markdown>{plan}</Markdown>
            </TabsContent>
            <TabsContent value="results" className={readerClass}>
              <Markdown>{results}</Markdown>
            </TabsContent>
          </Tabs>
        )}
    </FloatingPanel>
  );
}
