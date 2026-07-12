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
    let mut cfg = match std::fs::read_to_string(config_file()) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => Config::default(),
    };
    migrate_default_templates(&mut cfg);
    cfg
}

/// Rewrites saved command templates that still exactly match a previous
/// default to the current default (pwsh → Windows PowerShell). Customized
/// templates are left untouched.
fn migrate_default_templates(cfg: &mut Config) {
    const OLD_AGENT_CMD: &str = "wt -d {path} pwsh -NoExit -Command claude";
    const OLD_OPENCODE_CMD: &str = "wt -d {path} pwsh -NoExit -Command opencode";
    let defaults = crate::models::Settings::default();
    if cfg.settings.agent_cmd == OLD_AGENT_CMD {
        cfg.settings.agent_cmd = defaults.agent_cmd;
    }
    if cfg.settings.opencode_cmd == OLD_OPENCODE_CMD {
        cfg.settings.opencode_cmd = defaults.opencode_cmd;
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
