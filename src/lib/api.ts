import { invoke } from "@tauri-apps/api/core";
import type { MusicData } from "@/lib/music/types";
import type {
  CommitFileChange,
  Config,
  CreateTaskInput,
  GitInfo,
  GitLog,
  GraphOp,
  Task,
  UpdateInfo,
  UpdateTaskInput,
} from "@/types";

export const api = {
  getConfig: () => invoke<Config>("get_config"),
  saveConfig: (config: Config) => invoke<void>("save_config", { config }),
  gitStatus: (path: string) => invoke<GitInfo>("git_status", { path }),
  gitOp: (path: string, op: "fetch" | "pull" | "switch", branch?: string) =>
    invoke<string>("git_op", { path, op, branch: branch ?? null }),
  gitRemoteUrl: (path: string) => invoke<string>("git_remote_url", { path }),
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
  appVersion: () => invoke<string>("app_version"),
  checkUpdate: () => invoke<UpdateInfo | null>("check_update"),
  applyUpdate: (url: string) => invoke<void>("apply_update", { url }),
  restartApp: () => invoke<void>("restart_app"),

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
  initVault: (vaultPath: string, templateSource: string) =>
    invoke<void>("init_vault", { vaultPath, templateSource }),
  watchVault: (vaultPath: string) => invoke<void>("watch_vault", { vaultPath }),
  // ---- music player (vault-backed) ----
  loadMusicData: (vaultPath: string) =>
    invoke<MusicData | null>("load_music_data", { vaultPath }),
  saveMusicData: (vaultPath: string, data: MusicData) =>
    invoke<void>("save_music_data", { vaultPath, data }),
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
    vaultPath: string,
    useHerdr: boolean,
    herdrCmd: string,
  ) =>
    invoke<string>("launch_agent_for_task", {
      agentCmd,
      assignee,
      taskId,
      taskTitle,
      taskFile,
      project,
      model,
      vaultPath,
      useHerdr,
      herdrCmd,
    }),
};

// Dev-only default: the workhub-vault template folder shipped in this repo
// checkout. A packaged build would resolve this from a bundled resource
// instead — out of scope for the task-management MVP.
export const DEV_VAULT_TEMPLATE_SOURCE = "C:/repos/workhub/vault-template";

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
