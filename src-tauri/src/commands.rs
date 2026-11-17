use crate::diagram_edit;
use crate::docs::{self, DocsEntry, DocsRootStatus};
use crate::mindmap;
use crate::models::{
    BacklogItem, BranchList, CommitFileChange, Config, DocsShortcut, GitInfo, GitLog, GraphOp,
    InputListenerDiagnostics, MindmapDoc, MindmapFile, ScheduleDoc, ScheduleFile, Task,
    VaultProject, Worktree,
};
use crate::music::{self, MusicData};
use crate::schedule;
use crate::settings_save;
use crate::tasks::{self, CreateTaskInput, UpdateTaskInput};
use crate::terminal::{self, TerminalState};
use crate::vault_note;
use crate::vault_project;
use crate::vault_template;
use crate::vault_watch::{self, WatcherState};
use crate::{actions, git, harness, storage, update};
use serde::Serialize;
use std::path::PathBuf;
use tauri::{Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

// ---------------------------------------------------------------------
// blocking adapters
//
// Domain functions do blocking I/O (files, git, child processes), so an async
// command hands them to the blocking pool. These helpers are the one place
// that does so and turns a failed join (the closure panicked or the runtime
// shut down) into the command's error. Pick the one that matches what the
// command returns.
// ---------------------------------------------------------------------

/// For a closure that already returns `Result<T, String>`: a join failure
/// becomes `Err(<join error>)`, anything else passes through untouched.
async fn blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

/// Same as [`blocking`], but the join failure reads `"<what> task failed: ..."`
/// so the caller can tell which command's task died.
async fn blocking_named<T, F>(what: &str, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("{what} task failed: {e}"))?
}

/// For a closure that returns a plain value: only a join failure is an error.
async fn blocking_value<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())
}

