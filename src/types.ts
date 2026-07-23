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
  /** Check the vault template for updates against the current vault on
   * startup (T-0061). */
  check_template_updates: boolean;
  /** Notify on startup when the long-term memory engine is not set up on
   * this machine (T-0060). The notice points at the memory-setup skill. */
  check_memory_setup: boolean;
  /** Long-term memory hooks in Claude Code sessions (capture + inject). */
  memory_claude_code: boolean;
  /** Long-term memory adapter in OpenCode sessions (capture + inject). */
  memory_opencode: boolean;
  /** Screen-annotation overlay (double-press-and-hold Alt to draw). */
  ink_enabled: boolean;
  vault_path: string | null;
  /** Root dir for task worktrees, laid out as `<root>/<task-id>/<repo-name>`. */
  worktree_root: string;
  /** Show the herdr client in an embedded terminal panel (xterm.js + ConPTY)
   * in the Tasks view instead of an external Windows Terminal window. */
  terminal_embed: boolean;
  /** Quick capture: global hotkey opens a small window that creates an inbox
   * task from the clipboard. */
  quick_capture_enabled: boolean;
  /** Preferred quick-capture hotkey; fallbacks are tried if taken. */
  quick_capture_shortcut: string;
  /** Last quick-capture window rect (managed by the backend; round-tripped
   * here so saving settings doesn't wipe it). */
  quick_capture_rect: WindowRect | null;
  /** Voice input: global hotkey toggles local speech-to-text dictation,
   * pasted into whatever app has focus. */
  voice_enabled: boolean;
  /** Preferred voice-input hotkey; a fallback is tried if taken. */
  voice_hotkey: string;
  /** Whisper ggml model used for transcription: "tiny" | "base" | "small". */
  voice_model: string;
  /** Transcription language: "auto" or an ISO code (e.g. "en", "ja"). */
  voice_language: string;
  /** Last dragged position of the voice indicator window (physical pixels,
   * top-left; managed by the backend, round-tripped here so saving settings
   * doesn't wipe it). */
  voice_indicator_position: [number, number] | null;
  /** Language the AI writes the task file's `## Plan` and `## Results`
   * sections in: "en" | "ja". Content only — never affects code, comments,
   * commit messages, or other repository artifacts. */
  task_language: string;
  /** Free-form instructions appended to every agent prompt (launch and copy
   * alike). Empty = nothing appended; whitespace is normalized by the
   * backend so the prompt survives being quoted into a one-line command. */
  custom_prompt: string;
  /** Built-in vault-tidy routine (files stale inbox notes, refreshes the
   * tasks/archive index via a headless agent). */
  tidy: TidySettings;
  /** Agent CLI used for AI schedule edits: "claude-code" | "opencode". */
  schedule_assignee: string;
  /** Model passed to that agent via --model; empty = the agent's default. */
  schedule_model: string;
  /** Default AI schedule edits to confirm-first (show the diff) instead of
   * applying immediately. */
  schedule_confirm: boolean;
  /** Default HTML export destination; empty = the project's `attachments/`. */
  schedule_export_dir: string;
}

/** One schedule note as the picker sees it (`list_schedules`). */
export interface ScheduleFile {
  /** Absolute path, forward slashes — the id used by every other command. */
  path: string;
  /** Owning project slug (the `projects/<slug>/` folder name). */
  project: string;
  title: string;
  /** `YYYY-MM-DD..YYYY-MM-DD` display range from the frontmatter. */
  range: string;
  updated: string;
}

/** A schedule note's full text plus the mtime that guards the next write. */
export interface ScheduleDoc {
  path: string;
  content: string;
  mtime: number;
}

/** One past AI schedule edit, newest first in `ScheduleEditRun.history`. */
export interface ScheduleEditEntry {
  instruction: string;
  /** "completed" | "failed" */
  state: string;
  message: string;
  seconds: number;
  at: number;
}

/** Live state of the AI schedule-edit runner (`schedule_edit_status` /
 * `schedule-edit:status`). `state === "running"` also means the calendar is
 * locked against app-side writes. */
export interface ScheduleEditRun {
  /** "idle" | "running" | "completed" | "failed" */
  state: string;
  path: string | null;
  instruction: string | null;
  since: number | null;
  summary: string | null;
  error: string | null;
  stalled: boolean;
  can_undo: boolean;
  history: ScheduleEditEntry[];
}

/** Config for the built-in vault-tidy routine (T-0050). */
export interface TidySettings {
  /** Master on/off for the *scheduled* routine (manual runs ignore this). */
  enabled: boolean;
  /** Which agent CLI to launch: "claude-code" | "opencode". */
  assignee: string;
  /** Model passed to the agent via --model; empty = the agent's default. */
  model: string;
  /** Anchor (unix seconds) the interval schedule is phased from. */
  anchor: number | null;
  /** Hours between scheduled runs, measured from the anchor. */
  interval_hours: number;
  /** Inbox files are only considered once at least this many days old. */
  stale_days: number;
  /** Inbox subfolders skipped entirely (work-in-progress hold areas). */
  exclude_dirs: string[];
  /** Unix seconds of the last run (scheduled or manual). */
  last_run: number | null;
  /** Session id of the last run, kept so resume survives an app restart. */
  last_session_id: string | null;
}

/** Live state of the vault-tidy runner, from `tidy_status` / `tidy:status`. */
export interface TidyRun {
  /** "idle" | "running" | "completed" | "failed" */
  state: string;
  since: number | null;
  at: number | null;
  summary: string | null;
  error: string | null;
  session_id: string | null;
  stalled: boolean;
}

/** Per-model download/active status for Settings > Voice. */
export interface SttModelStatus {
  model: string;
  size_label: string;
  downloaded: boolean;
  active: boolean;
}

/** One recorded voice-input transcript (safety net for lost-focus pastes). */
export interface VoiceHistoryEntry {
  id: string;
  text: string;
  /** ISO 8601 UTC timestamp. */
  created: string;
  model: string;
}

export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
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

/** Per-file comparison state between the shipped vault template and the
 * configured vault, from `check_vault_template` (T-0061). */
export type TemplateFileState = "added" | "updatable" | "conflict" | "up_to_date";

export interface TemplateDiffFile {
  path: string;
  state: TemplateFileState;
}

export interface TemplateDiff {
  files: TemplateDiffFile[];
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
