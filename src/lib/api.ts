import { type Channel, invoke } from "@tauri-apps/api/core";
import type { MusicData } from "@/lib/music/types";
import type {
  BranchList,
  CommitFileChange,
  Config,
  CreateTaskInput,
  GitInfo,
  GitLog,
  GraphOp,
  SttModelStatus,
  Task,
  TemplateDiff,
  TidyRun,
  UpdateInfo,
  UpdateTaskInput,
  VoiceHistoryEntry,
  Worktree,
} from "@/types";

export const api = {
  getConfig: () => invoke<Config>("get_config"),
  saveConfig: (config: Config) => invoke<void>("save_config", { config }),
  // ---- vault tidy (T-0050) ----
  tidyStatus: () => invoke<TidyRun>("tidy_status"),
  runVaultTidyNow: (force: boolean) =>
    invoke<string>("run_vault_tidy_now", { force }),
  resumeTidySession: () => invoke<string>("resume_tidy_session"),
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
  previewVaultTemplateFile: (vaultPath: string, path: string) =>
    invoke<string>("preview_vault_template_file", { vaultPath, path }),
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

  // ---- voice input: transcript history ----
  voiceHistoryList: () => invoke<VoiceHistoryEntry[]>("voice_history_list"),
  voiceHistoryDelete: (id: string) => invoke<void>("voice_history_delete", { id }),
  voiceHistoryClear: () => invoke<void>("voice_history_clear"),
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
