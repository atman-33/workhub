mod actions;
mod b64;
mod caret;
mod clips;
mod commands;
mod diag;
mod docs;
mod git;
mod harness;
mod herdr;
mod inbox;
mod ink;
mod ink_preview;
mod mindmap;
mod mindmap_edit;
mod models;
mod music;
mod paste;
mod persona;
mod plugins;
mod quick_capture;
mod rawkey;
mod schedule;
mod schedule_edit;
mod storage;
mod stt;
mod task_editor;
mod tasks;
mod terminal;
mod tidy;
mod update;
mod vault_note;
mod vault_project;
mod vault_settings;
mod voice;
mod voice_chunk;
mod voice_history;
mod window_place;
mod wsl;

use tauri::Manager;

/// One line saying what the app started with. Deliberately a snapshot of the
/// *settings*, not of the machine: which features are on, and which vault is
/// configured, are the first two questions any bug report raises.
fn log_startup_settings(cfg: &models::Config) {
    let s = &cfg.settings;
    crate::diag!(
        "config: vault={} autostart={} ink={} clips={} quick-capture={} voice={} (model={}, indicator={})",
        s.vault_path.as_deref().unwrap_or("(none)"),
        s.autostart,
        s.ink_enabled,
        s.clips_enabled,
        s.quick_capture_enabled,
        s.voice_enabled,
        s.voice_model,
        s.voice_indicator_placement
    );
}

/// Argument the autostart registration appends to the exe path, so a sign-in
/// launch can be told apart from the user opening the app themselves.
pub const AUTOSTART_ARG: &str = "--autostart";

/// Brings the registry entry in line with the setting.
///
/// Enabling always rewrites the entry rather than checking it first: the
/// value is the running exe's path, so re-registering is how a moved or
/// self-updated install stops pointing Windows at an exe that is gone.
/// Disabling only acts when there is something registered, so the common
/// case — the setting has never been switched on — touches nothing and logs
/// nothing on every start.
///
/// A debug build deliberately does nothing: its exe lives in
/// `target/debug/`, and registering that path would outlive the build
/// directory.
pub fn apply_autostart(app: &tauri::AppHandle, enabled: bool) {
    if cfg!(debug_assertions) {
        crate::diag!("autostart: skipped in a debug build (enabled={enabled})");
        return;
    }
    use tauri_plugin_autostart::ManagerExt;
    let manager = app.autolaunch();
    let result = if enabled {
        manager.enable()
    } else if manager.is_enabled().unwrap_or(false) {
        manager.disable()
    } else {
        return;
    };
    match result {
        Ok(()) => crate::diag!("autostart: start-with-Windows set to {enabled}"),
        Err(e) => crate::diag!("autostart: cannot set start-with-Windows to {enabled}: {e}"),
    }
}

/// Minimizes the main window when this process was launched by the sign-in
/// registration rather than by the user.
///
/// Minimized, not hidden: there is no tray icon, so a hidden main window
/// would only be reachable by launching the exe again (the single-instance
/// handler shows it). A taskbar button is the obvious way back.
fn apply_autostart_launch(app: &tauri::App) {
    if !std::env::args().any(|arg| arg == AUTOSTART_ARG) {
        return;
    }
    if let Some(main_window) = app.get_webview_window("main") {
        if let Err(e) = main_window.minimize() {
            crate::diag!("autostart: cannot minimize the main window: {e}");
        }
    }
}

