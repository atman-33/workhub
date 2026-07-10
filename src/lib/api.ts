import { invoke } from "@tauri-apps/api/core";
import type { Config, GitInfo, GitLog, GraphOp, UpdateInfo } from "@/types";

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
  openInVscode: (vscodeCmd: string, paths: string[]) =>
    invoke<void>("open_in_vscode", { vscodeCmd, paths }),
  openTerminal: (template: string, path: string) =>
    invoke<void>("open_terminal", { template, path }),
  launchAgent: (template: string, path: string) =>
    invoke<void>("launch_agent", { template, path }),
  openExplorer: (path: string) => invoke<void>("open_explorer", { path }),
  appVersion: () => invoke<string>("app_version"),
  checkUpdate: () => invoke<UpdateInfo | null>("check_update"),
  applyUpdate: (url: string) => invoke<void>("apply_update", { url }),
  restartApp: () => invoke<void>("restart_app"),
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
