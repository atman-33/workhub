use crate::models::{Config, GitInfo, GitLog, GraphOp};
use crate::{actions, git, storage, update};
use serde::Serialize;

#[tauri::command]
pub fn get_config() -> Config {
    storage::load()
}

#[tauri::command]
pub fn save_config(config: Config) {
    storage::save(&config);
}

#[tauri::command]
pub async fn git_status(path: String) -> GitInfo {
    tauri::async_runtime::spawn_blocking(move || git::read_status(&path))
        .await
        .unwrap_or_default()
}

/// op: "fetch" | "pull" | "switch" (switch requires `branch`)
#[tauri::command]
pub async fn git_op(path: String, op: String, branch: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || match op.as_str() {
        "fetch" => git::fetch(&path),
        "pull" => git::pull(&path),
        "switch" => git::switch(&path, branch.as_deref().unwrap_or_default()),
        other => Err(format!("unknown git op: {other}")),
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Read a page of commit history for the graph view.
#[tauri::command]
pub async fn git_log(path: String, limit: u32, skip: u32) -> Result<GitLog, String> {
    tauri::async_runtime::spawn_blocking(move || git::read_log(&path, limit, skip))
        .await
        .map_err(|e| e.to_string())?
}

/// Run a graph-view git operation (checkout, branch/tag create-delete, merge,
/// rebase, push/pull/fetch, reset, cherry-pick).
#[tauri::command]
pub async fn git_graph_op(path: String, op: GraphOp) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || git::graph_op(&path, op))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_remote_url(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || git::remote_url(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn open_in_vscode(vscode_cmd: String, paths: Vec<String>) -> Result<(), String> {
    actions::open_in_vscode(&vscode_cmd, &paths)
}

#[tauri::command]
pub fn open_terminal(template: String, path: String) -> Result<(), String> {
    actions::open_terminal(&template, &path)
}

#[tauri::command]
pub fn launch_agent(template: String, path: String) -> Result<(), String> {
    actions::launch_agent(&template, &path)
}

#[tauri::command]
pub fn open_explorer(path: String) -> Result<(), String> {
    actions::open_explorer(&path.replace('/', "\\"))
}

#[tauri::command]
pub fn app_version() -> String {
    update::current_version().to_string()
}

#[derive(Serialize)]
pub struct UpdateInfo {
    pub tag: String,
    pub url: String,
}

/// Returns Some only when a strictly newer release exists.
#[tauri::command]
pub async fn check_update() -> Option<UpdateInfo> {
    tauri::async_runtime::spawn_blocking(|| {
        let (tag, url) = update::check_latest()?;
        if update::is_newer(&tag, update::current_version()) {
            Some(UpdateInfo { tag, url })
        } else {
            None
        }
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
pub async fn apply_update(url: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || update::apply_update(&url))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn restart_app(app: tauri::AppHandle) {
    app.restart();
}
