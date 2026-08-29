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
  /** Apply the vault template updates that cannot destroy user content
   * (missing files, and files still identical to the last-applied baseline)
   * without asking (T-0196). Conflicting files always keep asking. */
  auto_apply_template_updates: boolean;
  /** Notify on startup when the long-term memory engine is not set up on
   * this machine (T-0060). The notice points at the memory-setup skill. */
  check_memory_setup: boolean;
  /** Long-term memory hooks in Claude Code sessions (capture + inject). */
  memory_claude_code: boolean;
  /** Long-term memory adapter in OpenCode sessions (capture + inject). */
  memory_opencode: boolean;
  /** Secretary agent (T-0154): agents consult a `secretary` subagent before
   * interrupting the owner, and file what it escalates into `_ai/comms/`.
   * Off by default — consulting a subagent costs tokens (T-0158). */
  secretary_enabled: boolean;
  /** Screen-annotation overlay (double-press-and-hold Alt to draw). */
  ink_enabled: boolean;
  /** Where Alt+C writes captures; empty = the vault's `attachments/ink/`. */
  ink_dir: string;
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
  /** Last ink preview window size (managed by the backend; round-tripped
   * here so saving settings doesn't wipe it). */
  ink_preview_rect: WindowRect | null;
  /** Last task-editor window size (managed by the backend; round-tripped here
   * so saving settings doesn't wipe it). */
  task_editor_rect: WindowRect | null;
  /** Whether the task editor window was maximized when last closed (managed
   * by the backend; round-tripped here so saving settings doesn't wipe it). */
  task_editor_maximized: boolean;
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
  voice_indicator_placement: "caret" | "fixed";
  voice_indicator_position: [number, number] | null;
  /** Clips: a clibor-style snippet picker opened by a double-tapped modifier,
   * pasting the picked snippet into the app that had focus. */
  clips_enabled: boolean;
  /** Which gesture opens the picker: "ctrl-double" | "shift-double" | "off".
   * Alt is deliberately not offered — the ink overlay owns it. */
  clips_gesture: string;
  /** Last clips popup window rect (managed by the backend; round-tripped here
   * so saving settings doesn't wipe it). */
  clips_rect: WindowRect | null;
  /** Language the AI writes the task file's `## Plan` and `## Results`
   * sections in: "en" | "ja". Content only — never affects code, comments,
   * commit messages, or other repository artifacts. */
  task_language: string;
  /** Free-form instructions appended to every agent prompt (launch and copy
   * alike). Empty = nothing appended; whitespace is normalized by the
   * backend so the prompt survives being quoted into a one-line command. */
  custom_prompt: string;
  /** What "send to Claude Desktop" opens: "code" = a Claude Code session
   * rooted at the vault (same prompt a terminal launch uses), "chat" = a plain
   * chat with the task's Description (no skills, consultation only). */
  claude_desktop_mode: string;
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
  /** Agent CLI used for AI mindmap edits: "claude-code" | "opencode". */
  mindmap_assignee: string;
  /** Model passed to that agent via --model; empty = the agent's default. */
  mindmap_model: string;
  /** Default AI mindmap edits to confirm-first instead of applying
   * immediately. */
  mindmap_confirm: boolean;
  /** Default HTML export destination; empty = the project's `attachments/`. */
  schedule_export_dir: string;
  /** Calendar display language, on screen and in the HTML export: "en" | "ja".
   * Display only — a schedule note never stores localized text. */
  schedule_locale: string;
  /** Recurring task rules (T-0110). Evaluated in the frontend, which owns the
   * local-time calendar arithmetic; the backend only persists them. */
  recurring: RecurringRule[];
}

/** When a recurring rule fires. All times are the machine's local wall clock. */
export interface RecurringSchedule {
  /** "daily" | "weekly" | "monthly" */
  kind: string;
  /** daily: fire every N days counted from `start_date`. */
  interval_days: number;
  /** weekly: weekdays to fire on, 0 = Sunday .. 6 = Saturday. */
  weekdays: number[];
  /** monthly: day of month, clamped to the last day of shorter months. */
  day_of_month: number;
  /** Time of day, "HH:MM" (24h, local). */
  time: string;
  /** `YYYY-MM-DD`; no occurrence before this date. Empty = no lower bound. */
  start_date: string;
}

/** One recurring-task rule: a task template plus its schedule (T-0110). */
export interface RecurringRule {
  /** Stable id (`R-001`), also the suffix of the `recurring/<id>` tag put on
   * every task the rule generates. Never reused. */
  id: string;
  enabled: boolean;
  title: string;
  /** Body of the generated task; empty = the standard empty sections. */
  body: string;
  status: string;
  assignee: string;
  project: string;
  priority: string;
  model: string;
  /** Extra tags on top of the mandatory `recurring/<id>` marker tag. */
  tags: string[];
  confirm: boolean;
  worktree: boolean;
  /** `due` = occurrence date + this many days; null = no due date. */
  due_offset_days: number | null;
  /** Skip the occurrence while a task from this rule is still open (status !=
   * done, not archived). The slot is still consumed. */
  skip_if_open: boolean;
  schedule: RecurringSchedule;
  /** Unix seconds of the occurrence this rule was last evaluated for
   * (generated or deliberately skipped); null = never fired. */
  last_generated: number | null;
}

/** One schedule note as the picker sees it (`list_schedules`). */
/** One subfolder of a vault project, with how much is in it. */
export interface VaultProjectFolder {
  name: string;
  /** Notes (`*.md`), or files of any type for `attachments/`. */
  count: number;
  /** False when the documented layout does not name this folder. */
  known: boolean;
}

