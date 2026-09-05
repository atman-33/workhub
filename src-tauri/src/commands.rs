use crate::mindmap;
use crate::mindmap_edit;
use crate::models::{
    BranchList, CommitFileChange, Config, GitInfo, GitLog, GraphOp, InputListenerDiagnostics,
    MindmapDoc, MindmapFile, ScheduleDoc, ScheduleFile, Task, VaultProject, Worktree,
};
use crate::music::{self, MusicData};
use crate::schedule;
use crate::schedule_edit;
use crate::tasks::{self, CreateTaskInput, UpdateTaskInput, WatcherState};
use crate::terminal::{self, TerminalState};
use crate::vault_note;
use crate::vault_project;
use crate::{actions, git, harness, storage, update};
use serde::Serialize;
use std::path::PathBuf;
use tauri::{Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

#[tauri::command]
pub fn get_config() -> Config {
    storage::load()
}

/// Persists `config` and returns the configuration that actually took effect.
/// The two differ when the vault changed: the newly selected vault's own
/// settings are adopted rather than overwritten (T-0206), so the caller must
/// render what comes back instead of what it sent.
#[tauri::command]
pub fn save_config(app: tauri::AppHandle, config: Config) -> Result<Config, String> {
    let before = storage::load().settings;
    let mut config = config;
    // Switching vaults: the vault-scoped settings belong to the vault being
    // opened, not to the one being left behind.
    if config.settings.vault_path != before.vault_path {
        crate::vault_settings::overlay(&mut config);
    }
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
    // Start/stop/retarget the clips key listener when its settings change.
    if config.settings.clips_enabled != before.clips_enabled
        || config.settings.clips_gesture != before.clips_gesture
    {
        crate::clips::apply_gesture(&app);
    }
    // Best-effort: keep the vault's harness config (.claude/project-context.json
    // and opencode.json's directory permissions) aligned with the registered
    // projects so agent sessions see them (harness contract).
    if let Some(vault) = config.settings.vault_path.as_deref() {
        if !vault.trim().is_empty() {
            let vault = std::path::Path::new(vault);
            let _ = harness::sync_project_context(vault, &config.projects);
            let _ = harness::sync_opencode_permissions(vault, &config.projects);
        }
    }
    Ok(config)
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

// ---------------------------------------------------------------------
// inbox notes (the vault's `inbox/` folder, T-0104)
// ---------------------------------------------------------------------

/// Lists the unfiled notes in the vault's `inbox/`, each with the tidy agent's
/// parked filing proposal when it has one.
///
/// The exclusion rules and the stale threshold come from the tidy settings
/// here rather than from the caller, so the tab cannot show a different set of
/// notes than the tidy routine acts on.
#[tauri::command]
pub async fn list_inbox_notes(vault_path: String) -> Result<Vec<crate::inbox::InboxNote>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let tidy = storage::load().settings.tidy;
        crate::inbox::list_notes(
            &PathBuf::from(vault_path),
            &tidy.exclude_dirs,
            tidy.stale_days,
        )
    })
    .await
    .map_err(|e| e.to_string())
}

/// Raw Markdown of one inbox note, for the preview pane.
#[tauri::command]
pub async fn read_inbox_note(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || crate::inbox::read_note(&PathBuf::from(path)))
        .await
        .map_err(|e| e.to_string())?
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

