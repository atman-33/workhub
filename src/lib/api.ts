import { type Channel, invoke } from "@tauri-apps/api/core";
import type { MusicData } from "@/lib/music/types";
import type { TaskEditorPayload } from "@/lib/task-editor-bridge";
import type {
  BranchList,
  Clip,
  CommitFileChange,
  Config,
  CreateTaskInput,
  GitInfo,
  GitLog,
  GraphOp,
  InboxNote,
  InkCapture,
  InputListenerDiagnostics,
  MindmapDoc,
  MindmapEditRun,
  MindmapFile,
  PersonaCharacter,
  PersonaState,
  PluginCommandResult,
  PluginDetails,
  PluginsState,
  ScheduleDoc,
  ScheduleEditRun,
  ScheduleFile,
  SttModelStatus,
  Task,
  TemplateDiff,
  TidyRun,
  UpdateInfo,
  UpdateTaskInput,
  VaultProject,
  VoiceHistoryEntry,
  Worktree,
} from "@/types";

export const api = {
  getConfig: () => invoke<Config>("get_config"),
  /// Returns the config that took effect — it differs from what was sent
  /// when the vault changed and its own settings were adopted (T-0206).
  saveConfig: (config: Config) => invoke<Config>("save_config", { config }),
  // ---- vault tidy (T-0050) ----
  tidyStatus: () => invoke<TidyRun>("tidy_status"),
  runVaultTidyNow: (force: boolean) =>
    invoke<string>("run_vault_tidy_now", { force }),
  resumeTidySession: () => invoke<string>("resume_tidy_session"),
  // ---- inbox notes (the vault's `inbox/` folder, T-0104) ----
  listInboxNotes: (vaultPath: string) =>
    invoke<InboxNote[]>("list_inbox_notes", { vaultPath }),
  readInboxNote: (path: string) => invoke<string>("read_inbox_note", { path }),
  gitStatus: (path: string) => invoke<GitInfo>("git_status", { path }),
  listBranches: (path: string) => invoke<BranchList>("list_branches", { path }),
  gitOp: (path: string, op: "fetch" | "pull" | "switch", branch?: string) =>
    invoke<string>("git_op", { path, op, branch: branch ?? null }),
  gitRemoteUrl: (path: string) => invoke<string>("git_remote_url", { path }),
  listWorktrees: (paths: string[]) =>
    invoke<Worktree[]>("list_worktrees", { paths }),
  removeWorktree: (repoPath: string, worktreePath: string, force: boolean) =>
    invoke<string>("remove_worktree", { repoPath, worktreePath, force }),
  deleteWorktreeBranch: (repoPath: string, branch: string, force: boolean) =>
    invoke<string>("delete_worktree_branch", { repoPath, branch, force }),
  gitLog: (path: string, limit: number, skip: number) =>
    invoke<GitLog>("git_log", { path, limit, skip }),
  gitGraphOp: (path: string, op: GraphOp) =>
    invoke<string>("git_graph_op", { path, op }),
  gitCommitFiles: (path: string, hash: string) =>
    invoke<CommitFileChange[]>("git_commit_files", { path, hash }),
  gitCommitFileDiff: (path: string, hash: string, file: string, oldFile?: string | null) =>
    invoke<string>("git_commit_file_diff", { path, hash, file, oldFile: oldFile ?? null }),
  openInVscode: (vscodeCmd: string, paths: string[]) =>
    invoke<void>("open_in_vscode", { vscodeCmd, paths }),
  openTerminal: (template: string, path: string) =>
    invoke<void>("open_terminal", { template, path }),
  launchAgent: (template: string, path: string) =>
    invoke<void>("launch_agent", { template, path }),
  opencodeModels: () => invoke<string[]>("opencode_models"),
  openExplorer: (path: string) => invoke<void>("open_explorer", { path }),
  openInObsidian: (path: string) => invoke<void>("open_in_obsidian", { path }),
  appVersion: () => invoke<string>("app_version"),
  // ---- global keyboard listener health (ink / clips gestures) ----
  inputListenerDiagnostics: () =>
    invoke<InputListenerDiagnostics>("input_listener_diagnostics"),
  restartInputListener: () =>
    invoke<InputListenerDiagnostics>("restart_input_listener"),
  checkUpdate: () => invoke<UpdateInfo | null>("check_update"),
  applyUpdate: (url: string) => invoke<void>("apply_update", { url }),
  restartApp: () => invoke<void>("restart_app"),
  memorySetupOk: () => invoke<boolean>("memory_setup_ok"),

  // ---- tasks (vault-backed) ----
  checkVaultPath: (vaultPath: string) =>
    invoke<boolean>("check_vault_path", { vaultPath }),
  listTasks: (vaultPath: string) => invoke<Task[]>("list_tasks", { vaultPath }),
  createTask: (vaultPath: string, input: CreateTaskInput) =>
    invoke<Task>("create_task", { vaultPath, input }),
  updateTask: (vaultPath: string, input: UpdateTaskInput) =>
    invoke<Task>("update_task", { vaultPath, input }),
  deleteTask: (vaultPath: string, id: string) =>
    invoke<void>("delete_task", { vaultPath, id }),
  initVault: (vaultPath: string) => invoke<void>("init_vault", { vaultPath }),
  watchVault: (vaultPath: string) => invoke<void>("watch_vault", { vaultPath }),
  checkVaultTemplate: (vaultPath: string) =>
    invoke<TemplateDiff>("check_vault_template", { vaultPath }),
  /** `overwrite` lists conflicting paths the user chose to replace with the
   * template instead of getting a `<name>.new` file beside the original. */
  applyVaultTemplate: (vaultPath: string, paths: string[], overwrite: string[] = []) =>
    invoke<void>("apply_vault_template", { vaultPath, paths, overwrite }),
  /** Applies only the updates that cannot lose user edits (added/updatable),
   * leaving conflicts for the review dialog. Resolves to the written paths. */
  applySafeTemplateUpdates: (vaultPath: string) =>
    invoke<string[]>("apply_safe_template_updates", { vaultPath }),
  previewVaultTemplateFile: (vaultPath: string, path: string) =>
    invoke<string>("preview_vault_template_file", { vaultPath, path }),
  // ---- vault projects (projects/<slug>/, T-0190) ----
  /** Every project folder under the vault's `projects/`, with what it holds
   * and where it departs from the documented layout. */
  listVaultProjects: (vaultPath: string, includeArchived: boolean) =>
    invoke<VaultProject[]>("list_vault_projects", { vaultPath, includeArchived }),
  /** Moves the project to `archive/projects/<slug>/`; returns the new path.
   * There is no delete — archiving is the only removal, and it is reversible
   * with `restoreVaultProject`. */
  archiveVaultProject: (vaultPath: string, slug: string) =>
    invoke<string>("archive_vault_project", { vaultPath, slug }),
  restoreVaultProject: (vaultPath: string, slug: string) =>
    invoke<string>("restore_vault_project", { vaultPath, slug }),
  /** Links the project to registered repositories (`repos:` in its
   * `_index.md`), in order — the first is the project's default repository.
   * Pass an empty array to clear the link. */
  setVaultProjectRepos: (vaultPath: string, slug: string, repos: string[]) =>
    invoke<void>("set_vault_project_repos", { vaultPath, slug, repos }),
  /** Writes the display name and description into README.md frontmatter.
   * The folder slug is not renamed. */
  setVaultProjectDetails: (vaultPath: string, slug: string, name: string, summary: string) =>
    invoke<void>("set_vault_project_details", { vaultPath, slug, name, summary }),
  /** Pins the project and records its manual sort position in `_index.md`.
   * Pass `null` for `order` to clear the position, which puts the project
   * back at the end of its group (T-0231). */
  setVaultProjectOrder: (
    vaultPath: string,
    slug: string,
    pinned: boolean,
    order: number | null,
  ) => invoke<void>("set_vault_project_order", { vaultPath, slug, pinned, order }),
  // ---- schedule notes (projects/<slug>/schedules/*.md) ----
  /** Project slugs under the vault's `projects/`, including ones with no
   * schedule note yet — deriving the list from existing notes would make the
   * first schedule impossible to create. */
  listScheduleProjects: (vaultPath: string) =>
    invoke<string[]>("list_schedule_projects", { vaultPath }),
  /** Creates `projects/<slug>/` from the bundled scaffold, filling its
   * placeholders (`name` falls back to the slug when empty) (T-0178). */
  createVaultProject: (vaultPath: string, slug: string, name: string) =>
    invoke<void>("create_vault_project", { vaultPath, slug, name }),
  /** `project` narrows to one project slug; pass "" for every project. */
  listSchedules: (vaultPath: string, project = "") =>
    invoke<ScheduleFile[]>("list_schedules", { vaultPath, project }),
  readSchedule: (path: string) => invoke<ScheduleDoc>("read_schedule", { path }),
  /** Returns the new mtime. Rejects when the file changed on disk since it was
   * read; pass `expectedMtime: 0` to write unconditionally. */
  writeSchedule: (path: string, content: string, expectedMtime: number) =>
    invoke<number>("write_schedule", { path, content, expectedMtime }),
  createSchedule: (vaultPath: string, project: string, title: string, range: string) =>
    invoke<ScheduleFile>("create_schedule", { vaultPath, project, title, range }),
  /** Renames a note: frontmatter `title` and file name move together. Returns
   * the note at its new path, which the caller must reselect. */
  renameSchedule: (vaultPath: string, path: string, title: string) =>
    invoke<ScheduleFile>("rename_schedule", { vaultPath, path, title }),
  /** Moves the note into `_ai/memory/schedule-trash/` rather than deleting it,
   * and returns where it went. */
  deleteSchedule: (vaultPath: string, path: string) =>
    invoke<string>("delete_schedule", { vaultPath, path }),
  exportScheduleHtml: (outPath: string, html: string) =>
    invoke<void>("export_schedule_html", { outPath, html }),
  runScheduleEdit: (path: string, instruction: string, confirm: boolean) =>
    invoke<string>("run_schedule_edit", { path, instruction, confirm }),
  scheduleEditStatus: () => invoke<ScheduleEditRun>("schedule_edit_status"),
  restoreScheduleSnapshot: (path: string) =>
    invoke<ScheduleDoc>("restore_schedule_snapshot", { path }),

  // ---- mindmap notes (projects/<slug>/mindmaps/*.md) ----
  /** `project` narrows to one project slug; pass "" for every project. */
  listMindmaps: (vaultPath: string, project = "") =>
    invoke<MindmapFile[]>("list_mindmaps", { vaultPath, project }),
  readMindmap: (path: string) => invoke<MindmapDoc>("read_mindmap", { path }),
  /** Returns the new mtime. Rejects when the file changed on disk since it was
   * read; pass `expectedMtime: 0` to write unconditionally. */
  writeMindmap: (path: string, content: string, expectedMtime: number) =>
    invoke<number>("write_mindmap", { path, content, expectedMtime }),
  createMindmap: (vaultPath: string, project: string, title: string) =>
    invoke<MindmapFile>("create_mindmap", { vaultPath, project, title }),
  /** Renames a note: frontmatter `title` and file name move together. Returns
   * the note at its new path, which the caller must reselect. */
  renameMindmap: (vaultPath: string, path: string, title: string) =>
    invoke<MindmapFile>("rename_mindmap", { vaultPath, path, title }),
  /** Moves the note into `_ai/memory/mindmap-trash/` rather than deleting it,
   * and returns where it went. */
  deleteMindmap: (vaultPath: string, path: string) =>
    invoke<string>("delete_mindmap", { vaultPath, path }),
  exportMindmapFile: (outPath: string, content: string) =>
    invoke<void>("export_mindmap_file", { outPath, content }),
  /** `base64Data` is the payload of a `data:image/png;base64,...` URL. */
  exportMindmapPng: (outPath: string, base64Data: string) =>
    invoke<void>("export_mindmap_png", { outPath, base64Data }),
  runMindmapEdit: (path: string, instruction: string, confirm: boolean) =>
    invoke<string>("run_mindmap_edit", { path, instruction, confirm }),
  mindmapEditStatus: () => invoke<MindmapEditRun>("mindmap_edit_status"),
  restoreMindmapSnapshot: (path: string) =>
    invoke<MindmapDoc>("restore_mindmap_snapshot", { path }),

  // ---- music player (vault-backed) ----
  loadMusicData: (vaultPath: string) =>
    invoke<MusicData | null>("load_music_data", { vaultPath }),
  saveMusicData: (vaultPath: string, data: MusicData) =>
    invoke<void>("save_music_data", { vaultPath, data }),
  exportPlaylistFile: (path: string, contents: string) =>
    invoke<void>("export_playlist_file", { path, contents }),
  importPlaylistFile: (path: string) => invoke<string>("import_playlist_file", { path }),
  fetchYoutubeTitle: (videoId: string) =>
    invoke<string>("fetch_youtube_title", { videoId }),

  launchAgentForTask: (
    agentCmd: string,
    assignee: string,
    taskId: string,
    taskTitle: string,
    taskFile: string,
    project: string,
    model: string,
    confirm: boolean,
    worktree: boolean,
    vaultPath: string,
    useHerdr: boolean,
    herdrCmd: string,
    terminalEmbed: boolean,
    taskLanguage: string,
    customPrompt: string,
  ) =>
    invoke<string>("launch_agent_for_task", {
      agentCmd,
      assignee,
      taskId,
      taskTitle,
      taskFile,
      project,
      model,
      confirm,
      worktree,
      vaultPath,
      useHerdr,
      herdrCmd,
      terminalEmbed,
      taskLanguage,
      customPrompt,
    }),

  copyTaskPrompt: (
    assignee: string,
    taskId: string,
    taskTitle: string,
    taskFile: string,
    project: string,
    model: string,
    confirm: boolean,
    worktree: boolean,
    vaultPath: string,
    taskLanguage: string,
    customPrompt: string,
  ) =>
    invoke<void>("copy_task_prompt", {
      assignee,
      taskId,
      taskTitle,
      taskFile,
      project,
      model,
      confirm,
      worktree,
      vaultPath,
      taskLanguage,
      customPrompt,
    }),

  /** Opens Claude Desktop on a new session for the task with the prompt
   * prefilled. `mode` is the `claude_desktop_mode` setting; `description` is
   * the task's Description text, read only by chat mode. Returns a status
   * message describing which kind of session was opened. */
  sendTaskToClaudeDesktop: (
    assignee: string,
    taskId: string,
    taskTitle: string,
    taskFile: string,
    project: string,
    model: string,
    confirm: boolean,
    worktree: boolean,
    vaultPath: string,
    taskLanguage: string,
    customPrompt: string,
    mode: string,
    description: string,
  ) =>
    invoke<string>("send_task_to_claude_desktop", {
      assignee,
      taskId,
      taskTitle,
      taskFile,
      project,
      model,
      confirm,
      worktree,
      vaultPath,
      taskLanguage,
      customPrompt,
      mode,
      description,
    }),

  // ---- embedded terminal (xterm.js + ConPTY running the herdr client) ----
  /** Returns true when an already-running PTY session was reused. Output is
   * streamed over `onOutput` (an ordered IPC channel — unlike events, safe
   * for high-throughput TUI redraws). */
  terminalOpen: (id: string, cols: number, rows: number, onOutput: Channel<string>) =>
    invoke<boolean>("terminal_open", { id, cols, rows, onOutput }),
  terminalWrite: (id: string, data: string) =>
    invoke<void>("terminal_write", { id, data }),
  terminalResize: (id: string, cols: number, rows: number) =>
    invoke<void>("terminal_resize", { id, cols, rows }),
  terminalClose: (id: string) => invoke<void>("terminal_close", { id }),

  // ---- voice input (local speech-to-text) ----
  sttModelStatus: () => invoke<SttModelStatus[]>("stt_model_status"),
  sttDownloadModel: (model: string) => invoke<void>("stt_download_model", { model }),
  sttDeleteModel: (model: string) => invoke<void>("stt_delete_model", { model }),
  voiceStopRecording: () => invoke<void>("voice_stop_recording"),

  // ---- clips (clibor-style snippet picker) ----
  clipsList: () => invoke<Clip[]>("clips_list"),
  clipsSave: (clips: Clip[]) => invoke<void>("clips_save", { clips }),
  clipsPaste: (id: string) => invoke<void>("clips_paste", { id }),
  clipsHide: () => invoke<void>("clips_hide"),

  // ---- ink captures (annotated screenshots) ----
  inkCaptureDir: () => invoke<string>("ink_capture_dir"),
  listInkCaptures: () => invoke<InkCapture[]>("list_ink_captures"),
  /** Full-size image as a `data:image/png;base64,...` URL. */
  readInkCapture: (path: string) => invoke<string>("read_ink_capture", { path }),
  copyInkCapture: (path: string) => invoke<void>("copy_ink_capture", { path }),
  /** Copies a frontend-rendered image (a crop) without writing a file. */
  copyInkPng: (base64Data: string) => invoke<void>("copy_ink_png", { base64Data }),
  /** `base64Data` is the payload of a `data:image/png;base64,...` URL. */
  saveInkCrop: (sourcePath: string, base64Data: string) =>
    invoke<string>("save_ink_crop", { sourcePath, base64Data }),
  /** Sends the capture to the recycle bin. */
  deleteInkCapture: (path: string) => invoke<void>("delete_ink_capture", { path }),
  /** Shows the floating preview window (move/resize/crop) on the capture. */
  openInkPreview: (path: string) => invoke<void>("open_ink_preview", { path }),
  /** Hides the floating preview window. */
  inkPreviewHide: () => invoke<void>("ink_preview_hide"),

  // ---- task editor window ----
  /** Shows the task editor window and hands it the form's whole input. */
  openTaskEditor: (payload: TaskEditorPayload) =>
    invoke<void>("open_task_editor", { payload }),
  /** Hides the task editor window — its ✕ lands here. */
  taskEditorHide: () => invoke<void>("task_editor_hide"),
  /** Asks the board to open the embedded terminal panel before a launch. */
  taskEditorRequestTerminalPanel: () =>
    invoke<void>("task_editor_request_terminal_panel"),
  /** Brings the main window (and with it the terminal panel) to the front. */
  focusMainWindow: () => invoke<void>("focus_main_window"),

  // ---- voice input: transcript history ----
  voiceHistoryList: () => invoke<VoiceHistoryEntry[]>("voice_history_list"),
  voiceHistoryDelete: (id: string) => invoke<void>("voice_history_delete", { id }),
  // ---- persona plugin (Persona tab) ----
  // An empty character list is how the app decides the plugin is not in use.
  personaCharacters: () => invoke<PersonaCharacter[]>("persona_characters"),
  personaState: () => invoke<PersonaState>("persona_state"),
  /** True when the standalone `genshijin` plugin is cached alongside
   * `persona` — both style every turn, so the tab warns about the pair. */
  personaGenshijinInstalled: () => invoke<boolean>("persona_genshijin_installed"),
  /// Writes the plugin's persisted default; it applies from the next session.
  setPersonaState: (enabled: boolean, character: string | null, level: string) =>
    invoke<PersonaState>("set_persona_state", { enabled, character, level }),
  voiceHistoryClear: () => invoke<void>("voice_history_clear"),

  // ---- workhub marketplace plugins (Plugins tab) ----
  /** Catalog, installed versions, marketplace versions and enabled state. */
  pluginsState: (vaultPath: string) =>
    invoke<PluginsState>("plugins_state", { vaultPath }),
  /** What one plugin contains, read from the copy installed at `scope`. */
  pluginDetails: (vaultPath: string, name: string, marketplace: string, scope: string) =>
    invoke<PluginDetails>("plugin_details", { vaultPath, name, marketplace, scope }),
  /** Adds or removes one enabledPlugins key; applies from the next session. */
  setPluginEnabled: (
    vaultPath: string,
    name: string,
    marketplace: string,
    scope: "project" | "user",
    enabled: boolean,
  ) =>
    invoke<PluginsState>("set_plugin_enabled", {
      vaultPath,
      name,
      marketplace,
      scope,
      enabled,
    }),
  /** Refreshes the marketplace clone every "latest version" is compared against. */
  pluginsUpdateMarketplace: (vaultPath: string, marketplace: string) =>
    invoke<PluginCommandResult>("plugins_update_marketplace", { vaultPath, marketplace }),
  pluginsUpdatePlugin: (
    vaultPath: string,
    name: string,
    marketplace: string,
    scope: string,
  ) =>
    invoke<PluginCommandResult>("plugins_update_plugin", {
      vaultPath,
      name,
      marketplace,
      scope,
    }),
};

export function timeAgo(unixSecs: number): string {
  const secs = Math.max(0, Math.floor(Date.now() / 1000) - unixSecs);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}