/** One way a project departs from the layout documented in the vault's
 * CLAUDE.md. */
export interface VaultProjectIssue {
  kind: "missing-file" | "missing-folder" | "misfiled-deliverable" | "unknown-folder";
  severity: "warn" | "info";
  /** The path or name the finding is about, relative to the project folder. */
  target: string;
}

/** A vault project (`projects/<slug>/`) as the Projects tab sees it. Distinct
 * from `Project`, which is a *registered repository* in the Repos tab — the
 * two are linked by `repo`, never merged (see `vault_project.rs`). */
export interface VaultProject {
  slug: string;
  name: string;
  /** Absolute path, forward slashes. */
  path: string;
  /** `status` from README.md (active | paused | done); empty when unset. */
  status: string;
  /** Path of the registered repository this project belongs to; empty when
   * the project has no repo. */
  repo: string;
  /** `description` from README.md, or the first prose paragraph when unset. */
  summary: string;
  /** Newest mtime under the folder, in unix seconds. */
  updated: number;
  folders: VaultProjectFolder[];
  issues: VaultProjectIssue[];
  /** True when the folder lives under `archive/projects/` instead. */
  archived: boolean;
}

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

/** One mindmap note as the picker sees it (`list_mindmaps`). */
export interface MindmapFile {
  /** Absolute path, forward slashes — the id used by every other command. */
  path: string;
  /** Owning project slug (the `projects/<slug>/` folder name). */
  project: string;
  title: string;
  updated: string;
}

/** A mindmap note's full text plus the mtime that guards the next write. */
export interface MindmapDoc {
  path: string;
  content: string;
  mtime: number;
}

/** One past AI mindmap edit, newest first in `MindmapEditRun.history`. */
export interface MindmapEditEntry {
  instruction: string;
  /** "completed" | "failed" */
  state: string;
  message: string;
  seconds: number;
  at: number;
}

/** Live state of the AI mindmap-edit runner (`mindmap_edit_status` /
 * `mindmap-edit:status`). `state === "running"` also means the canvas is
 * locked against app-side writes. */
export interface MindmapEditRun {
  /** "idle" | "running" | "completed" | "failed" */
  state: string;
  path: string | null;
  instruction: string | null;
  since: number | null;
  summary: string | null;
  error: string | null;
  stalled: boolean;
  can_undo: boolean;
  history: MindmapEditEntry[];
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

/** The tidy agent's parked filing proposal for an inbox note (T-0104). */
export interface InboxPending {
  /** Why the agent did not file the note itself. */
  reason: string;
  /** Where it thinks the note belongs — free text, often several candidates. */
  proposal: string;
}

/** One unfiled note in the vault's `inbox/` folder. */
export interface InboxNote {
  /** Absolute path, forward slashes — the id used by `readInboxNote`. */
  path: string;
  /** Vault-relative path, forward slashes. */
  rel_path: string;
  /** File name without the `.md` extension. */
  name: string;
  /** Last-modified time, unix seconds. */
  modified: number;
  /** Whole days since `modified`. */
  age_days: number;
  /** Old enough for the tidy routine to act on (tidy `stale_days`). */
  stale: boolean;
  pending: InboxPending | null;
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

/** One paste-ready snippet in the clips picker. Array order is the display
 * order — the editor sends the whole list back after any edit or reorder. */
/** A saved ink capture (annotated screenshot), as the Ink tab lists it. */
export interface InkCapture {
  path: string;
  name: string;
  width: number;
  height: number;
  /** File mtime in ms since the epoch; the list is sorted on it. */
  modified_ms: number;
  size_bytes: number;
  /** `data:image/png;base64,...` of a downscaled preview. */
  thumbnail: string;
}

export interface Clip {
  id: string;
  label: string;
  text: string;
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

/** Health of the shared global keyboard listener behind the ink (double-press
 * Alt) and clips (double-tap Ctrl) gestures, from `input_listener_diagnostics`.
 * Durations are milliseconds; `null` means it has never happened. */
export interface InputListenerDiagnostics {
  running: boolean;
  consumers: string[];
  uptime_ms: number | null;
  /** Time since the last key transition the listener saw. A large value while
   * the user is actively typing means the registration went dead. */
  last_input_ms_ago: number | null;
  input_count: number;
  reregistrations: number;
  restarts: number;
  /** Times the external watchdog rebuilt a dead listener thread or a
   * registration that no longer pointed at the listener. */
  rebuilds: number;
  last_rebuild_reason: string | null;
  last_reregister_ms_ago: number | null;
  last_reregister_reason: string | null;
  last_error: string | null;
  /** An elevated app is in the foreground, so Windows withholds every key
   * from workhub (UIPI) — not something the listener can fix. */
  elevated_foreground: boolean;
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
  /** Waiting on something external: the task keeps its status but cannot move
   * until someone else acts. Orthogonal to status — any column can be blocked. */
  blocked: boolean;
  /** One-line summary of what the task is waiting on; empty when not blocked. */
  blocked_note: string;
  /** `YYYY-MM-DD` the task became blocked, for the stalled-days badge. */
  blocked_since: string;
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
  blocked?: boolean;
  blockedNote?: string;
  blockedSince?: string;
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
  /** Toggling this wins over the two detail fields: unblocking clears them,
   * blocking without a date stamps today (see `update_task` in tasks.rs). */
  blocked?: boolean;
  blockedNote?: string;
  blockedSince?: string;
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
