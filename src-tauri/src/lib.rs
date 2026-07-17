mod actions;
mod commands;
mod git;
mod harness;
mod herdr;
mod ink;
mod models;
mod music;
mod storage;
mod tasks;
mod terminal;
mod update;

use tauri::Manager;

pub fn run() {
    update::cleanup_old();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(tasks::WatcherState::default())
        .manage(ink::InkState::default())
        .manage(terminal::TerminalState::default())
        .setup(|app| {
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_config,
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
            commands::list_tasks,
            commands::create_task,
            commands::update_task,
            commands::delete_task,
            commands::init_vault,
            commands::watch_vault,
            commands::launch_agent_for_task,
            commands::load_music_data,
            commands::save_music_data,
            commands::fetch_youtube_title,
            commands::terminal_open,
            commands::terminal_write,
            commands::terminal_resize,
            commands::terminal_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