/// Opens Claude Desktop on a new session for a task with the prompt already
/// filled in, via the `claude://` URL scheme (T-0095). `mode` is the
/// `claude_desktop_mode` setting ("code" | "chat"); `description` is the task's
/// `## Description` text, used only by chat mode.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn send_task_to_claude_desktop(
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
    mode: String,
    description: String,
) -> Result<String, String> {
    let params = actions::LaunchAgentForTaskParams {
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
    };
    actions::send_task_to_claude_desktop(&params, &mode, &description)
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

// ---------------------------------------------------------------------
// ink captures
// ---------------------------------------------------------------------

/// Where annotated screen captures are written: the configured folder, else
/// the vault's `attachments/ink/`, else `~/.workhub/ink/` — drawing works
/// without a vault, so saving has to as well.
fn ink_dir() -> PathBuf {
    let config = storage::load();
    let configured = config.settings.ink_dir.trim().to_string();
    if !configured.is_empty() {
        return PathBuf::from(configured);
    }
    match config.settings.vault_path.as_deref() {
        Some(vault) if !vault.trim().is_empty() => {
            PathBuf::from(vault).join("attachments").join("ink")
        }
        _ => storage::config_dir().join("ink"),
    }
}

#[tauri::command]
pub fn ink_capture_dir() -> String {
    ink_dir().to_string_lossy().replace('\\', "/")
}

/// Tells the main window that the captures folder changed, so the Ink tab
/// refreshes its list without a manual pass. An Alt+C save happens in the
/// overlay, far from the tab that displays the result — without this the
/// list only caught up after a refresh click or a tab switch.
fn notify_captures_changed(app: &tauri::AppHandle) {
    let _ = app.emit_to("main", "ink://captures-changed", ());
}

/// Composes the overlay's strokes (base64 PNG, transparent) onto the screen
/// grab taken when drawing started, saves it, and copies it to the clipboard.
#[tauri::command]
pub fn save_ink_capture(app: tauri::AppHandle, base64_data: String) -> Result<String, String> {
    let result = crate::ink::store::save_capture(&app, &ink_dir(), &base64_data);
    if result.is_ok() {
        notify_captures_changed(&app);
    }
    result
}

/// Saves a cropped region of an existing capture beside it, and copies it.
#[tauri::command]
pub fn save_ink_crop(
    app: tauri::AppHandle,
    source_path: String,
    base64_data: String,
) -> Result<String, String> {
    let result = crate::ink::store::save_crop(&app, &PathBuf::from(source_path), &base64_data);
    if result.is_ok() {
        notify_captures_changed(&app);
    }
    result
}

#[tauri::command]
pub async fn list_ink_captures() -> Result<Vec<crate::ink::store::InkCapture>, String> {
    // Decoding a folder of full-screen PNGs for thumbnails is slow enough to
    // stutter the UI thread.
    tauri::async_runtime::spawn_blocking(move || crate::ink::store::list(&ink_dir()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn read_ink_capture(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || crate::ink::store::read_full(&PathBuf::from(path)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn copy_ink_capture(app: tauri::AppHandle, path: String) -> Result<(), String> {
    crate::ink::store::copy_to_clipboard(&app, &PathBuf::from(path))
}

/// Copies an image rendered by the frontend (a crop) to the clipboard.
#[tauri::command]
pub fn copy_ink_png(app: tauri::AppHandle, base64_data: String) -> Result<(), String> {
    crate::ink::store::copy_png(&app, &base64_data)
}

/// Sends a capture to the recycle bin, so a mis-click is recoverable.
#[tauri::command]
pub fn delete_ink_capture(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let result = crate::ink::store::delete(&PathBuf::from(path));
    if result.is_ok() {
        notify_captures_changed(&app);
    }
    result
}

/// Opens the floating preview window (move/resize/crop) on a saved capture.
#[tauri::command]
pub fn open_ink_preview(app: tauri::AppHandle, path: String) -> Result<(), String> {
    crate::ink_preview::open(&app, path).map_err(|e| e.to_string())
}

/// Hides the floating preview window — its ✕ and Esc both land here.
#[tauri::command]
pub fn ink_preview_hide(app: tauri::AppHandle) {
    crate::ink_preview::hide(&app);
}

/// Opens the task editor window on `payload` (the form's whole input; see
/// task_editor::open for why it is passed through opaquely).
#[tauri::command]
pub fn open_task_editor(app: tauri::AppHandle, payload: serde_json::Value) -> Result<(), String> {
    crate::task_editor::open(&app, payload).map_err(|e| e.to_string())
}

/// Hides the task editor window — its ✕ lands here.
#[tauri::command]
pub fn task_editor_hide(app: tauri::AppHandle) {
    crate::task_editor::hide(&app);
}

/// Asks the board to open the embedded terminal panel, because the editor
/// window is about to launch an agent into it. Emitted from Rust rather than
/// with the frontend's `emit` so it needs no extra ACL grant, like every other
/// cross-window event here. The name is the bridge module's
/// `TASK_EDITOR_TERMINAL_PANEL_EVENT`.
#[tauri::command]
pub fn task_editor_request_terminal_panel(app: tauri::AppHandle) {
    let _ = app.emit_to("main", "task-editor://open-terminal-panel", ());
}

/// Brings the main window to the front. Used after the editor window starts an
/// agent: the terminal panel the agent runs in lives in the main window, so
/// leaving the board behind the editor would hide the thing just launched.
#[tauri::command]
pub fn focus_main_window(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

#[tauri::command]
pub fn app_version() -> String {
    update::current_version().to_string()
}

/// Health of the shared global keyboard listener behind the ink and clips
/// gestures. Exposed so a user reporting "the Alt double-press stopped
/// working" can see whether keys are still arriving at all.
#[tauri::command]
pub fn input_listener_diagnostics() -> InputListenerDiagnostics {
    #[cfg(windows)]
    {
        crate::rawkey::diagnostics()
    }
    #[cfg(not(windows))]
    {
        InputListenerDiagnostics::default()
    }
}

/// Manual recovery for a listener that stopped delivering: re-apply the
/// gesture features from the current settings (so a consumer that got lost
/// comes back), then rebuild the listener thread and its raw-input
/// registration. Returns the fresh diagnostics so the UI can show the result.
#[tauri::command]
pub fn restart_input_listener(app: tauri::AppHandle) -> Result<InputListenerDiagnostics, String> {
    #[cfg(windows)]
    {
        let settings = storage::load().settings;
        if settings.ink_enabled {
            crate::ink::start(&app);
        }
        crate::clips::apply_gesture(&app);
        crate::rawkey::restart()?;
        Ok(crate::rawkey::diagnostics())
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Ok(InputListenerDiagnostics::default())
    }
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

// ---- schedule notes (T-0088..T-0091) -------------------------------------

/// Project slugs (folder names under the vault's `projects/`) available to the
/// schedule picker, including projects that hold no schedule note yet.
#[tauri::command]
pub async fn list_schedule_projects(vault_path: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        vault_note::list_projects(&PathBuf::from(vault_path))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Creates a vault project (`projects/<slug>/`) from the bundled scaffold, so
/// the schedule picker's project list can grow from inside the app (T-0178).
#[tauri::command]
pub async fn create_vault_project(
    vault_path: String,
    slug: String,
    name: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        vault_note::create_project(&PathBuf::from(vault_path), &slug, &name)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---- vault projects (T-0190) --------------------------------------------

/// Every project folder under the vault's `projects/`, with what it holds and
/// where it departs from the documented layout. `include_archived` adds the
/// folders under `archive/projects/`.
#[tauri::command]
pub async fn list_vault_projects(
    vault_path: String,
    include_archived: bool,
) -> Result<Vec<VaultProject>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        vault_project::list_projects(&PathBuf::from(vault_path), include_archived)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Moves `projects/<slug>/` to `archive/projects/<slug>/`. Returns the new
/// path. There is no delete: see the `vault_project` module docs.
#[tauri::command]
pub async fn archive_vault_project(vault_path: String, slug: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        vault_project::archive_project(&PathBuf::from(vault_path), &slug)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Moves an archived project back under `projects/`.
#[tauri::command]
pub async fn restore_vault_project(vault_path: String, slug: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        vault_project::restore_project(&PathBuf::from(vault_path), &slug)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Links a project to registered repositories by writing `repos:` into its
/// `_index.md` frontmatter, in the order given — the first is the project's
/// default repository. An empty list clears the link (T-0216).
#[tauri::command]
pub async fn set_vault_project_repos(
    vault_path: String,
    slug: String,
    repos: Vec<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        vault_project::set_project_repos(&PathBuf::from(vault_path), &slug, &repos)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Pins a project and records its manual sort position in `_index.md`
/// frontmatter. `order: null` clears the position, putting the project back
/// at the end of its group (T-0231).
#[tauri::command]
pub async fn set_vault_project_order(
    vault_path: String,
    slug: String,
    pinned: bool,
    order: Option<f64>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        vault_project::set_project_order(&PathBuf::from(vault_path), &slug, pinned, order)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Writes the project's display name and description into README.md
/// frontmatter. The folder slug is not renamed.
#[tauri::command]
pub async fn set_vault_project_details(
    vault_path: String,
    slug: String,
    name: String,
    summary: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        vault_project::set_project_details(&PathBuf::from(vault_path), &slug, &name, &summary)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Lists schedule notes, optionally narrowed to one project slug (pass an
/// empty string for "all projects").
#[tauri::command]
pub async fn list_schedules(
    vault_path: String,
    project: String,
) -> Result<Vec<ScheduleFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let project = (!project.trim().is_empty()).then_some(project);
        schedule::list_schedules(&PathBuf::from(vault_path), project.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn read_schedule(path: String) -> Result<ScheduleDoc, String> {
    tauri::async_runtime::spawn_blocking(move || schedule::read_schedule(&PathBuf::from(path)))
        .await
        .map_err(|e| e.to_string())?
}

/// Writes a schedule note, refusing when the file changed on disk since the
/// caller read it. Returns the new mtime for the next guarded write. Pass
/// `expected_mtime: 0` to write unconditionally.
#[tauri::command]
pub async fn write_schedule(
    path: String,
    content: String,
    expected_mtime: u64,
) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        schedule::write_schedule(&PathBuf::from(path), &content, expected_mtime)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_schedule(
    vault_path: String,
    project: String,
    title: String,
    range: String,
) -> Result<ScheduleFile, String> {
    tauri::async_runtime::spawn_blocking(move || {
        schedule::create_schedule(&PathBuf::from(vault_path), &project, &title, &range)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Renames a schedule note: its frontmatter `title` and its file name move
/// together, and its snapshot follows the new path. Returns the note at its new
/// location, so the caller can reselect it (T-0157).
#[tauri::command]
pub async fn rename_schedule(
    vault_path: String,
    path: String,
    title: String,
) -> Result<ScheduleFile, String> {
    tauri::async_runtime::spawn_blocking(move || {
        schedule::rename_schedule(&PathBuf::from(vault_path), &PathBuf::from(path), &title)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Writes a frontend-generated, self-contained HTML export to disk (T-0090).
#[tauri::command]
pub async fn export_schedule_html(out_path: String, html: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        schedule::export_html(&PathBuf::from(out_path), &html)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Launches a headless agent to apply a natural-language edit to a schedule
/// note (T-0091). Returns immediately; progress arrives on
/// `schedule-edit:status`.
#[tauri::command]
pub fn run_schedule_edit(
    app: tauri::AppHandle,
    path: String,
    instruction: String,
    confirm: bool,
) -> Result<String, String> {
    schedule_edit::run(app, path, instruction, confirm)
}

#[tauri::command]
pub fn schedule_edit_status(app: tauri::AppHandle) -> schedule_edit::ScheduleEditRun {
    schedule_edit::snapshot(&app)
}

/// Restores the snapshot taken before the last AI edit of this schedule.
#[tauri::command]
pub fn restore_schedule_snapshot(
    app: tauri::AppHandle,
    path: String,
) -> Result<ScheduleDoc, String> {
    schedule_edit::undo(app, path)
}

// ---- mindmap notes (T-0188) ---------------------------------------------

/// Lists mindmap notes, optionally narrowed to one project slug (pass an empty
/// string for "all projects").
#[tauri::command]
pub async fn list_mindmaps(
    vault_path: String,
    project: String,
) -> Result<Vec<MindmapFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let project = (!project.trim().is_empty()).then_some(project);
        mindmap::list_mindmaps(&PathBuf::from(vault_path), project.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn read_mindmap(path: String) -> Result<MindmapDoc, String> {
    tauri::async_runtime::spawn_blocking(move || mindmap::read_mindmap(&PathBuf::from(path)))
        .await
        .map_err(|e| e.to_string())?
}

/// Writes a mindmap note, refusing when the file changed on disk since the
/// caller read it. Returns the new mtime for the next guarded write. Pass
/// `expected_mtime: 0` to write unconditionally.
#[tauri::command]
pub async fn write_mindmap(
    path: String,
    content: String,
    expected_mtime: u64,
) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        mindmap::write_mindmap(&PathBuf::from(path), &content, expected_mtime)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_mindmap(
    vault_path: String,
    project: String,
    title: String,
) -> Result<MindmapFile, String> {
    tauri::async_runtime::spawn_blocking(move || {
        mindmap::create_mindmap(&PathBuf::from(vault_path), &project, &title)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Renames a mindmap note: its frontmatter `title` and its file name move
/// together, and its snapshot follows the new path.
#[tauri::command]
pub async fn rename_mindmap(
    vault_path: String,
    path: String,
    title: String,
) -> Result<MindmapFile, String> {
    tauri::async_runtime::spawn_blocking(move || {
        mindmap::rename_mindmap(&PathBuf::from(vault_path), &PathBuf::from(path), &title)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Moves a schedule note into `_ai/memory/schedule-trash/`. Returns where it
/// went, so the UI can tell the user where to find it.
#[tauri::command]
pub async fn delete_schedule(vault_path: String, path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        schedule::delete_schedule(&PathBuf::from(vault_path), &PathBuf::from(path))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Moves a mindmap note into `_ai/memory/mindmap-trash/`. Returns where it
/// went, so the UI can tell the user where to find it.
#[tauri::command]
pub async fn delete_mindmap(vault_path: String, path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        mindmap::delete_mindmap(&PathBuf::from(vault_path), &PathBuf::from(path))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Writes a frontend-generated, self-contained HTML or SVG export to disk.
#[tauri::command]
pub async fn export_mindmap_file(out_path: String, content: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        mindmap::export_file(&PathBuf::from(out_path), &content)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Writes a frontend-rendered PNG (base64, as `canvas.toDataURL` produces it).
#[tauri::command]
pub async fn export_mindmap_png(out_path: String, base64_data: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        mindmap::export_binary(&PathBuf::from(out_path), &base64_data)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Launches a headless agent to apply a natural-language edit to a mindmap
/// note. Returns immediately; progress arrives on `mindmap-edit:status`.
#[tauri::command]
pub fn run_mindmap_edit(
    app: tauri::AppHandle,
    path: String,
    instruction: String,
    confirm: bool,
) -> Result<String, String> {
    mindmap_edit::run(app, path, instruction, confirm)
}

#[tauri::command]
pub fn mindmap_edit_status(app: tauri::AppHandle) -> mindmap_edit::MindmapEditRun {
    mindmap_edit::snapshot(&app)
}

/// Restores the snapshot taken before the last AI edit of this mindmap.
#[tauri::command]
pub fn restore_mindmap_snapshot(app: tauri::AppHandle, path: String) -> Result<MindmapDoc, String> {
    mindmap_edit::undo(app, path)
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
        let _ = harness::sync_opencode_permissions(&vault, &config.projects);
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

/// Applies only the template updates that cannot destroy user content —
/// missing files (including seed-only ones the vault never received) and
/// files whose vault copy still matches the last-applied baseline.
/// Conflicting files are left for the update dialog. Returns the relative
/// paths that were written.
#[tauri::command]
pub async fn apply_safe_template_updates(vault_path: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        tasks::apply_safe_template_updates(&PathBuf::from(vault_path))
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
// clips: clibor-style snippet picker
// ---------------------------------------------------------------------

#[tauri::command]
pub async fn clips_list() -> Vec<crate::clips::store::Clip> {
    tauri::async_runtime::spawn_blocking(|| crate::clips::store::load().clips)
        .await
        .unwrap_or_default()
}

/// Replace the whole snippet list (the editor sends it back after any edit or
/// reorder — list order *is* the display order).
#[tauri::command]
pub async fn clips_save(clips: Vec<crate::clips::store::Clip>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::clips::store::save(&crate::clips::store::Clips { clips })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Hide the popup, restore focus to the app that had it, and paste the
/// snippet there. Blocking (it sleeps around the injected keystrokes), so it
/// runs off the UI thread.
#[tauri::command]
pub async fn clips_paste(app: tauri::AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || crate::clips::paste_clip(&app, &id))
        .await
        .map_err(|e| e.to_string())?
}

/// Hide the clips popup (Esc), remembering its position and size.
#[tauri::command]
pub fn clips_hide(app: tauri::AppHandle) {
    crate::clips::hide(&app);
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

// ---------------------------------------------------------------------
// persona plugin: character browser and the persisted default
// ---------------------------------------------------------------------

/// Every character the `persona` plugin could select. An empty list means the
/// plugin is not installed (or ships no characters); the Persona tab shows its
/// setup guidance in that case instead of hiding itself (T-0215).
#[tauri::command]
pub async fn persona_characters() -> Vec<crate::persona::PersonaCharacter> {
    tauri::async_runtime::spawn_blocking(crate::persona::discover_characters)
        .await
        .unwrap_or_default()
}

/// True when the standalone `genshijin` plugin is cached alongside `persona`.
/// Both inject per-turn style instructions, so the tab warns about the pair.
#[tauri::command]
pub async fn persona_genshijin_installed() -> bool {
    tauri::async_runtime::spawn_blocking(crate::persona::genshijin_installed)
        .await
        .unwrap_or(false)
}

#[tauri::command]
pub async fn persona_state() -> crate::persona::PersonaState {
    tauri::async_runtime::spawn_blocking(crate::persona::read_state)
        .await
        .unwrap_or_else(|_| crate::persona::read_state())
}

/// Writes the plugin's persisted default. Takes effect at the next
/// SessionStart — the running sessions' flag file is deliberately untouched.
#[tauri::command]
pub async fn set_persona_state(
    enabled: bool,
    character: Option<String>,
    level: String,
) -> Result<crate::persona::PersonaState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::persona::write_state(enabled, character, level)
    })
    .await
    .map_err(|e| format!("persona write task failed: {e}"))?
}

/// Sends a hand-made character to the OS recycle bin. Built-in characters are
/// refused — they belong to the plugin and would return with its next update.
/// Deleting the character the saved default names also clears that default.
#[tauri::command]
pub async fn delete_persona_character(id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || crate::persona::delete_character(&id))
        .await
        .map_err(|e| format!("persona delete task failed: {e}"))?
}

// ---------------------------------------------------------------------
// workhub marketplace plugins (Plugins tab)
// ---------------------------------------------------------------------

/// Everything the Plugins tab renders: the catalog, what is installed at which
/// version, what the marketplace clone offers, and what each settings file has
/// switched on. Reads local Claude Code state only — no network.
#[tauri::command]
pub async fn plugins_state(vault_path: String) -> crate::plugins::PluginsState {
    tauri::async_runtime::spawn_blocking(move || crate::plugins::read_state(&vault_path))
        .await
        .unwrap_or_else(|_| crate::plugins::read_state(""))
}

/// What one plugin actually contains — its skills, agents, commands and hooks
/// — read from the copy that is installed, not from the marketplace clone.
#[tauri::command]
pub async fn plugin_details(
    vault_path: String,
    name: String,
    marketplace: String,
    scope: String,
) -> crate::plugins::PluginDetails {
    tauri::async_runtime::spawn_blocking(move || {
        crate::plugins::read_details(&vault_path, &name, &marketplace, &scope)
    })
    .await
    .unwrap_or_default()
}

/// Adds or removes one `enabledPlugins` key in the vault's or the user's
/// `settings.json`. Takes effect in the next Claude Code session.
#[tauri::command]
pub async fn set_plugin_enabled(
    vault_path: String,
    name: String,
    marketplace: String,
    scope: String,
    enabled: bool,
) -> Result<crate::plugins::PluginsState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::plugins::set_enabled(&vault_path, &name, &marketplace, &scope, enabled)
    })
    .await
    .map_err(|e| format!("plugin settings write task failed: {e}"))?
}

/// `claude plugin marketplace update <marketplace>` — refreshes the clone every
/// "latest version" in the tab is compared against.
#[tauri::command]
pub async fn plugins_update_marketplace(
    vault_path: String,
    marketplace: String,
) -> Result<crate::plugins::PluginCommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::plugins::update_marketplace(&vault_path, &marketplace)
    })
    .await
    .map_err(|e| format!("marketplace update task failed: {e}"))?
}

/// `claude plugin update <name>@<marketplace> --scope <scope>`.
#[tauri::command]
pub async fn plugins_update_plugin(
    vault_path: String,
    name: String,
    marketplace: String,
    scope: String,
) -> Result<crate::plugins::PluginCommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::plugins::update_plugin(&vault_path, &name, &marketplace, &scope)
    })
    .await
    .map_err(|e| format!("plugin update task failed: {e}"))?
}
