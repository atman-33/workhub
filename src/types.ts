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
  check_updates: boolean;
  vault_path: string | null;
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
  /** Manual sort position within a status column; null when never reordered. */
  order: number | null;
  due: string;
  tags: string[];
  /** Hidden from the board by default; toggled via the task context menu. */
  archived: boolean;
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
  order?: number;
  due?: string;
  tags?: string[];
  archived?: boolean;
  body?: string;
}

export type GraphOp =
  | { kind: "checkout"; branch: string }
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
