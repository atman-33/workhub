use crate::models::{
    BranchList, CommitFileChange, Config, GitInfo, GitLog, GraphOp, Task, Worktree,
};
use crate::music::{self, MusicData};
use crate::tasks::{self, CreateTaskInput, UpdateTaskInput, WatcherState};
use crate::terminal::{self, TerminalState};
use crate::{actions, git, harness, storage, update};
use serde::Serialize;
use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_clipboard_manager::ClipboardExt;

#[tauri::command]
pub fn get_config() -> Config {
    storage::load()
}

#[tauri::command]
pub fn save_config(app: tauri::AppHandle, config: Config) -> Result<(), String> {
    let before = storage::load().settings;
    let mut config = config;
    // Seed the tidy schedule anchor the first time the routine is enabled so
    // the interval has a phase to count from (and the UI can show "next check").
    if config.settings.tidy.enabled && config.settings.tidy.anchor.is_none() {
        config.settings.tidy.anchor = Some(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0),
        );
    }
    storage::save(&config)?;
    // Start/stop the ink keyboard hook when the setting is toggled.
    if config.settings.ink_enabled != before.ink_enabled {
        if config.settings.ink_enabled {
            crate::ink::start(&app);
        } else {
            crate::ink::stop(&app);
        }
    }
    // Re-register the quick-capture hotkey when its settings change.
    if config.settings.quick_capture_enabled != before.quick_capture_enabled
        || config.settings.quick_capture_shortcut != before.quick_capture_shortcut
    {
        crate::quick_capture::apply_shortcut(&app);
    }
    // Re-register the voice-input hotkey when its settings change.
    if config.settings.voice_enabled != before.voice_enabled
        || config.settings.voice_hotkey != before.voice_hotkey
    {
        crate::voice::apply_shortcut(&app);
    }
    // Best-effort: keep the vault's .claude/project-context.json aligned with
    // the registered projects so agent sessions see them (harness contract).
    if let Some(vault) = config.settings.vault_path.as_deref() {
        if !vault.trim().is_empty() {
            let _ = harness::sync_project_context(std::path::Path::new(vault), &config.projects);
        }
    }
    Ok(())
}

/// Current state of the built-in vault-tidy runner (idle/running/completed/
/// failed + stall flag), for the settings panel.
#[tauri::command]
pub fn tidy_status(app: tauri::AppHandle) -> crate::tidy::TidyRun {
    crate::tidy::snapshot(&app)
}

/// Manually run the vault-tidy routine now. Works even when the schedule is
/// disabled. `force` bypasses the mechanical pre-check.
#[tauri::command]
pub fn run_vault_tidy_now(app: tauri::AppHandle, force: bool) -> Result<String, String> {
    crate::tidy::run_now(app, force)
}

/// Reopen the last tidy session in a terminal so the user can drive a stalled
/// or failed run interactively.
#[tauri::command]
pub fn resume_tidy_session(app: tauri::AppHandle) -> Result<String, String> {
    crate::tidy::resume(app)
}

#[tauri::command]
pub async fn git_status(path: String) -> GitInfo {
    tauri::async_runtime::spawn_blocking(move || git::read_status(&path))
        .await
        .unwrap_or_default()
}

/// List local and remote branches for the graph-view branch switcher.
#[tauri::command]
pub async fn list_branches(path: String) -> BranchList {
    tauri::async_runtime::spawn_blocking(move || git::list_branches(&path))
        .await
        .unwrap_or_default()
}

/// op: "fetch" | "pull" | "switch" (switch requires `branch`)
#[tauri::command]
pub async fn git_op(path: String, op: String, branch: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || match op.as_str() {
        "fetch" => git::fetch(&path),
        "pull" => git::pull(&path),
        // DWIM checkout: a remote-tracking ref (e.g. `origin/foo`) resolves to
        // its local tracking branch, creating it if needed — so the inline
        // switcher can target remote branches too.
        "switch" => git::checkout(&path, branch.as_deref().unwrap_or_default()),
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

/// List the files changed by a commit (or the uncommitted worktree).
#[tauri::command]
pub async fn git_commit_files(path: String, hash: String) -> Result<Vec<CommitFileChange>, String> {
    tauri::async_runtime::spawn_blocking(move || git::commit_files(&path, &hash))
        .await
        .map_err(|e| e.to_string())?
}

/// Unified diff of a single file within a commit (or the worktree).
#[tauri::command]
pub async fn git_commit_file_diff(
    path: String,
    hash: String,
    file: String,
    old_file: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git::commit_file_diff(&path, &hash, &file, old_file.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_remote_url(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || git::remote_url(&path))
        .await
        .map_err(|e| e.to_string())?
}

/// List the task worktrees across the given repos. Non-repos and errors are
/// skipped so one bad path doesn't fail the whole aggregate. The repo's main
/// working tree is included (flagged `is_main`); the frontend filters it out.
#[tauri::command]
pub async fn list_worktrees(paths: Vec<String>) -> Vec<Worktree> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut all = Vec::new();
        for p in &paths {
            let name = p.rsplit(['/', '\\']).find(|s| !s.is_empty()).unwrap_or(p);
            if let Ok(mut ws) = git::list_worktrees(p, name) {
                all.append(&mut ws);
            }
        }
        all
    })
    .await
    .unwrap_or_default()
}

