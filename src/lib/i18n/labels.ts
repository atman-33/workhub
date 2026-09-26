/**
 * Display labels for task frontmatter values (T-0409). The values themselves
 * stay English on disk; only what the UI shows for them is translated.
 */
import type { TaskAssignee, TaskStatus } from "@/types";
import type { MessageKey } from "./messages/en";

export const TASK_STATUS_LABEL_KEY: Record<TaskStatus, MessageKey> = {
  inbox: "task.status.inbox",
  todo: "task.status.todo",
  doing: "task.status.doing",
  review: "task.status.review",
  done: "task.status.done",
};

export const TASK_ASSIGNEE_LABEL_KEY: Record<TaskAssignee, MessageKey> = {
  me: "task.assignee.me",
  "claude-code": "task.assignee.claudeCode",
  opencode: "task.assignee.opencode",
};
