// Draft state and draft→input mapping for the task editor window
// (src/components/task-editor-form.tsx, src/task-editor/editor-app.tsx).
//
// The editor holds a snapshot of the task it opened with and autosaves a
// draft. The board stays usable while that window is open — by design — so
// the task can change underneath it: a board drag moves its status, an agent
// writes its Results, Obsidian edits anything. Writing the whole draft back
// would undo all of that on the next save, so the editor tracks which fields
// the user actually touched and only ever writes those; untouched fields
// follow the vault instead of reverting it. These helpers are pure so that
// contract can be unit-tested.

import type { BacklogItem, Task, TaskAssignee, TaskPriority, TaskStatus } from "@/types";
import type { ComboboxOptionDetails } from "@/lib/combobox-options";
import { parseBody } from "@/lib/task-body";

export interface TaskDraft {
  title: string;
  status: TaskStatus;
  assignee: TaskAssignee;
  project: string;
  /** `B-NNN` of the owning backlog item, or empty for a standalone task. */
  backlog: string;
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

/** One editable field of the editor form. `content` is the Description
 *  section of the body; the other fourteen map 1:1 onto frontmatter. */
export type DraftField = keyof TaskDraft;

export function draftFromTask(task: Task): TaskDraft {
  return {
    title: task.title,
    status: task.status,
    assignee: task.assignee,
    project: task.project,
    backlog: task.backlog,
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

/** Frontmatter fields read off the draft. With `dirty`, only the fields the
 *  user touched are included — `update_task` merges just the present items,
 *  so an untouched field survives whatever changed outside the editor.
 *  `content` never appears here: the body is the caller's business, since it
 *  writes only when the description changed. */
export function fieldsFromDraft(draft: TaskDraft): UpdateTaskInputFields;
export function fieldsFromDraft(
  draft: TaskDraft,
  dirty: ReadonlySet<DraftField>,
): Partial<UpdateTaskInputFields>;
export function fieldsFromDraft(
  draft: TaskDraft,
  dirty?: ReadonlySet<DraftField>,
): UpdateTaskInputFields | Partial<UpdateTaskInputFields> {
  const all = {
    title: draft.title,
    status: draft.status,
    assignee: draft.assignee,
    project: draft.project,
    backlog: draft.backlog,
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
  if (!dirty) return all;
  const picked: Partial<typeof all> = {};
  for (const field of dirty) {
    if (field === "content") continue;
    // TypeScript cannot type a union-keyed write property by property; the
    // guard above already removed the only key `all` does not have.
    (picked as Record<string, unknown>)[field] = all[field];
  }
  return picked;
}

/** The update-input shape `fieldsFromDraft` builds (every key of TaskDraft
 *  except `content`, with the same names `UpdateTaskInput` uses). */
type UpdateTaskInputFields = {
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
  tags: string[];
};

/** Folds a fresher snapshot of the same task into the draft: dirty fields
 *  (the user's in-progress edits) are kept, everything else follows the
 *  vault. Returns null when nothing would change, so the caller can skip the
 *  state update. */
export function mergeExternalTask(
  prev: TaskDraft,
  fresh: TaskDraft,
  dirty: ReadonlySet<DraftField>,
): TaskDraft | null {
  let changed = false;
  const next = { ...prev };
  for (const key of Object.keys(prev) as DraftField[]) {
    if (dirty.has(key)) continue;
    if (next[key] !== fresh[key]) {
      // Union-keyed write — same TS limitation as in fieldsFromDraft.
      (next as Record<DraftField, unknown>)[key] = fresh[key];
      changed = true;
    }
  }
  return changed ? next : null;
}

/** Decoration for the editor's backlog-item picker: the item's title beside
 * its `B-NNN`, and its status after that. Items whose entry note says nothing
 * about status contribute no meta rather than an empty separator.
 *
 * The picker still commits the bare id — this only decides what is drawn and
 * what the search matches, so an item can be found by its title. */
export function backlogOptionDetails(
  items: readonly BacklogItem[],
): ComboboxOptionDetails {
  const details: ComboboxOptionDetails = {};
  for (const item of items) {
    const label = item.title.trim();
    const meta = item.status.trim();
    if (!label && !meta) continue;
    details[item.id] = {
      ...(label ? { label } : {}),
      ...(meta ? { meta } : {}),
    };
  }
  return details;
}
