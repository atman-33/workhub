// The three "hand this task to an agent" actions, as plain functions over a
// `Config`.
//
// They live here rather than in the board because two windows need them: the
// board's cards run them directly, and so does the task editor window, which
// has its own React root and no access to the board's callbacks. Each returns
// the backend's own message (or nothing) and lets errors propagate, so each
// caller can report them the way its window does — the board in its status
// bar, the editor inline.

import { api } from "@/lib/api";
import { parseBody } from "@/lib/task-body";
import type { Config, Task } from "@/types";

/** Launches the configured agent CLI on `task`. Returns the backend's status
 *  message. The caller is responsible for making the terminal panel visible
 *  first when running embedded — see `TASK_EDITOR_TERMINAL_PANEL_EVENT`. */
export function launchAgentForTask(config: Config, task: Task): Promise<string> {
  const agentCmd =
    task.assignee === "opencode" ? config.settings.opencode_cmd : config.settings.agent_cmd;
  return api.launchAgentForTask(
    agentCmd,
    task.assignee,
    task.id,
    task.title,
    task.file,
    task.project,
    task.model,
    task.confirm,
    task.worktree,
    config.settings.vault_path ?? "",
    config.settings.use_herdr,
    config.settings.herdr_cmd,
    config.settings.terminal_embed,
    config.settings.task_language,
    config.settings.custom_prompt,
  );
}

/** Copies the agent prompt for `task` to the clipboard. */
export function copyTaskPrompt(config: Config, task: Task): Promise<void> {
  return api.copyTaskPrompt(
    task.assignee,
    task.id,
    task.title,
    task.file,
    task.project,
    task.model,
    task.confirm,
    task.worktree,
    config.settings.vault_path ?? "",
    config.settings.task_language,
    config.settings.custom_prompt,
  );
}

/** Starts a Claude Desktop session on `task`. Returns the backend's status
 *  message. */
export function sendTaskToClaudeDesktop(config: Config, task: Task): Promise<string> {
  return api.sendTaskToClaudeDesktop(
    task.assignee,
    task.id,
    task.title,
    task.file,
    task.project,
    task.model,
    task.confirm,
    task.worktree,
    config.settings.vault_path ?? "",
    config.settings.task_language,
    config.settings.custom_prompt,
    config.settings.claude_desktop_mode,
    // Only chat mode uses the Description; parsing it here keeps the command
    // free of the task body's Plan/Results sections.
    parseBody(task.body).content,
  );
}