/// Remove a linked worktree (`git worktree remove`). `force` is required to
/// remove a worktree with uncommitted/untracked changes.
#[tauri::command]
pub async fn remove_worktree(
    repo_path: String,
    worktree_path: String,
    force: bool,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git::remove_worktree(&repo_path, &worktree_path, force)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Delete a task branch (`git branch -d/-D`), separate from removing its
/// worktree. `force` uses `-D` to drop an unmerged branch.
#[tauri::command]
pub async fn delete_worktree_branch(
    repo_path: String,
    branch: String,
    force: bool,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || git::delete_branch(&repo_path, &branch, force))
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

/// Copies the agent prompt for a task to the system clipboard so the user can
/// paste it into another AI terminal manually.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn copy_task_prompt(
    app: tauri::AppHandle,
    assignee: String,
    task_id: String,
    task_title: String,
    task_file: String,
    project: String,
    model: String,
    confirm: bool,
    worktree: bool,
    vault_path: String,
    task_language: String,
    custom_prompt: String,
) -> Result<(), String> {
    let prompt = actions::build_agent_prompt(&actions::LaunchAgentForTaskParams {
        agent_cmd: "",
        assignee: &assignee,
        task_id: &task_id,
        task_title: &task_title,
        task_file: &task_file,
        project: &project,
        model: &model,
        confirm,
        worktree,
        vault_path: &vault_path,
        use_herdr: false,
        herdr_cmd: "",
        terminal_embed: false,
        task_language: &task_language,
        custom_prompt: &custom_prompt,
    });
    app.clipboard()
        .write_text(prompt)
        .map_err(|e| format!("failed to copy prompt: {e}"))
}

/// Models available to the opencode CLI (`opencode models`), as
/// `provider/model` ids for the task dialog's suggestions.
#[tauri::command]
pub async fn opencode_models() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(actions::opencode_models)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn open_explorer(path: String) -> Result<(), String> {
    actions::open_explorer(&path.replace('/', "\\"))
}

