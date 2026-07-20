mod actions;
mod commands;
mod git;
mod harness;
mod herdr;
mod ink;
mod models;
mod music;
mod quick_capture;
mod storage;
mod stt;
mod tasks;
mod terminal;
mod tidy;
mod update;
mod voice;
mod voice_chunk;
mod voice_history;
mod wsl;

use tauri::Manager;

pub fn run() {
    update::cleanup_old();
    // Must run before the first `storage::load()` call below (or anywhere
    // else) so config reads see the migrated `~/.workhub` copy, not a fresh
    // default (T-0064).
    storage::migrate_from_appdata();
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
        .manage(tasks::WatcherState::default())
        .manage(ink::InkState::default())
        .manage(terminal::TerminalState::default())
        .manage(voice::VoiceState::default())
        .manage(stt::SttState::default())
        .manage(tidy::TidyState::default())
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
                eprintln!("quick-capture: failed to create window: {e}");
            }
            quick_capture::apply_shortcut(app.handle());
            // Same rationale: build the (hidden) voice indicator window up
            // front so the hotkey handler only ever shows/hides it.
            if let Err(e) = voice::create_window(app.handle()) {
                eprintln!("voice: failed to create indicator window: {e}");
            }
            voice::apply_shortcut(app.handle());
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
            commands::opencode_models,
            commands::open_explorer,
            commands::open_in_obsidian,
            commands::app_version,
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
            commands::watch_vault,
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
            commands::stt_model_status,
            commands::stt_download_model,
            commands::stt_delete_model,
            commands::voice_stop_recording,
            commands::voice_history_list,
            commands::voice_history_delete,
            commands::voice_history_clear,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
