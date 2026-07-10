mod actions;
mod commands;
mod git;
mod models;
mod storage;
mod update;

pub fn run() {
    update::cleanup_old();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_config,
            commands::git_status,
            commands::git_op,
            commands::git_log,
            commands::git_graph_op,
            commands::git_remote_url,
            commands::open_in_vscode,
            commands::open_terminal,
            commands::launch_agent,
            commands::open_explorer,
            commands::app_version,
            commands::check_update,
            commands::apply_update,
            commands::restart_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
