// Task editor window (label `task-editor`): the form that edits or creates one
// task, in a window of its own so it can be parked on a second screen while
// the board stays usable on the first.
//
// The Rust side shows the pre-built window and emits `task-editor://open` with
// the payload (see src-tauri/src/task_editor.rs); every open re-initializes the
// form, which is how clicking a second card switches the window over — the same
// contract as the quick-capture and ink-preview windows.
//
// Writes go straight to the vault from here. Nothing is reported back to the
// board: the vault watcher emits `tasks-changed` when a task file is written
// and the board refreshes itself (tasks.rs::start_watcher). The one thing this
// window cannot do alone is open the embedded terminal an agent runs in — that
// panel belongs to the main window's layout, so a launch asks for it by event.
import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "@/lib/api";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TaskEditorForm, type TaskDraft } from "@/components/task-editor-form";
import {
  launchAgentForTask,
  copyTaskPrompt,
  sendTaskToClaudeDesktop,
} from "@/lib/task-actions";
import { TASK_EDITOR_OPEN_EVENT, type TaskEditorPayload } from "@/lib/task-editor-bridge";
import { buildBody, DEFAULT_BODY, parseBody } from "@/lib/task-body";
import type { Config, Task } from "@/types";

/** Frontmatter fields shared by create and update, read off the draft. */
function fieldsFromDraft(draft: TaskDraft) {
  return {
    title: draft.title,
    status: draft.status,
    assignee: draft.assignee,
    project: draft.project,
    priority: draft.priority,
    model: draft.model.trim(),
    confirm: draft.confirm,
    worktree: draft.worktree,
    blocked: draft.blocked,
    blockedNote: draft.blockedNote,
    blockedSince: draft.blockedSince,
    due: draft.due,
    tags: draft.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
  };
}

export function EditorApp() {
  /** What the window is showing; null while hidden. Clearing it unmounts the
   *  form, so the next open always starts from a fresh one. */
  const [payload, setPayload] = useState<TaskEditorPayload | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unlisten = listen<TaskEditorPayload>(TASK_EDITOR_OPEN_EVENT, (event) => {
      setError(null);
      setPayload(event.payload);
      // Re-read on every open: the settings this window acts on (vault path,
      // agent commands, task language) can have been changed in the main
      // window since it was last shown.
      void api
        .getConfig()
        .then(setConfig)
        .catch((e) => setError(`Could not load settings — ${e}`));
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, []);

  const close = useCallback(() => {
    setPayload(null);
    void api.taskEditorHide();
  }, []);

  const vaultPath = config?.settings.vault_path ?? "";

  const createTask = useCallback(
    async (draft: TaskDraft): Promise<Task | null> => {
      if (!vaultPath) return null;
      try {
        return await api.createTask(vaultPath, {
          ...fieldsFromDraft(draft),
          body: draft.content.trim()
            ? buildBody(parseBody(DEFAULT_BODY), draft.content)
            : undefined,
        });
      } catch (e) {
        setError(`Create failed — ${e}`);
        return null;
      }
    },
    [vaultPath],
  );

  const task = payload?.task ?? null;

  const autoSaveTask = useCallback(
    async (draft: TaskDraft) => {
      if (!vaultPath || !task) return;
      try {
        const parsed = parseBody(task.body);
        const bodyChanged = draft.content !== parsed.content;
        await api.updateTask(vaultPath, {
          id: task.id,
          ...fieldsFromDraft(draft),
          body: bodyChanged ? buildBody(parsed, draft.content) : undefined,
        });
        setError(null);
      } catch (e) {
        setError(`Auto-save failed — ${e}`);
      }
    },
    [vaultPath, task],
  );

  // The agent runs in the main window's terminal panel, so ask for the panel
  // first and bring that window forward afterwards — otherwise the launch
  // happens somewhere the user cannot see from here.
  const launchAgent = useCallback(
    async (t: Task) => {
      if (!config) return;
      if (config.settings.terminal_embed && config.settings.use_herdr) {
        await api.taskEditorRequestTerminalPanel();
      }
      await launchAgentForTask(config, t);
      void api.focusMainWindow();
    },
    [config],
  );

  const copyPrompt = useCallback(
    async (t: Task) => {
      if (!config) return;
      await copyTaskPrompt(config, t);
    },
    [config],
  );

  const sendToClaudeDesktop = useCallback(
    async (t: Task) => {
      if (!config) return;
      await sendTaskToClaudeDesktop(config, t);
    },
    [config],
  );

  return (
    <TooltipProvider>
      {payload && (
        <TaskEditorForm
          mode={payload.mode}
          task={task}
          knownProjects={payload.knownProjects}
          error={error}
          onClose={close}
          onCreate={payload.mode === "create" ? createTask : undefined}
          onAutoSave={payload.mode === "edit" ? autoSaveTask : undefined}
          onLaunchAgent={payload.mode === "edit" ? launchAgent : undefined}
          onCopyTaskPrompt={payload.mode === "edit" ? copyPrompt : undefined}
          onSendToClaudeDesktop={payload.mode === "edit" ? sendToClaudeDesktop : undefined}
          claudeDesktopMode={config?.settings.claude_desktop_mode ?? "code"}
        />
      )}
    </TooltipProvider>
  );
}
