/**
 * Display labels for task frontmatter values (T-0409). The values themselves
 * stay English on disk; only what the UI shows for them is translated.
 */
import type { Color, ItemKind } from "@/lib/schedule/parse";
import type { Color as MindmapColor } from "@/lib/mindmap/parse";
import type { TaskAssignee, TaskPriority, TaskStatus } from "@/types";
import type { MessageKey } from "./messages/en";

/** Display labels for a schedule element's `<kind>` (T-0423). The value
 * written to the note stays `bar`/`arrow`/`milestone`/`note`. */
export const SCHEDULE_KIND_LABEL_KEY: Record<ItemKind, MessageKey> = {
  bar: "schedule.kind.bar",
  arrow: "schedule.kind.arrow",
  milestone: "schedule.kind.milestone",
  note: "schedule.kind.note",
};

/** Display labels for a schedule element's color. The value written to the
 * note stays the English color name (T-0423). */
export const SCHEDULE_COLOR_LABEL_KEY: Record<Color, MessageKey> = {
  blue: "schedule.color.blue",
  green: "schedule.color.green",
  amber: "schedule.color.amber",
  red: "schedule.color.red",
  purple: "schedule.color.purple",
  gray: "schedule.color.gray",
};

/** Display labels for a mindmap node/sticky's color. The value written to the
 * note stays the English color name (T-0423). Same vocabulary as the
 * schedule's colors, so the labels are shared. */
export const MINDMAP_COLOR_LABEL_KEY: Record<MindmapColor, MessageKey> = {
  blue: "schedule.color.blue",
  green: "schedule.color.green",
  amber: "schedule.color.amber",
  red: "schedule.color.red",
  purple: "schedule.color.purple",
  gray: "schedule.color.gray",
};

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

export const TASK_PRIORITY_LABEL_KEY: Record<TaskPriority, MessageKey> = {
  low: "task.priority.low",
  medium: "task.priority.medium",
  high: "task.priority.high",
};

/** Display labels for a backlog item's `status` (T-0423). The value written
 * to the entry note stays English (`idea`/`ready`/`doing`/`done`/`dropped`);
 * an item whose entry note says nothing about status carries an empty string,
 * which has no entry here and is left as-is by whatever reads this map. */
export const BACKLOG_STATUS_LABEL_KEY: Record<string, MessageKey> = {
  idea: "misc.backlogStatus.idea",
  ready: "misc.backlogStatus.ready",
  doing: "misc.backlogStatus.doing",
  done: "misc.backlogStatus.done",
  dropped: "misc.backlogStatus.dropped",
};