#[tauri::command]
pub fn open_in_obsidian(path: String) -> Result<(), String> {
    actions::open_in_obsidian(&path)
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

/// True when the long-term memory engine has been set up on this machine —
/// i.e. the marker written by the `memory-setup` agent skill exists under
/// `~/.workhub/memory-engine/` and parses. The app only ever *checks*; the
/// setup itself runs in an agent session (heavy npm install + model
/// download, with interactive recovery on failure).
#[tauri::command]
pub fn memory_setup_ok() -> bool {
    let marker = storage::config_dir()
        .join("memory-engine")
        .join(".setup-version");
    std::fs::read_to_string(marker)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .is_some_and(|v| v.get("version").is_some_and(serde_json::Value::is_u64))
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

/// Moves the task's Markdown file to the OS recycle bin.
#[tauri::command]
pub async fn delete_task(vault_path: String, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        tasks::delete_task(&PathBuf::from(vault_path), &id)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// `vault-template/` is embedded into the binary at compile time (see
/// `tasks::VAULT_TEMPLATE`), so there is no filesystem template path to pass
/// in anymore — this works the same in dev and in a packaged single-exe
/// build.
#[tauri::command]
pub async fn init_vault(vault_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let vault = PathBuf::from(vault_path);
        tasks::init_vault(&vault)?;
        // Seed the harness config with the currently registered projects
        // (best-effort — a fresh vault already has the template default).
        let config = storage::load();
        let _ = harness::sync_project_context(&vault, &config.projects);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 3-way compares the embedded template against `vault_path`'s current
/// content and the last-applied baseline (`_ai/template-manifest.json`),
/// classifying every non-initial-only template file as added/updatable/
/// conflicting/up-to-date.
#[tauri::command]
pub async fn check_vault_template(vault_path: String) -> Result<tasks::TemplateDiff, String> {
    tauri::async_runtime::spawn_blocking(move || {
        tasks::check_vault_template(&PathBuf::from(vault_path))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Applies the embedded template content for exactly the given relative
/// `paths` (as returned by `check_vault_template`'s `TemplateDiff`). Paths
/// currently in `Conflict` are written beside the original as `<name>.new`
/// rather than overwriting it, unless they are also listed in `overwrite` —
/// the user's explicit choice to discard local edits for that file. See
/// `tasks::apply_vault_template` for the full policy.
#[tauri::command]
pub async fn apply_vault_template(
    vault_path: String,
    paths: Vec<String>,
    overwrite: Vec<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        tasks::apply_vault_template(&PathBuf::from(vault_path), &paths, &overwrite)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Renders the unified diff between the vault's current copy of `path` and
/// the embedded template's version, for previewing a template update (and in
/// particular what an overwrite of a conflicting file would discard).
#[tauri::command]
pub async fn preview_vault_template_file(
    vault_path: String,
    path: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        tasks::template_file_diff(&PathBuf::from(vault_path), &path)
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

/// Writes a playlist export to a path picked in a save dialog.
#[tauri::command]
pub async fn export_playlist_file(path: String, contents: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        music::export_playlists(&PathBuf::from(path), &contents)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Reads a playlist export picked in an open dialog.
#[tauri::command]
pub async fn import_playlist_file(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || music::import_playlists(&PathBuf::from(path)))
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
#[allow(clippy::too_many_arguments)]
pub fn launch_agent_for_task(
    agent_cmd: String,
    assignee: String,
    task_id: String,
    task_title: String,
    task_file: String,
    project: String,
    model: String,
    confirm: bool,
    worktree: bool,
    vault_path: String,
    use_herdr: bool,
    herdr_cmd: String,
    terminal_embed: bool,
    task_language: String,
    custom_prompt: String,
) -> Result<String, String> {
    actions::launch_agent_for_task(actions::LaunchAgentForTaskParams {
        agent_cmd: &agent_cmd,
        assignee: &assignee,
        task_id: &task_id,
        task_title: &task_title,
        task_file: &task_file,
        project: &project,
        model: &model,
        confirm,
        worktree,
        vault_path: &vault_path,
        use_herdr,
        herdr_cmd: &herdr_cmd,
        terminal_embed,
        task_language: &task_language,
        custom_prompt: &custom_prompt,
    })
}

// ---------------------------------------------------------------------
// embedded terminal (xterm.js + ConPTY running the herdr client)
// ---------------------------------------------------------------------

/// Opens (or reuses) a PTY session running the configured herdr client and
/// streams its output over the ordered `on_output` IPC channel.
/// Returns `true` when an existing session was reused.
#[tauri::command]
pub fn terminal_open(
    app: tauri::AppHandle,
    state: tauri::State<'_, TerminalState>,
    id: String,
    cols: u16,
    rows: u16,
    on_output: tauri::ipc::Channel<String>,
) -> Result<bool, String> {
    terminal::open(app, &state, id, cols, rows, on_output)
}

#[tauri::command]
pub fn terminal_write(
    state: tauri::State<'_, TerminalState>,
    id: String,
    data: String,
) -> Result<(), String> {
    terminal::write(&state, &id, &data)
}

#[tauri::command]
pub fn terminal_resize(
    state: tauri::State<'_, TerminalState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    terminal::resize(&state, &id, cols, rows)
}

/// Async + spawn_blocking: close waits for the child process to fully exit
/// (see `terminal::close`), which must not run on the UI thread.
#[tauri::command]
pub async fn terminal_close(app: tauri::AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<TerminalState>();
        terminal::close(&state, &id)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Hide the quick-capture window (Esc / after a successful save), remembering
/// its position and size for the next open.
#[tauri::command]
pub fn quick_capture_hide(app: tauri::AppHandle) {
    crate::quick_capture::hide(&app);
}

// ---------------------------------------------------------------------
// voice input: local speech-to-text (whisper.cpp model management)
// ---------------------------------------------------------------------

/// Per-model download/active status for the Settings > Voice tab.
#[tauri::command]
pub async fn stt_model_status() -> Vec<crate::stt::ModelStatus> {
    tauri::async_runtime::spawn_blocking(crate::stt::model_status)
        .await
        .unwrap_or_default()
}

/// Downloads and checksum-verifies a whisper.cpp ggml model. Progress is
/// streamed via `stt:download-progress` / `-done` / `-error` events.
#[tauri::command]
pub async fn stt_download_model(app: tauri::AppHandle, model: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || crate::stt::download_model(&app, &model))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn stt_delete_model(model: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || crate::stt::delete_model(&model))
        .await
        .map_err(|e| e.to_string())?
}

/// Stop button on the indicator: same stop path as a second hotkey press
/// while recording; a no-op in any other phase.
#[tauri::command]
pub fn voice_stop_recording(app: tauri::AppHandle) {
    crate::voice::stop_recording_command(&app);
}

// ---------------------------------------------------------------------
// voice input: transcript history (safety net for lost-focus pastes)
// ---------------------------------------------------------------------

#[tauri::command]
pub async fn voice_history_list() -> Vec<crate::voice_history::HistoryEntry> {
    tauri::async_runtime::spawn_blocking(|| crate::voice_history::load().entries)
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub async fn voice_history_delete(id: String) {
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let mut history = crate::voice_history::load();
        history.delete(&id);
        crate::voice_history::save(&history);
    })
    .await;
}

#[tauri::command]
pub async fn voice_history_clear() {
    let _ = tauri::async_runtime::spawn_blocking(|| {
        let mut history = crate::voice_history::load();
        history.clear();
        crate::voice_history::save(&history);
    })
    .await;
}
