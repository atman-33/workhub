export interface Project {
  path: string;
  name: string;
  tags: string;
  favorite: boolean;
  notes: string;
  last_opened: number | null;
}

export interface Preset {
  name: string;
  paths: string[];
}

export interface Settings {
  vscode_cmd: string;
  terminal_cmd: string;
  agent_cmd: string;
  opencode_cmd: string;
  use_herdr: boolean;
  herdr_cmd: string;
  check_updates: boolean;
  /** Screen-annotation overlay (double-press-and-hold Alt to draw). */
  ink_enabled: boolean;
  vault_path: string | null;
  /** Root dir for task worktrees, laid out as `<root>/<task-id>/<repo-name>`. */
  worktree_root: string;
}

export interface Worktree {
  path: string;
  repo_path: string;
  repo_name: string;
  branch: string;
  head: string;
  /** True for the repo's primary working tree (not a task worktree). */
  is_main: boolean;
  bare: boolean;
  locked: boolean;
  detached: boolean;
  /** Has uncommitted or untracked changes. */
  dirty: boolean;
  /** Task id parsed from a `task/<id>` branch, if any. */
  task_id: string | null;
}

export type SortMode = "Name" | "Recent";

export interface Config {
  version: number;
  projects: Project[];
  presets: Preset[];
  selected: string[];
  settings: Settings;
  sort: SortMode;
}

export interface GitInfo {
  is_repo: boolean;
  branch: string;
  detached: boolean;
  has_upstream: boolean;
  ahead: number;
  behind: number;
  changes: number;
  branches: string[];
  error: string | null;
}

export interface UpdateInfo {
  tag: string;
  url: string;
}

export interface BranchList {
  local: string[];
  remote: string[];
  current: string;
}

export interface CommitRef {
  name: string;
  kind: "branch" | "remote" | "tag" | "head";
  is_head: boolean;
}

export interface CommitEntry {
  hash: string;
  parents: string[];
  author: string;
  date: number;
  refs: CommitRef[];
  subject: string;
}

export interface CommitFileChange {
  path: string;
  /** Original path for renames/copies. */
  old_path: string | null;
  /** Single-letter status: "A" | "M" | "D" | "R" | "C" | "T" | "U" (untracked). */
  status: string;
  /** Added/removed line counts; null for binary files. */
  additions: number | null;
  deletions: number | null;
}

export interface GitLog {
  commits: CommitEntry[];
  head: string;
  current_branch: string;
  uncommitted: number;
  has_more: boolean;
}

export type TaskStatus = "inbox" | "todo" | "doing" | "review" | "done";
export type TaskAssignee = "me" | "claude-code" | "opencode";
export type TaskPriority = "low" | "medium" | "high";

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  assignee: TaskAssignee;
  project: string;
  priority: TaskPriority;
  /** AI model passed as `--model` on task launches; empty = agent default. */
  model: string;
  /** Manual sort position within a status column; null when never reordered. */
  order: number | null;
  due: string;
  tags: string[];
  /** Hidden from the board by default; toggled via the task context menu. */
  archived: boolean;
  /** Confirm/plan-first mode: a launched agent drafts a plan and waits for
   * approval before executing, instead of running autonomously. */
  confirm: boolean;
  /** git worktree mode: a launched agent works in a dedicated worktree so
   * parallel tasks on the same repo don't collide. */
  worktree: boolean;
  created: string;
  updated: string;
  file: string;
  body: string;
}

export interface CreateTaskInput {
  title: string;
  status?: TaskStatus;
  assignee?: TaskAssignee;
  project?: string;
  priority?: TaskPriority;
  model?: string;
  confirm?: boolean;
  worktree?: boolean;
  due?: string;
  tags?: string[];
  body?: string;
}

export interface UpdateTaskInput {
  id: string;
  title?: string;
  status?: TaskStatus;
  assignee?: TaskAssignee;
  project?: string;
  priority?: TaskPriority;
  model?: string;
  order?: number;
  due?: string;
  tags?: string[];
  archived?: boolean;
  confirm?: boolean;
  worktree?: boolean;
  body?: string;
}

export type GraphOp =
  | { kind: "checkout"; branch: string }
  | { kind: "checkout_commit"; hash: string }
  | { kind: "discard_changes"; include_untracked: boolean }
  | { kind: "create_branch"; name: string; hash: string; checkout: boolean }
  | { kind: "delete_branch"; name: string; force: boolean }
  | { kind: "merge"; branch: string }
  | { kind: "rebase"; branch: string }
  | { kind: "push" }
  | { kind: "pull" }
  | { kind: "fetch" }
  | { kind: "reset"; hash: string; mode: "soft" | "mixed" | "hard" }
  | { kind: "cherry_pick"; hash: string }
  | { kind: "create_tag"; name: string; hash: string }
  | { kind: "delete_tag"; name: string };
