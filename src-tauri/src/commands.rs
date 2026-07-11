use crate::models::{Config, GitInfo, GitLog, GraphOp, Task};
use crate::music::{self, MusicData};
use crate::tasks::{self, CreateTaskInput, UpdateTaskInput, WatcherState};
use crate::{actions, git, harness, storage, update};
use serde::Serialize;
use std::path::PathBuf;

#[tauri::command]
pub fn get_config() -> Config {
    storage::load()
}

#[tauri::command]
pub fn save_config(config: Config) {
    storage::save(&config);
    // Best-effort: keep the vault's .claude/project-context.json aligned with
    // the registered projects so agent sessions see them (harness contract).
    if let Some(vault) = config.settings.vault_path.as_deref() {
        if !vault.trim().is_empty() {
            let _ = harness::sync_project_context(std::path::Path::new(vault), &config.projects);
        }
    }
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

// ---------------------------------------------------------------------
// tasks (vault-backed)
// ---------------------------------------------------------------------

/// Returns true only when the supplied path exists and is a directory.
/// Used by the frontend to decide whether a configured vault path is still
/// valid or should prompt for re-selection.
#[tauri::command]
pub fn check_vault_path(vault_path: String) -> bool {
    std::path::PathBuf::from(vault_path).is_dir()
}

#[tauri::command]
pub async fn list_tasks(vault_path: String) -> Result<Vec<Task>, String> {
    tauri::async_runtime::spawn_blocking(move || tasks::scan_and_index(&PathBuf::from(vault_path)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_task(vault_path: String, input: CreateTaskInput) -> Result<Task, String> {
    tauri::async_runtime::spawn_blocking(move || {
        tasks::create_task(&PathBuf::from(vault_path), input)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn update_task(vault_path: String, input: UpdateTaskInput) -> Result<Task, String> {
    tauri::async_runtime::spawn_blocking(move || {
        tasks::update_task(&PathBuf::from(vault_path), input)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// `template_source` is the absolute path to a `vault-template/` folder to
/// copy from — the frontend defaults it to the repo checkout in dev; a
/// packaged build would point it at a bundled resource instead.
#[tauri::command]
pub async fn init_vault(vault_path: String, template_source: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let vault = PathBuf::from(vault_path);
        tasks::init_vault(&vault, &PathBuf::from(template_source))?;
        // Seed the harness config with the currently registered projects
        // (best-effort — a fresh vault already has the template default).
        let config = storage::load();
        let _ = harness::sync_project_context(&vault, &config.projects);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// (Re)starts watching `<vault_path>/tasks` for changes. Call whenever the
/// configured vault path is set or changes.
#[tauri::command]
pub fn watch_vault(
    app: tauri::AppHandle,
    state: tauri::State<'_, WatcherState>,
    vault_path: String,
) -> Result<(), String> {
    tasks::start_watcher(app, &state.0, PathBuf::from(vault_path))
}

// ---------------------------------------------------------------------
// music player (vault-backed)
// ---------------------------------------------------------------------

/// Returns None until the first save so the frontend can seed defaults.
#[tauri::command]
pub async fn load_music_data(vault_path: String) -> Result<Option<MusicData>, String> {
    tauri::async_runtime::spawn_blocking(move || music::load(&PathBuf::from(vault_path)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_music_data(vault_path: String, data: MusicData) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || music::save(&PathBuf::from(vault_path), &data))
        .await
        .map_err(|e| e.to_string())?
}

/// YouTube oEmbed lookup; runs in Rust because the webview blocks the
/// cross-origin fetch.
#[tauri::command]
pub async fn fetch_youtube_title(video_id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || music::fetch_title(&video_id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn launch_agent_for_task(
    agent_cmd: String,
    task_id: String,
    task_file: String,
    project: String,
    vault_path: String,
) -> Result<(), String> {
    actions::launch_agent_for_task(&agent_cmd, &task_id, &task_file, &project, &vault_path)
}
