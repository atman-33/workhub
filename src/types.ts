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
  check_updates: boolean;
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