pub fn run() {
    // First thing in the process: a release build has no console, so until
    // this runs every diagnostic (a panic included) is written nowhere.
    diag::init();
    update::cleanup_old();
    // Must run before the first `storage::load()` call below (or anywhere
    // else) so config reads see the migrated `~/.workhub` copy, not a fresh
    // default (T-0064) — the startup snapshot right after it included.
    storage::migrate_from_appdata();
    // As early as the migration allows: a report about a gesture that "does
    // nothing" is unreadable without knowing whether the feature was even
    // switched on. Recorded here rather than in `setup` so a startup that
    // dies half way still says what it was starting with.
    log_startup_settings(&storage::load());
    tauri::Builder::default()
        // Must be registered first (per tauri-plugin-single-instance docs).
        // Without this, every launch adds another process; combined with the
        // hidden quick-capture/voice windows keeping each one alive after its
        // main window closes, instances used to accumulate indefinitely.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        // Start-with-Windows (T-0258). The extra argument is how the app
        // recognizes a sign-in launch and starts out of the way — see
        // `apply_autostart_launch` below.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_ARG]),
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    // Runs inside WndProc on Windows — only show the
                    // pre-built window here, never build one (see
                    // quick_capture.rs module docs).
                    if event.state != tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        return;
                    }
                    if quick_capture::matches(app, shortcut) {
                        quick_capture::show(app);
                    } else if voice::matches(app, shortcut) {
                        voice::toggle(app);
                    }
                })
                .build(),
        )
        .manage(quick_capture::QuickCaptureState::default())
        .manage(clips::ClipsState::default())
        .manage(tasks::WatcherState::default())
        .manage(ink::InkState::default())
        .manage(terminal::TerminalState::default())
        .manage(voice::VoiceState::default())
        .manage(stt::SttState::default())
        .manage(tidy::TidyState::default())
        .manage(schedule_edit::ScheduleEditState::default())
        .manage(mindmap_edit::MindmapEditState::default())
        .setup(|app| {
            // Closing the main window used to leave the process running
            // (the hidden quick-capture/voice windows below keep Tauri
            // alive), producing windowless zombie processes that then lock
            // their own exe against future self-updates. There is no tray
            // icon, so a windowless process is also unreachable — exit the
            // whole app when the main window closes. The quick-capture and
            // voice windows are hidden helper windows, not covered by this
            // (their own `CloseRequested` just hides them, see their
            // modules), so hiding either of them never exits the app.
            if let Some(main_window) = app.get_webview_window("main") {
                let app_handle = app.handle().clone();
                main_window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { .. } = event {
                        app_handle.exit(0);
                    }
                });
            }
            // Resume watching the configured vault (if any) across restarts.
            let cfg = storage::load();
            // Re-assert the start-with-Windows registration against the exe
            // that is actually running. workhub ships as a portable exe and
            // self-updates in place, so the registered path goes stale the
            // moment the user moves the folder; rewriting it on every start
            // is cheaper than detecting that.
            apply_autostart(app.handle(), cfg.settings.autostart);
            apply_autostart_launch(app);
            // Give a vault that has no `.workhub/settings.json` yet the
            // values this machine is already using, so the split never
            // starts by losing settings (T-0206).
            vault_settings::seed_if_missing(&cfg);
            if cfg.settings.ink_enabled {
                ink::start(app.handle());
            }
            if let Some(vault_path) = cfg.settings.vault_path {
                let path = std::path::PathBuf::from(&vault_path);
                if path.is_dir() {
                    let state = app.state::<tasks::WatcherState>();
                    let _ = tasks::start_watcher(app.handle().clone(), &state.0, path);
                }
            }
            // Created hidden regardless of the enabled flag (the flag only
            // gates the hotkey) so toggling it on later never has to build a
            // window from inside an event handler.
            if let Err(e) = quick_capture::create_window(app.handle()) {
                crate::diag!("quick-capture: failed to create window: {e}");
            }
            quick_capture::apply_shortcut(app.handle());
            // Same rationale: the ink preview is built hidden up front so
            // opening it from the Ink tab is a show, not a build.
            if let Err(e) = ink_preview::create_window(app.handle()) {
                crate::diag!("ink-preview: failed to create window: {e}");
            }
            // Same rationale: the task editor is built hidden up front so
            // opening a task from the board is a show, not a build.
            if let Err(e) = task_editor::create_window(app.handle()) {
                crate::diag!("task-editor: failed to create window: {e}");
            }
            // Same rationale: build the (hidden) voice indicator window up
            // front so the hotkey handler only ever shows/hides it.
            if let Err(e) = voice::create_window(app.handle()) {
                crate::diag!("voice: failed to create indicator window: {e}");
            }
            voice::apply_shortcut(app.handle());
            // Same rationale again: the clips popup is built hidden up front
            // so the gesture handler only ever shows it.
            if let Err(e) = clips::create_window(app.handle()) {
                crate::diag!("clips: failed to create popup window: {e}");
            }
            clips::apply_gesture(app.handle());
            // Background vault-tidy scheduler (T-0050). Cheap mechanical checks;
            // only launches an agent when there is actual housekeeping to do.
            tidy::start_scheduler(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_config,
            commands::tidy_status,
            commands::run_vault_tidy_now,
            commands::resume_tidy_session,
            commands::list_inbox_notes,
            commands::read_inbox_note,
            commands::check_vault_path,
            commands::git_status,
            commands::list_branches,
            commands::git_op,
            commands::git_log,
            commands::git_graph_op,
            commands::git_commit_files,
            commands::git_commit_file_diff,
            commands::git_remote_url,
            commands::list_worktrees,
            commands::remove_worktree,
            commands::delete_worktree_branch,
            commands::open_in_vscode,
            commands::open_terminal,
            commands::launch_agent,
            commands::copy_task_prompt,
            commands::send_task_to_claude_desktop,
            commands::opencode_models,
            commands::open_explorer,
            commands::open_in_obsidian,
            commands::app_version,
            commands::ink_capture_dir,
            commands::save_ink_capture,
            commands::save_ink_crop,
            commands::list_ink_captures,
            commands::read_ink_capture,
            commands::copy_ink_capture,
            commands::copy_ink_png,
            commands::delete_ink_capture,
            commands::open_ink_preview,
            commands::ink_preview_hide,
            commands::open_task_editor,
            commands::task_editor_hide,
            commands::task_editor_request_terminal_panel,
            commands::focus_main_window,
            commands::input_listener_diagnostics,
            commands::diagnostic_log,
            commands::diagnostic_log_info,
            commands::log_frontend_error,
            commands::restart_input_listener,
            commands::check_update,
            commands::apply_update,
            commands::restart_app,
            commands::memory_setup_ok,
            commands::list_tasks,
            commands::create_task,
            commands::update_task,
            commands::delete_task,
            commands::init_vault,
            commands::check_vault_template,
            commands::apply_vault_template,
            commands::apply_safe_template_updates,
            commands::preview_vault_template_file,
            commands::watch_vault,
            commands::list_schedule_projects,
            commands::create_vault_project,
            commands::list_vault_projects,
            commands::list_backlog_items,
            commands::archive_vault_project,
            commands::restore_vault_project,
            commands::set_vault_project_repos,
            commands::set_vault_project_details,
            commands::set_vault_project_order,
            commands::list_schedules,
            commands::read_schedule,
            commands::write_schedule,
            commands::create_schedule,
            commands::rename_schedule,
            commands::delete_schedule,
            commands::export_schedule_html,
            commands::run_schedule_edit,
            commands::schedule_edit_status,
            commands::restore_schedule_snapshot,
            commands::docs_roots,
            commands::add_docs_root,
            commands::remove_docs_root,
            commands::update_docs_root,
            commands::docs_open_external,
            commands::docs_list_dir,
            commands::docs_read_file,
            commands::docs_read_asset,
            commands::list_mindmaps,
            commands::read_mindmap,
            commands::write_mindmap,
            commands::create_mindmap,
            commands::rename_mindmap,
            commands::delete_mindmap,
            commands::export_mindmap_file,
            commands::export_mindmap_png,
            commands::run_mindmap_edit,
            commands::mindmap_edit_status,
            commands::restore_mindmap_snapshot,
            commands::launch_agent_for_task,
            commands::load_music_data,
            commands::save_music_data,
            commands::export_playlist_file,
            commands::import_playlist_file,
            commands::fetch_youtube_title,
            commands::terminal_open,
            commands::terminal_write,
            commands::terminal_resize,
            commands::terminal_close,
            commands::quick_capture_hide,
            commands::clips_list,
            commands::clips_save,
            commands::clips_paste,
            commands::clips_hide,
            commands::stt_model_status,
            commands::stt_download_model,
            commands::stt_delete_model,
            commands::voice_stop_recording,
            commands::voice_cancel_recording,
            commands::voice_history_list,
            commands::voice_history_delete,
            commands::voice_history_clear,
            commands::persona_characters,
            commands::persona_genshijin_installed,
            commands::persona_state,
            commands::set_persona_state,
            commands::delete_persona_character,
            commands::plugins_state,
            commands::plugin_details,
            commands::set_plugin_enabled,
            commands::plugins_update_marketplace,
            commands::plugins_update_plugin,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
