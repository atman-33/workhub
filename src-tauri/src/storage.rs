use crate::models::Config;
use std::path::PathBuf;

pub fn config_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("workhub")
}

fn config_file() -> PathBuf {
    config_dir().join("config.json")
}

pub fn workspaces_dir() -> PathBuf {
    // NOT under config_dir(): when a .code-workspace file lives in
    // AppData\Roaming, a running VS Code instance fails to read it and opens
    // an empty dirty editor tab instead of the workspace (likely antivirus
    // folder shielding). A plain dot-folder in the home directory works.
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".workhub")
        .join("workspaces")
}

pub fn load() -> Config {
    match std::fs::read_to_string(config_file()) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => Config::default(),
    }
}

pub fn save(cfg: &Config) {
    let dir = config_dir();
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    if let Ok(text) = serde_json::to_string_pretty(cfg) {
        let _ = std::fs::write(config_file(), text);
    }
}