/// For a read whose failure is "nothing to show": a join failure yields the
/// default value instead of an error.
async fn blocking_or_default<T, F>(f: F) -> T
where
    T: Default + Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .unwrap_or_default()
}

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
    settings_save::prepare(&before, &mut config, settings_save::now_secs());
    storage::save(&config)?;

    let effects = settings_save::effects(&before, &config.settings);
    // Register/unregister start-with-Windows when the setting is toggled.
    if let Some(on) = effects.autostart {
        crate::apply_autostart(&app, on);
    }
    // Start/stop the ink keyboard hook when the setting is toggled.
    match effects.ink {
        Some(true) => crate::ink::start(&app),
        Some(false) => crate::ink::stop(&app),
        None => {}
    }
    // Re-register the quick-capture hotkey when its settings change.
    if effects.quick_capture {
        crate::quick_capture::apply_shortcut(&app);
    }
    // Re-register the voice-input hotkey when its settings change.
    if effects.voice {
        crate::voice::apply_shortcut(&app);
    }
    // Start/stop/retarget the clips key listener when its settings change.
    if effects.clips {
        crate::clips::apply_gesture(&app);
    }
    // Best-effort: keep the vault's harness config (.claude/project-context.json
    // and opencode.json's directory permissions) aligned with the registered
    // projects so agent sessions see them (harness contract).
    if let Some(vault) = config.settings.vault_path.as_deref() {
        if !vault.trim().is_empty() {
            harness::sync_vault(
                std::path::Path::new(vault),
                &config.projects,
                &config.settings.worktree_root,
            );
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
    blocking_value(move || {
        let tidy = storage::load().settings.tidy;
        crate::inbox::list_notes(
            &PathBuf::from(vault_path),
            &tidy.exclude_dirs,
            tidy.stale_days,
        )
    })
    .await
}

/// Raw Markdown of one inbox note, for the preview pane.
#[tauri::command]
pub async fn read_inbox_note(path: String) -> Result<String, String> {
    blocking(move || crate::inbox::read_note(&PathBuf::from(path))).await
}

#[tauri::command]
pub async fn git_status(path: String) -> GitInfo {
    blocking_or_default(move || git::read_status(&path)).await
}

/// List local and remote branches for the graph-view branch switcher.
#[tauri::command]
pub async fn list_branches(path: String) -> BranchList {
    blocking_or_default(move || git::list_branches(&path)).await
}

/// op: "fetch" | "pull" | "switch" (switch requires `branch`)
#[tauri::command]
pub async fn git_op(path: String, op: String, branch: Option<String>) -> Result<String, String> {
    blocking(move || match op.as_str() {
        "fetch" => git::fetch(&path),
        "pull" => git::pull(&path),
        // DWIM checkout: a remote-tracking ref (e.g. `origin/foo`) resolves to
        // its local tracking branch, creating it if needed — so the inline
        // switcher can target remote branches too.
        "switch" => git::checkout(&path, branch.as_deref().unwrap_or_default()),
        other => Err(format!("unknown git op: {other}")),
    })
    .await
}

/// Read a page of commit history for the graph view. `extra_branches` and
/// `show_all` restrict which refs are walked (T-0408); `request_id` names
/// this load so it can be cancelled via `git_log_cancel`.
#[tauri::command]
pub async fn git_log(
    path: String,
    limit: u32,
    skip: u32,
    extra_branches: Vec<String>,
    show_all: bool,
    request_id: String,
) -> Result<GitLog, String> {
    blocking(move || git::read_log(&path, limit, skip, &extra_branches, show_all, &request_id))
        .await
}

/// Kill the `git log` child process started under `request_id`, if it is
/// still running (e.g. the user narrowed the branch filter, closed the
/// graph, or a newer load superseded it).
#[tauri::command]
pub fn git_log_cancel(request_id: String) {
    git::cancel_log(&request_id);
}

/// The default refs `git_log` would use with no extra branches selected
/// (HEAD, the default branch, and their upstreams), for the branch-filter
/// popover to mark as always shown.
#[tauri::command]
pub async fn git_default_log_refs(path: String) -> Vec<String> {
    blocking_or_default(move || git::default_log_refs(&path)).await
}

/// Run a graph-view git operation (checkout, branch/tag create-delete, merge,
/// rebase, push/pull/fetch, reset, cherry-pick).
#[tauri::command]
pub async fn git_graph_op(path: String, op: GraphOp) -> Result<String, String> {
    blocking(move || git::graph_op(&path, op)).await
}

/// List the files changed by a commit (or the uncommitted worktree).
#[tauri::command]
pub async fn git_commit_files(path: String, hash: String) -> Result<Vec<CommitFileChange>, String> {
    blocking(move || git::commit_files(&path, &hash)).await
}

/// Unified diff of a single file within a commit (or the worktree).
#[tauri::command]
pub async fn git_commit_file_diff(
    path: String,
    hash: String,
    file: String,
    old_file: Option<String>,
) -> Result<String, String> {
    blocking(move || git::commit_file_diff(&path, &hash, &file, old_file.as_deref())).await
}

#[tauri::command]
pub async fn git_remote_url(path: String) -> Result<String, String> {
    blocking(move || git::remote_url(&path)).await
}

/// List the task worktrees across the given repos. Non-repos and errors are
/// skipped so one bad path doesn't fail the whole aggregate. The repo's main
/// working tree is included (flagged `is_main`); the frontend filters it out.
#[tauri::command]
pub async fn list_worktrees(paths: Vec<String>) -> Vec<Worktree> {
    blocking_or_default(move || {
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
}

/// Remove a linked worktree (`git worktree remove`). `force` is required to
/// remove a worktree with uncommitted/untracked changes.
#[tauri::command]
pub async fn remove_worktree(
    repo_path: String,
    worktree_path: String,
    force: bool,
) -> Result<String, String> {
    blocking(move || git::remove_worktree(&repo_path, &worktree_path, force)).await
}

/// Delete a task branch (`git branch -d/-D`), separate from removing its
/// worktree. `force` uses `-D` to drop an unmerged branch.
#[tauri::command]
pub async fn delete_worktree_branch(
    repo_path: String,
    branch: String,
    force: bool,
) -> Result<String, String> {
    blocking(move || git::delete_branch(&repo_path, &branch, force)).await
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
/// paste it into another AI terminal manually. `multiline` is the
/// `prompt_copy_multiline` setting — one instruction per line when it is on
/// (T-0285).
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
    worktree_root: String,
    vault_path: String,
    language: String,
    custom_prompt: String,
    multiline: bool,
) -> Result<(), String> {
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
        worktree_root: &worktree_root,
        vault_path: &vault_path,
        use_herdr: false,
        herdr_cmd: "",
        terminal_embed: false,
        language: &language,
        custom_prompt: &custom_prompt,
    };
    let prompt = if multiline {
        actions::build_agent_prompt_multiline(&params)
    } else {
        actions::build_agent_prompt(&params)
    };
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
    worktree_root: String,
    vault_path: String,
    language: String,
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
        worktree_root: &worktree_root,
        vault_path: &vault_path,
        use_herdr: false,
        herdr_cmd: "",
        terminal_embed: false,
        language: &language,
        custom_prompt: &custom_prompt,
    };
    actions::send_task_to_claude_desktop(&params, &mode, &description)
}

/// Models available to the opencode CLI (`opencode models`), as
/// `provider/model` ids for the task dialog's suggestions.
#[tauri::command]
pub async fn opencode_models() -> Result<Vec<String>, String> {
    blocking(actions::opencode_models).await
}

/// Off the main thread: revealing a file goes through the shell, which can
/// stall on a slow or network path (a WSL share, a mapped drive).
#[tauri::command]
pub async fn open_explorer(path: String) -> Result<(), String> {
    blocking(move || actions::open_explorer(&path.replace('/', "\\"))).await
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

/// Sent by the ink overlay page once its event listeners are registered.
#[tauri::command]
pub fn ink_overlay_ready() {
    crate::ink::overlay_ready();
}

/// Sent by the ink overlay page for every activation it receives, so a dead
/// page can be told apart from a live one and rebuilt.
#[tauri::command]
pub fn ink_overlay_ack(seq: u64) {
    crate::ink::overlay_ack(seq);
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
    blocking(move || crate::ink::store::list(&ink_dir())).await
}

#[tauri::command]
pub async fn read_ink_capture(path: String) -> Result<String, String> {
    blocking(move || crate::ink::store::read_full(&PathBuf::from(path))).await
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

/// Reveals the main window, which starts hidden so the saved zoom can be
/// applied before the first paint (T-0491). The frontend calls it once the
/// zoom is in place; `lib.rs` has a timer for when it never does.
#[tauri::command]
pub fn reveal_main_window(app: tauri::AppHandle) {
    crate::reveal_main_window(&app);
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
/// comes back), replace the ink overlay window (the keys can be arriving
/// while the page that draws them is dead), then rebuild the listener thread
/// and its raw-input registration. Returns the fresh diagnostics so the UI
/// can show the result.
#[tauri::command]
pub fn restart_input_listener(app: tauri::AppHandle) -> Result<InputListenerDiagnostics, String> {
    #[cfg(windows)]
    {
        let settings = storage::load().settings;
        if settings.ink_enabled {
            crate::ink::start(&app);
            crate::ink::rebuild_overlay(&app);
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

/// The app's own diagnostic log, most recent lines last. A release build has
/// no console, so this command (and the log file it mirrors) is the only way
/// a user can see what the app recorded — see `diag.rs`.
#[tauri::command]
pub fn diagnostic_log(limit: Option<usize>) -> Vec<crate::diag::DiagEntry> {
    crate::diag::entries(limit)
}

/// Where the log file is and how large it has grown, so the panel can offer
/// to open the folder and show the user what they would be attaching to a
/// bug report.
#[tauri::command]
pub fn diagnostic_log_info() -> crate::diag::DiagLogInfo {
    crate::diag::info()
}

/// The longest frontend error the log will accept. A stack trace from a
/// bundled build is a handful of frames; anything past this is a runaway
/// message, and the log is capped by rotation rather than by retention.
const MAX_FRONTEND_ERROR: usize = 4000;

/// Records a crash the webview reported (an uncaught error, a rejected
/// promise, or a React render that an error boundary caught).
///
/// A packaged build has no console, so before this existed a frontend
/// exception left no trace at all: the window went blank and there was
/// nothing to read afterwards (T-0254). What arrives here is the error's own
/// message and stack — app behaviour, never note or task content — and it is
/// truncated so one runaway string cannot rotate the log out from under the
/// lines around it.
#[tauri::command]
pub fn log_frontend_error(context: String, message: String, stack: Option<String>) {
    let mut text = format!("frontend error [{context}]: {message}");
    if let Some(stack) = stack.filter(|s| !s.trim().is_empty()) {
        text.push('\n');
        text.push_str(&stack);
    }
    if text.chars().count() > MAX_FRONTEND_ERROR {
        text = text.chars().take(MAX_FRONTEND_ERROR).collect::<String>() + " …(truncated)";
    }
    crate::diag!("{text}");
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
    blocking(move || update::apply_update(&url)).await
}

#[tauri::command]
pub fn restart_app(app: tauri::AppHandle) {
    // `restart` skips the window's CloseRequested, so save the main window's
    // geometry here or the update would reopen it where it last settled (T-1275).
    crate::main_window_state::save(&app);
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

/// Whether `vault_path` has had the vault template applied to it.
///
/// Deliberately separate from [`check_vault_path`], which answers only "is
/// this a folder" — an empty folder passes that and is a perfectly valid thing
/// to choose, it just has no template in it yet. The two questions have
/// different answers during first-run setup, and conflating them is what let a
/// fresh install land on an empty board with no vault behind it (T-0297).
///
/// The marker is `_ai/template-manifest.json`, which `init_vault` writes and
/// which the template updater already treats as the record of what was
/// applied; nothing else has to be invented to recognise an initialized vault.
#[tauri::command]
pub fn vault_initialized(vault_path: String) -> bool {
    let vault = vault_path.trim();
    !vault.is_empty()
        && std::path::PathBuf::from(vault)
            .join("_ai")
            .join("template-manifest.json")
            .is_file()
}

#[tauri::command]
pub async fn list_tasks(vault_path: String) -> Result<Vec<Task>, String> {
    blocking(move || tasks::scan_and_index(&PathBuf::from(vault_path))).await
}

#[tauri::command]
pub async fn create_task(vault_path: String, input: CreateTaskInput) -> Result<Task, String> {
    blocking(move || tasks::create_task(&PathBuf::from(vault_path), input)).await
}

/// Breaking-change notices that apply to this vault and are still unread.
///
/// The read list is read here rather than passed in: `notices_read` is
/// vault-scoped, so the config the frontend holds may belong to a vault the
/// user has since switched away from, and a notice suppressed by the wrong
/// vault's list is a notice nobody ever sees.
#[tauri::command]
pub async fn notices(vault_path: String) -> Result<Vec<crate::notices::Notice>, String> {
    blocking(move || {
        let read = storage::load().settings.notices_read;
        Ok(crate::notices::pending(&PathBuf::from(vault_path), &read))
    })
    .await
}

#[tauri::command]
pub async fn update_task(vault_path: String, input: UpdateTaskInput) -> Result<Task, String> {
    blocking(move || tasks::update_task(&PathBuf::from(vault_path), input)).await
}

/// Moves the task's Markdown file to the OS recycle bin.
#[tauri::command]
pub async fn delete_task(vault_path: String, id: String) -> Result<(), String> {
    blocking(move || tasks::delete_task(&PathBuf::from(vault_path), &id)).await
}

// ---- schedule notes (T-0088..T-0091) -------------------------------------

/// Project slugs (folder names under the vault's `projects/`) available to the
/// schedule picker, including projects that hold no schedule note yet.
#[tauri::command]
pub async fn list_schedule_projects(vault_path: String) -> Result<Vec<String>, String> {
    blocking(move || vault_note::list_projects(&PathBuf::from(vault_path))).await
}

/// Resolves a project slug to its real folder under `projects/` — which may
/// carry a `NNNN-` sort prefix the slug itself never includes — or `None`
/// when no folder answers to it. The frontend must go through this rather
/// than string-concatenating `projects/<slug>/`, since that guess is wrong
/// for every numbered project and silently creates a second, empty one
/// (T-0379).
#[tauri::command]
pub async fn resolve_project_dir(
    vault_path: String,
    slug: String,
) -> Result<Option<String>, String> {
    blocking(move || {
        let vault = PathBuf::from(vault_path);
        let dir = vault_note::resolve_project_dir(&vault_note::projects_dir(&vault), &slug)?;
        Ok(dir.map(|p| vault_note::norm_path(&p)))
    })
    .await
}

/// Creates a vault project (`projects/<slug>/`) from the bundled scaffold, so
/// the schedule picker's project list can grow from inside the app (T-0178).
#[tauri::command]
pub async fn create_vault_project(
    vault_path: String,
    slug: String,
    name: String,
) -> Result<(), String> {
    blocking(move || vault_note::create_project(&PathBuf::from(vault_path), &slug, &name)).await
}

/// The folder name `create_vault_project` will give a new project with this
/// slug — `NNNN-<slug>`, with the sort number the vault would allocate right
/// now — so the create dialog can show it before the folder exists (T-0278).
#[tauri::command]
pub async fn next_project_folder(vault_path: String, slug: String) -> Result<String, String> {
    blocking(move || vault_note::next_project_folder(&PathBuf::from(vault_path), &slug)).await
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
    blocking(move || vault_project::list_projects(&PathBuf::from(vault_path), include_archived))
        .await
}

/// The backlog items of one project, for the task editor's item picker.
/// Empty — never an error — when the project has no `backlog/` folder, so the
/// picker degrades to "no items" instead of failing the form (T-0253).
#[tauri::command]
pub async fn list_backlog_items(
    vault_path: String,
    slug: String,
) -> Result<Vec<BacklogItem>, String> {
    blocking(move || vault_project::list_backlog_items(&PathBuf::from(vault_path), &slug)).await
}

/// Opens a task's backlog item in Obsidian (T-0660). Obsidian's URI cannot
/// open a folder, so the item's entry note is opened; an item without one
/// falls back to its folder in Explorer. An error when the item is not found.
#[tauri::command]
pub async fn open_backlog_item(
    vault_path: String,
    slug: String,
    backlog: String,
) -> Result<(), String> {
    blocking(move || {
        let found = vault_project::find_backlog_item(&PathBuf::from(vault_path), &slug, &backlog)?
            .ok_or_else(|| format!("backlog item {backlog} not found in {slug}"))?;
        match found.note {
            Some(note) => actions::open_in_obsidian(&note.to_string_lossy()),
            None => actions::open_explorer(&found.folder.to_string_lossy().replace('/', "\\")),
        }
    })
    .await
}

/// Creates a backlog item in a project from a title and returns it, so the
/// task editor can offer "new item" instead of sending the user off to
/// Obsidian. Naming an item has to be cheaper than skipping it (T-0266).
#[tauri::command]
pub async fn create_backlog_item(
    vault_path: String,
    slug: String,
    title: String,
) -> Result<BacklogItem, String> {
    blocking(move || vault_project::create_backlog_item(&PathBuf::from(vault_path), &slug, &title))
        .await
}

/// Moves `projects/<slug>/` to `archive/projects/<slug>/`. Returns the new
/// path. There is no delete: see the `vault_project` module docs.
#[tauri::command]
pub async fn archive_vault_project(vault_path: String, slug: String) -> Result<String, String> {
    blocking(move || vault_project::archive_project(&PathBuf::from(vault_path), &slug)).await
}

/// Moves an archived project back under `projects/`.
#[tauri::command]
pub async fn restore_vault_project(vault_path: String, slug: String) -> Result<String, String> {
    blocking(move || vault_project::restore_project(&PathBuf::from(vault_path), &slug)).await
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
    blocking(move || vault_project::set_project_repos(&PathBuf::from(vault_path), &slug, &repos))
        .await
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
    blocking(move || {
        vault_project::set_project_order(&PathBuf::from(vault_path), &slug, pinned, order)
    })
    .await
}

/// Sets or clears (empty `alias`) the project's session-name alias in
/// README.md frontmatter, refusing a malformed or already-used one (T-0562).
#[tauri::command]
pub async fn set_vault_project_alias(
    vault_path: String,
    slug: String,
    alias: String,
) -> Result<(), String> {
    blocking(move || vault_project::set_project_alias(&PathBuf::from(vault_path), &slug, &alias))
        .await
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
    blocking(move || {
        vault_project::set_project_details(&PathBuf::from(vault_path), &slug, &name, &summary)
    })
    .await
}

/// Lists schedule notes, optionally narrowed to one project slug (pass an
/// empty string for "all projects").
#[tauri::command]
pub async fn list_schedules(
    vault_path: String,
    project: String,
) -> Result<Vec<ScheduleFile>, String> {
    blocking(move || {
        let project = (!project.trim().is_empty()).then_some(project);
        schedule::list_schedules(&PathBuf::from(vault_path), project.as_deref())
    })
    .await
}

#[tauri::command]
pub async fn read_schedule(path: String) -> Result<ScheduleDoc, String> {
    blocking(move || schedule::read_schedule(&PathBuf::from(path))).await
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
    blocking(move || schedule::write_schedule(&PathBuf::from(path), &content, expected_mtime)).await
}

#[tauri::command]
pub async fn create_schedule(
    vault_path: String,
    project: String,
    title: String,
    range: String,
) -> Result<ScheduleFile, String> {
    blocking(move || {
        schedule::create_schedule(&PathBuf::from(vault_path), &project, &title, &range)
    })
    .await
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
    blocking(move || {
        schedule::rename_schedule(&PathBuf::from(vault_path), &PathBuf::from(path), &title)
    })
    .await
}

/// Writes a frontend-generated, self-contained HTML export to disk (T-0090).
///
/// `vault_path`/`project` are set only when `out_path` is the vault's own
/// default destination (`<vault>/projects/<slug>/attachments/...`) — never a
/// user-configured export directory — so the write can be refused rather than
/// inventing the project folder when the slug does not resolve (T-0379).
#[tauri::command]
pub async fn export_schedule_html(
    out_path: String,
    html: String,
    vault_path: Option<String>,
    project: Option<String>,
) -> Result<(), String> {
    blocking(move || {
        schedule::export_html(
            vault_path.as_deref().map(PathBuf::from).as_deref(),
            project.as_deref(),
            &PathBuf::from(out_path),
            &html,
        )
    })
    .await
}

/// Launches a headless agent to apply a natural-language edit to a diagram
/// note of any kind (T-0685). Returns immediately; progress arrives on
/// `diagram-edit:status`.
#[tauri::command]
pub fn run_diagram_edit(
    app: tauri::AppHandle,
    path: String,
    instruction: String,
    confirm: bool,
) -> Result<String, String> {
    diagram_edit::run(app, path, instruction, confirm)
}

/// Copies the diagram-edit prompt for `path` to the clipboard, for pasting into
/// an interactive agent session. `instruction` may be empty.
#[tauri::command]
pub fn copy_diagram_edit_prompt(
    app: tauri::AppHandle,
    path: String,
    instruction: String,
    confirm: bool,
) -> Result<(), String> {
    let prompt = diagram_edit::build_copy_prompt(
        &path.replace('\\', "/"),
        &instruction,
        confirm,
        &storage::load().settings.language,
    );
    app.clipboard()
        .write_text(prompt)
        .map_err(|e| format!("failed to copy prompt: {e}"))
}

#[tauri::command]
pub fn diagram_edit_status(app: tauri::AppHandle) -> diagram_edit::DiagramEditRun {
    diagram_edit::snapshot(&app)
}

/// Restores the snapshot taken before the last AI edit of this diagram.
#[tauri::command]
pub fn restore_diagram_snapshot(
    app: tauri::AppHandle,
    path: String,
) -> Result<crate::diagram::DiagramDoc, String> {
    diagram_edit::undo(app, path)
}

/// Whether an undo snapshot exists for this diagram.
#[tauri::command]
pub fn has_snapshot(path: String) -> bool {
    let cfg = storage::load();
    match cfg.settings.vault_path.as_deref() {
        Some(v) if !v.trim().is_empty() => crate::diagram::has_snapshot(
            &PathBuf::from(v.replace('\\', "/")),
            &PathBuf::from(path.replace('\\', "/")),
        ),
        _ => false,
    }
}

// ---- Docs tab: read-only browsing of shared Markdown (T-0259) -----------
//
// The roots these commands are allowed to reach are read from the config
// here, never taken from the caller — see `docs::resolve_within_roots`. There
// is no write command in this section on purpose: the whole point of the tab
// is that nothing of ours ever lands in a folder the team shares.

/// The registered roots, each resolved against this machine.
#[tauri::command]
pub fn docs_roots() -> Vec<DocsRootStatus> {
    docs::root_statuses(&storage::load().settings)
}

/// Registers a folder as a document root and returns the new list. The path
/// is stored as given (vault-scoped, shared with the team); a machine whose
/// mount differs overrides it with `set_docs_root_local_path`.
#[tauri::command]
pub fn add_docs_root(path: String, name: String) -> Result<Vec<DocsRootStatus>, String> {
    storage::update(|cfg| {
        docs::add_root(&mut cfg.settings.docs_roots, &path, &name)?;
        Ok(docs::root_statuses(&cfg.settings))
    })
}

/// Forgets a root. Only the registration goes — nothing on the share is
/// touched, here or anywhere else in this module.
#[tauri::command]
pub fn remove_docs_root(id: String) -> Result<Vec<DocsRootStatus>, String> {
    storage::update(|cfg| {
        docs::remove_root(&mut cfg.settings.docs_roots, &id);
        Ok(docs::root_statuses(&cfg.settings))
    })
}

/// Updates a root's name and folder together.
///
/// They were two commands behind two buttons, which made editing a root feel
/// like two unrelated operations. One dialog writes both.
#[tauri::command]
pub fn update_docs_root(
    id: String,
    name: String,
    path: String,
) -> Result<Vec<DocsRootStatus>, String> {
    storage::update(|cfg| {
        docs::update_root(&mut cfg.settings.docs_roots, &id, &name, &path)?;
        Ok(docs::root_statuses(&cfg.settings))
    })
}

/// Opens a file inside a registered root with whatever the OS associates with
/// it. Markdown is rendered in the tab itself; this is for everything else a
/// team share holds - PDFs, spreadsheets, images.
#[tauri::command]
pub async fn docs_open_external(path: String) -> Result<(), String> {
    blocking(move || docs::guarded_open_external(&storage::load().settings, &path)).await
}

/// Shows a file or folder inside a registered root in the OS file manager,
/// selected in its parent folder.
#[tauri::command]
pub async fn docs_reveal(path: String) -> Result<(), String> {
    blocking(move || docs::guarded_reveal(&storage::load().settings, &path)).await
}

/// Lists one directory inside a registered root. Never recurses — the tree
/// calls again when a folder is opened, so a streamed share is only ever
/// touched where the user is actually looking.
#[tauri::command]
pub async fn docs_list_dir(path: String) -> Result<Vec<DocsEntry>, String> {
    blocking(move || docs::guarded_list_dir(&storage::load().settings, &path)).await
}

#[tauri::command]
pub async fn docs_read_file(path: String) -> Result<String, String> {
    blocking(move || docs::guarded_read_doc(&storage::load().settings, &path)).await
}

/// Reads an image a document embeds and returns it as a `data:` URI.
#[tauri::command]
pub async fn docs_read_asset(path: String) -> Result<String, String> {
    blocking(move || docs::guarded_read_asset(&storage::load().settings, &path)).await
}

/// Resolves a pasted absolute path against this machine's roots (T-0362).
///
/// A teammate's path names a file on *their* machine; the mounts here may
/// disagree, so the backend answers with a direct hit or longest-tail
/// candidates rather than the frontend guessing at strings.
#[tauri::command]
pub async fn docs_resolve_open_path(
    pasted: String,
    current_root: Option<String>,
) -> Result<docs::OpenPathResolution, String> {
    blocking(move || {
        docs::guarded_resolve_open_path(
            &storage::load().settings,
            &pasted,
            current_root.as_deref().unwrap_or(""),
        )
    })
    .await
}

/// Resolves an Obsidian `[[wikilink]]` written in the document `from` (T-0726).
///
/// `target` is the link's file part: the frontend splits off the `|alias` and
/// the `#heading` before calling. A bare name is looked up across the vault by
/// file name (Obsidian's rule); a `folder/name` narrows it to a path. Anything
/// the backend cannot pin to exactly one file comes back as an empty or an
/// ambiguous resolution — never a guess — and the frontend points at Obsidian
/// instead. Every returned path already passed the containment guard.
#[tauri::command]
pub async fn docs_resolve_wikilink(
    from: String,
    target: String,
) -> Result<docs::WikiLinkResolution, String> {
    blocking(move || docs::guarded_resolve_wikilink(&storage::load().settings, &from, &target))
        .await
}

/// The PlantUML server the Docs tab renders diagrams with; "" when rendering
/// is off (the default).
/// The starred folders and files, in the order the Shortcuts section shows
/// them.
#[tauri::command]
pub fn docs_shortcuts() -> Vec<DocsShortcut> {
    storage::load().settings.docs_shortcuts
}

/// Replaces the whole shortcut list. Adding, removing and reordering are one
/// command because the list is the order: a per-entry command would have to
/// carry a position anyway, and two of them could disagree about it.
#[tauri::command]
pub fn set_docs_shortcuts(shortcuts: Vec<DocsShortcut>) -> Result<(), String> {
    storage::update(|cfg| {
        cfg.settings.docs_shortcuts = shortcuts;
        Ok(())
    })
}

/// Whether the sidebar is split into a folder tree and a file list (T-0276).
#[tauri::command]
pub fn docs_list_pane() -> bool {
    storage::load().settings.docs_list_pane
}

#[tauri::command]
pub fn set_docs_list_pane(enabled: bool) -> Result<(), String> {
    storage::update(|cfg| {
        cfg.settings.docs_list_pane = enabled;
        Ok(())
    })
}

/// Whether the Docs tab loads images from `https:` URLs (T-0329).
#[tauri::command]
pub fn docs_allow_remote_images() -> bool {
    storage::load().settings.docs_allow_remote_images
}

#[tauri::command]
pub fn set_docs_allow_remote_images(enabled: bool) -> Result<(), String> {
    storage::update(|cfg| {
        cfg.settings.docs_allow_remote_images = enabled;
        Ok(())
    })
}

/// Whether the Docs tab lists dot-folders and dot-files (T-0394).
#[tauri::command]
pub fn docs_show_hidden() -> bool {
    storage::load().settings.docs_show_hidden
}

#[tauri::command]
pub fn set_docs_show_hidden(enabled: bool) -> Result<(), String> {
    storage::update(|cfg| {
        cfg.settings.docs_show_hidden = enabled;
        Ok(())
    })
}

#[tauri::command]
pub fn docs_plantuml_server() -> String {
    storage::load().settings.docs_plantuml_server
}

/// Sets the PlantUML server. An empty string turns rendering off.
#[tauri::command]
pub fn set_docs_plantuml_server(server: String) -> Result<(), String> {
    let server = docs::normalize_plantuml_server(&server)?;
    storage::update(|cfg| {
        cfg.settings.docs_plantuml_server = server;
        Ok(())
    })
}

/// Renders a PlantUML diagram on the configured server and returns the SVG.
/// Fails without contacting anything when no server is set.
#[tauri::command]
pub async fn docs_render_plantuml(source: String) -> Result<String, String> {
    blocking(move || {
        crate::plantuml::render(&storage::load().settings.docs_plantuml_server, &source)
    })
    .await
}

/// Opens a Docs viewer window on `payload` (a document or one figure).
///
/// `async` on purpose: building a window from a synchronous command deadlocks
/// on Windows, and unlike the pre-built helper windows this one is built on
/// every call.
#[tauri::command]
pub async fn open_docs_viewer(
    app: tauri::AppHandle,
    payload: serde_json::Value,
) -> Result<(), String> {
    crate::docs_viewer::open(&app, payload)
}

/// What the calling Docs viewer window was opened to show.
#[tauri::command]
pub fn docs_viewer_payload(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Option<serde_json::Value> {
    crate::docs_viewer::payload(&app, window.label())
}

// ---- diagrams (T-0680) ----------------------------------------------------

/// Lists every diagram note (Schedule, Mindmap and the newer kinds) by its
/// frontmatter `type`, wherever it sits under `projects/`. Pass an empty
/// string for "all projects".
#[tauri::command]
pub async fn list_diagrams(
    vault_path: String,
    project: String,
) -> Result<Vec<crate::diagram::DiagramFile>, String> {
    blocking(move || {
        let project = (!project.trim().is_empty()).then_some(project);
        crate::diagram::list_diagrams(&PathBuf::from(vault_path), project.as_deref())
    })
    .await
}

/// Creates a diagram note. `backlog` is a `B-NNN` item id to put it inside, or
/// empty for the project-wide folder; `range` is only read for a schedule.
#[tauri::command]
pub async fn create_diagram(
    vault_path: String,
    project: String,
    kind: String,
    title: String,
    backlog: String,
    range: String,
) -> Result<crate::diagram::DiagramFile, String> {
    blocking(move || {
        crate::diagram::create_diagram(
            &PathBuf::from(vault_path),
            &project,
            &kind,
            &title,
            &backlog,
            &range,
        )
    })
    .await
}

/// Reads a diagram note of any kind: the whole text plus the mtime that guards
/// the next [`write_diagram`].
#[tauri::command]
pub async fn read_diagram(path: String) -> Result<crate::diagram::DiagramDoc, String> {
    blocking(move || crate::diagram::read_diagram(&PathBuf::from(path))).await
}

/// Writes a diagram note, refusing when the file changed on disk since the
/// caller read it (`expected_mtime` 0 skips the check). Returns the new mtime.
#[tauri::command]
pub async fn write_diagram(
    path: String,
    content: String,
    expected_mtime: u64,
) -> Result<u64, String> {
    blocking(move || crate::diagram::write_diagram(&PathBuf::from(path), &content, expected_mtime))
        .await
}

/// Renames a diagram note: its frontmatter `title` and its file name move
/// together. Returns the note at its new path, which the caller must reselect.
#[tauri::command]
pub async fn rename_diagram(
    vault_path: String,
    path: String,
    title: String,
) -> Result<crate::diagram::DiagramFile, String> {
    blocking(move || {
        crate::diagram::rename_diagram(&PathBuf::from(vault_path), &PathBuf::from(path), &title)
    })
    .await
}

/// Moves a diagram note into `_ai/state/diagram-trash/`. Returns where it went.
#[tauri::command]
pub async fn delete_diagram(vault_path: String, path: String) -> Result<String, String> {
    blocking(move || {
        crate::diagram::delete_diagram(&PathBuf::from(vault_path), &PathBuf::from(path))
    })
    .await
}

/// Writes a frontend-generated HTML or SVG export of any diagram kind. Same
/// destination rules as [`export_mindmap_file`] (T-0379).
#[tauri::command]
pub async fn export_diagram_file(
    out_path: String,
    content: String,
    vault_path: Option<String>,
    project: Option<String>,
) -> Result<(), String> {
    export_mindmap_file(out_path, content, vault_path, project).await
}

/// Writes a frontend-rendered PNG (base64) of any diagram kind. Same
/// destination rules as [`export_mindmap_file`] (T-0379).
#[tauri::command]
pub async fn export_diagram_png(
    out_path: String,
    base64_data: String,
    vault_path: Option<String>,
    project: Option<String>,
) -> Result<(), String> {
    export_mindmap_png(out_path, base64_data, vault_path, project).await
}

// ---- mindmap notes (T-0188) ---------------------------------------------

/// Lists mindmap notes, optionally narrowed to one project slug (pass an empty
/// string for "all projects").
#[tauri::command]
pub async fn list_mindmaps(
    vault_path: String,
    project: String,
) -> Result<Vec<MindmapFile>, String> {
    blocking(move || {
        let project = (!project.trim().is_empty()).then_some(project);
        mindmap::list_mindmaps(&PathBuf::from(vault_path), project.as_deref())
    })
    .await
}

#[tauri::command]
pub async fn read_mindmap(path: String) -> Result<MindmapDoc, String> {
    blocking(move || mindmap::read_mindmap(&PathBuf::from(path))).await
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
    blocking(move || mindmap::write_mindmap(&PathBuf::from(path), &content, expected_mtime)).await
}

#[tauri::command]
pub async fn create_mindmap(
    vault_path: String,
    project: String,
    title: String,
) -> Result<MindmapFile, String> {
    blocking(move || mindmap::create_mindmap(&PathBuf::from(vault_path), &project, &title)).await
}

/// Renames a mindmap note: its frontmatter `title` and its file name move
/// together, and its snapshot follows the new path.
#[tauri::command]
pub async fn rename_mindmap(
    vault_path: String,
    path: String,
    title: String,
) -> Result<MindmapFile, String> {
    blocking(move || {
        mindmap::rename_mindmap(&PathBuf::from(vault_path), &PathBuf::from(path), &title)
    })
    .await
}

/// Moves a schedule note into `_ai/state/schedule-trash/`. Returns where it
/// went, so the UI can tell the user where to find it.
#[tauri::command]
pub async fn delete_schedule(vault_path: String, path: String) -> Result<String, String> {
    blocking(move || schedule::delete_schedule(&PathBuf::from(vault_path), &PathBuf::from(path)))
        .await
}

/// Moves a mindmap note into `_ai/state/mindmap-trash/`. Returns where it
/// went, so the UI can tell the user where to find it.
#[tauri::command]
pub async fn delete_mindmap(vault_path: String, path: String) -> Result<String, String> {
    blocking(move || mindmap::delete_mindmap(&PathBuf::from(vault_path), &PathBuf::from(path)))
        .await
}

/// Writes a frontend-generated, self-contained HTML or SVG export to disk.
///
/// `vault_path`/`project` are set only when `out_path` is the vault's own
/// default destination (`<vault>/projects/<slug>/attachments/...`), so the
/// write can be refused rather than inventing the project folder when the
/// slug does not resolve (T-0379).
#[tauri::command]
pub async fn export_mindmap_file(
    out_path: String,
    content: String,
    vault_path: Option<String>,
    project: Option<String>,
) -> Result<(), String> {
    blocking(move || {
        mindmap::export_file(
            vault_path.as_deref().map(PathBuf::from).as_deref(),
            project.as_deref(),
            &PathBuf::from(out_path),
            &content,
        )
    })
    .await
}

/// Writes a frontend-rendered PNG (base64, as `canvas.toDataURL` produces it).
///
/// `vault_path`/`project` are set only when `out_path` is the vault's own
/// default destination — see [`export_mindmap_file`] (T-0379).
#[tauri::command]
pub async fn export_mindmap_png(
    out_path: String,
    base64_data: String,
    vault_path: Option<String>,
    project: Option<String>,
) -> Result<(), String> {
    blocking(move || {
        mindmap::export_binary(
            vault_path.as_deref().map(PathBuf::from).as_deref(),
            project.as_deref(),
            &PathBuf::from(out_path),
            &base64_data,
        )
    })
    .await
}

/// `vault-template/` is embedded into the binary at compile time (see
/// `vault_template::VAULT_TEMPLATE`), so there is no filesystem template path to pass
/// in anymore — this works the same in dev and in a packaged single-exe
/// build.
#[tauri::command]
pub async fn init_vault(vault_path: String) -> Result<(), String> {
    blocking(move || {
        let vault = PathBuf::from(vault_path);
        vault_template::init_vault(&vault)?;
        // Seed the harness config with the currently registered projects
        // (best-effort — a fresh vault already has the template default).
        let config = storage::load();
        harness::sync_vault(&vault, &config.projects, &config.settings.worktree_root);
        Ok(())
    })
    .await
}

/// 3-way compares the embedded template against `vault_path`'s current
/// content and the last-applied baseline (`_ai/template-manifest.json`),
/// classifying every non-initial-only template file as added/updatable/
/// conflicting/up-to-date.
#[tauri::command]
pub async fn check_vault_template(
    vault_path: String,
) -> Result<vault_template::TemplateDiff, String> {
    blocking(move || vault_template::check_vault_template(&PathBuf::from(vault_path))).await
}

/// Applies the embedded template content for exactly the given relative
/// `paths` (as returned by `check_vault_template`'s `TemplateDiff`). Paths
/// currently in `Conflict` keep the vault's file untouched and only advance
/// that path's baseline to the new template (dismiss-this-version) unless
/// they are also listed in `overwrite` — the user's explicit choice to
/// discard local edits for that file, in which case the prior content is
/// first saved as `<name>.bak` and the template is written in place. See
/// `vault_template::apply_vault_template` for the full policy.
#[tauri::command]
pub async fn apply_vault_template(
    vault_path: String,
    paths: Vec<String>,
    overwrite: Vec<String>,
) -> Result<(), String> {
    blocking(move || {
        vault_template::apply_vault_template(&PathBuf::from(vault_path), &paths, &overwrite)
    })
    .await
}

/// Removes the listed files that the template no longer ships and whose
/// vault copy is still byte-identical to what it shipped, and drops their
/// manifest entries. Every path is re-checked at this moment, so a selection
/// made against a stale dialog can only do less, never more; directories are
/// never removed. Returns the paths actually removed.
#[tauri::command]
pub async fn remove_template_orphans(
    vault_path: String,
    paths: Vec<String>,
) -> Result<Vec<String>, String> {
    blocking(move || vault_template::remove_template_orphans(&PathBuf::from(vault_path), &paths))
        .await
}

/// Keeps the listed files that the template no longer ships and drops their
/// manifest entries, so they are never offered for removal again. Every
/// path is re-classified at this moment; unknown paths are skipped.
/// Returns the paths actually retained. No file is written or deleted.
#[tauri::command]
pub async fn retain_template_orphans(
    vault_path: String,
    paths: Vec<String>,
) -> Result<Vec<String>, String> {
    blocking(move || vault_template::retain_template_orphans(&PathBuf::from(vault_path), &paths))
        .await
}

/// Applies only the template updates that cannot destroy user content —
/// missing files (including seed-only ones the vault never received) and
/// files whose vault copy still matches the last-applied baseline.
/// Conflicting files are left for the update dialog. Returns the relative
/// paths that were written.
#[tauri::command]
pub async fn apply_safe_template_updates(vault_path: String) -> Result<Vec<String>, String> {
    blocking(move || vault_template::apply_safe_template_updates(&PathBuf::from(vault_path))).await
}

/// Renders the unified diff between the vault's current copy of `path` and
/// the embedded template's version, for previewing a template update (and in
/// particular what an overwrite of a conflicting file would discard).
#[tauri::command]
pub async fn preview_vault_template_file(
    vault_path: String,
    path: String,
) -> Result<String, String> {
    blocking(move || vault_template::template_file_diff(&PathBuf::from(vault_path), &path)).await
}

/// (Re)starts watching `<vault_path>/tasks` for changes. Call whenever the
/// configured vault path is set or changes.
#[tauri::command]
pub fn watch_vault(
    app: tauri::AppHandle,
    state: tauri::State<'_, WatcherState>,
    vault_path: String,
) -> Result<(), String> {
    vault_watch::start_watcher(app, &state.0, PathBuf::from(vault_path))
}

// ---------------------------------------------------------------------
// music player (vault-backed)
// ---------------------------------------------------------------------

/// Returns None until the first save so the frontend can seed defaults.
#[tauri::command]
pub async fn load_music_data(vault_path: String) -> Result<Option<MusicData>, String> {
    blocking(move || music::load(&PathBuf::from(vault_path))).await
}

#[tauri::command]
pub async fn save_music_data(vault_path: String, data: MusicData) -> Result<(), String> {
    blocking(move || music::save(&PathBuf::from(vault_path), &data)).await
}

/// Writes a playlist export to a path picked in a save dialog.
#[tauri::command]
pub async fn export_playlist_file(path: String, contents: String) -> Result<(), String> {
    blocking(move || music::export_playlists(&PathBuf::from(path), &contents)).await
}

/// Reads a playlist export picked in an open dialog.
#[tauri::command]
pub async fn import_playlist_file(path: String) -> Result<String, String> {
    blocking(move || music::import_playlists(&PathBuf::from(path))).await
}

/// YouTube oEmbed lookup; runs in Rust because the webview blocks the
/// cross-origin fetch.
#[tauri::command]
pub async fn fetch_youtube_title(video_id: String) -> Result<String, String> {
    blocking(move || music::fetch_title(&video_id)).await
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
    worktree_root: String,
    vault_path: String,
    use_herdr: bool,
    herdr_cmd: String,
    terminal_embed: bool,
    language: String,
    custom_prompt: String,
    force: bool,
) -> Result<String, String> {
    if !force && !vault_path.is_empty() {
        tasks::check_startable(&PathBuf::from(&vault_path), &task_id)?;
    }
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
        worktree_root: &worktree_root,
        vault_path: &vault_path,
        use_herdr,
        herdr_cmd: &herdr_cmd,
        terminal_embed,
        language: &language,
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
    blocking(move || {
        let state = app.state::<TerminalState>();
        terminal::close(&state, &id)
    })
    .await
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
    blocking_or_default(|| crate::clips::store::load().clips).await
}

/// Replace the whole snippet list (the editor sends it back after any edit or
/// reorder — list order *is* the display order).
#[tauri::command]
pub async fn clips_save(clips: Vec<crate::clips::store::Clip>) -> Result<(), String> {
    blocking(move || crate::clips::store::save(&crate::clips::store::Clips { clips })).await
}

/// Hide the popup, restore focus to the app that had it, and paste the
/// snippet there. Blocking (it sleeps around the injected keystrokes), so it
/// runs off the UI thread.
#[tauri::command]
pub async fn clips_paste(app: tauri::AppHandle, id: String) -> Result<(), String> {
    blocking(move || crate::clips::paste_clip(&app, &id)).await
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
    blocking_or_default(crate::stt::model_status).await
}

/// Downloads and checksum-verifies a whisper.cpp ggml model. Progress is
/// streamed via `stt:download-progress` / `-done` / `-error` events.
#[tauri::command]
pub async fn stt_download_model(app: tauri::AppHandle, model: String) -> Result<(), String> {
    blocking(move || crate::stt::download_model(&app, &model)).await
}

#[tauri::command]
pub async fn stt_delete_model(model: String) -> Result<(), String> {
    blocking(move || crate::stt::delete_model(&model)).await
}

/// Stop button on the indicator: same stop path as a second hotkey press
/// while recording; a no-op in any other phase.
#[tauri::command]
pub fn voice_stop_recording(app: tauri::AppHandle) {
    crate::voice::stop_recording_command(&app);
}

/// Discard button on the indicator: abandons the dictation session without
/// pasting or keeping anything. Works while recording and while transcribing;
/// a no-op in any other phase.
#[tauri::command]
pub fn voice_cancel_recording(app: tauri::AppHandle) {
    crate::voice::cancel_recording(&app);
}

/// Live capture state (recording / held) for the Meeting panel (T-0333).
#[tauri::command]
pub fn voice_capture_status(app: tauri::AppHandle) -> crate::voice::CaptureStatus {
    crate::voice::capture_status(&app)
}

// ---------------------------------------------------------------------
// voice input: transcript history (safety net for lost-focus pastes)
// ---------------------------------------------------------------------

#[tauri::command]
pub async fn voice_history_list() -> Vec<crate::voice_history::HistoryEntry> {
    blocking_or_default(|| crate::voice_history::load().entries).await
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
// voice meeting mode: accumulate dictation transcripts into a file
// ---------------------------------------------------------------------

/// Starts a meeting session (idempotent while one is active).
#[tauri::command]
pub fn voice_meeting_start(
    app: tauri::AppHandle,
) -> Result<crate::voice_meeting::MeetingInfo, String> {
    crate::voice_meeting::start(&app)
}

/// Stops the active meeting session, if any. The file stays on disk.
#[tauri::command]
pub fn voice_meeting_finish(app: tauri::AppHandle) -> Option<crate::voice_meeting::MeetingInfo> {
    crate::voice_meeting::finish(&app)
}

/// The currently active meeting, if any.
#[tauri::command]
pub fn voice_meeting_status(app: tauri::AppHandle) -> Option<crate::voice_meeting::MeetingInfo> {
    crate::voice_meeting::status(&app)
}

/// All meetings on disk, newest first.
#[tauri::command]
pub async fn voice_meeting_list() -> Vec<crate::voice_meeting::MeetingInfo> {
    blocking_or_default(crate::voice_meeting::list).await
}

/// Full Markdown of one meeting.
#[tauri::command]
pub async fn voice_meeting_read(id: String) -> Result<String, String> {
    blocking(move || crate::voice_meeting::read(&id)).await
}

/// Deletes one meeting file.
#[tauri::command]
pub async fn voice_meeting_delete(id: String) -> Result<(), String> {
    blocking(move || crate::voice_meeting::delete(&id)).await
}

/// The copy-paste prompt that turns a meeting transcript into minutes
/// (decisions / action items / open questions) in an agent of choice.
#[tauri::command]
pub async fn voice_meeting_prompt(id: String) -> Result<String, String> {
    blocking(move || crate::voice_meeting::structuring_prompt(&id)).await
}

/// Periodic structuring status for the active meeting, if any (T-0318).
#[tauri::command]
pub fn voice_struct_status(app: tauri::AppHandle) -> Option<crate::voice_struct::StructStatus> {
    crate::voice_struct::status(&app)
}

/// Structures the active meeting's new transcript now, outside the periodic
/// schedule (T-0318).
#[tauri::command]
pub fn voice_struct_run_now(app: tauri::AppHandle) -> Result<String, String> {
    crate::voice_struct::run_now(app)
}

/// Full Markdown of one meeting's auto-structured minutes, or empty when no
/// run has produced any yet (T-0318).
#[tauri::command]
pub async fn voice_meeting_minutes(id: String) -> Result<String, String> {
    blocking_value(move || crate::voice_struct::read_minutes(&id)).await
}

/// Full text of one meeting's struct run log, or empty when no run has
/// logged anything yet (T-0333).
#[tauri::command]
pub async fn voice_struct_log(id: String) -> Result<String, String> {
    blocking_value(move || crate::voice_struct::read_struct_log(&id)).await
}

/// Debug repro of the active meeting's struct run in a visible terminal
/// (T-0337). Fire-and-forget; touches no run state and writes no minutes.
#[tauri::command]
pub fn voice_struct_repro(app: tauri::AppHandle) -> Result<String, String> {
    crate::voice_struct::repro_in_terminal(&app)
}

// ---------------------------------------------------------------------
// persona plugin: character browser and the persisted default
// ---------------------------------------------------------------------

/// Every character the `persona` plugin could select. An empty list means the
/// plugin is not installed (or ships no characters); the Persona tab shows its
/// setup guidance in that case instead of hiding itself (T-0215).
#[tauri::command]
pub async fn persona_characters() -> Vec<crate::persona::PersonaCharacter> {
    blocking_or_default(crate::persona::discover_characters).await
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
    blocking_named("persona write", move || {
        crate::persona::write_state(enabled, character, level)
    })
    .await
}

/// Sends a hand-made character to the OS recycle bin. Built-in characters are
/// refused — they belong to the plugin and would return with its next update.
/// Deleting the character the saved default names also clears that default.
#[tauri::command]
pub async fn delete_persona_character(id: String) -> Result<String, String> {
    blocking_named("persona delete", move || {
        crate::persona::delete_character(&id)
    })
    .await
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
    blocking_or_default(move || {
        crate::plugins::read_details(&vault_path, &name, &marketplace, &scope)
    })
    .await
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
    blocking_named("plugin settings write", move || {
        crate::plugins::set_enabled(&vault_path, &name, &marketplace, &scope, enabled)
    })
    .await
}

/// `claude plugin marketplace update <marketplace>` — refreshes the clone every
/// "latest version" in the tab is compared against.
#[tauri::command]
pub async fn plugins_update_marketplace(
    vault_path: String,
    marketplace: String,
) -> Result<crate::plugins::PluginCommandResult, String> {
    blocking_named("marketplace update", move || {
        crate::plugins::update_marketplace(&vault_path, &marketplace)
    })
    .await
}

/// `claude plugin marketplace add atman-33/workhub` — first-run registration.
///
/// Takes no source: see `plugins::MARKETPLACE_SOURCE` for why the form is
/// fixed. Already registered succeeds without shelling out.
#[tauri::command]
pub async fn plugins_add_marketplace(
    vault_path: String,
) -> Result<crate::plugins::PluginCommandResult, String> {
    blocking_named("marketplace add", move || {
        crate::plugins::add_marketplace(&vault_path)
    })
    .await
}

/// `claude plugin update <name>@<marketplace> --scope <scope>`.
#[tauri::command]
pub async fn plugins_update_plugin(
    vault_path: String,
    name: String,
    marketplace: String,
    scope: String,
) -> Result<crate::plugins::PluginCommandResult, String> {
    blocking_named("plugin update", move || {
        crate::plugins::update_plugin(&vault_path, &name, &marketplace, &scope)
    })
    .await
}

/// `claude plugin install <name>@<marketplace> --scope <scope>`.
#[tauri::command]
pub async fn plugins_install_plugin(
    vault_path: String,
    name: String,
    marketplace: String,
    scope: String,
) -> Result<crate::plugins::PluginCommandResult, String> {
    blocking_named("plugin install", move || {
        crate::plugins::install_plugin(&vault_path, &name, &marketplace, &scope)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::async_runtime::block_on;

    #[test]
    fn blocking_passes_the_closures_result_through() {
        assert_eq!(block_on(blocking(|| Ok::<_, String>(7))), Ok(7));
        assert_eq!(
            block_on(blocking(|| Err::<u8, _>("boom".to_string()))),
            Err("boom".to_string())
        );
    }

    #[test]
    fn blocking_reports_a_panicked_task_as_the_join_error() {
        let err = block_on(blocking(|| -> Result<u8, String> { panic!("x") })).unwrap_err();
        assert!(err.contains("panicked"), "{err}");
    }

    #[test]
    fn blocking_named_prefixes_a_panicked_task() {
        let err = block_on(blocking_named(
            "plugin install",
            || -> Result<u8, String> { panic!("x") },
        ))
        .unwrap_err();
        assert!(err.starts_with("plugin install task failed: "), "{err}");
        assert!(err.contains("panicked"), "{err}");
        assert_eq!(
            block_on(blocking_named("plugin install", || Ok::<_, String>(1))),
            Ok(1)
        );
    }

    #[test]
    fn blocking_value_wraps_the_value_and_reports_a_panic() {
        assert_eq!(block_on(blocking_value(|| 3)), Ok(3));
        let err = block_on(blocking_value(|| -> u8 { panic!("x") })).unwrap_err();
        assert!(err.contains("panicked"), "{err}");
    }

    #[test]
    fn blocking_or_default_swallows_a_panic() {
        assert_eq!(block_on(blocking_or_default(|| 5u8)), 5);
        assert_eq!(
            block_on(blocking_or_default(|| -> Vec<u8> { panic!("x") })),
            Vec::<u8>::new()
        );
    }
}
