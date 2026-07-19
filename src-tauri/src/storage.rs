use crate::models::Config;
use std::path::PathBuf;

/// `~/.workhub` — the single home directory for everything workhub persists
/// (config, voice history, whisper models, task worktree workspaces).
///
/// This used to be `%APPDATA%\workhub` (via `dirs::config_dir()`); see
/// `migrate_from_appdata` for why it moved and how existing installs are
/// carried over.
pub fn config_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".workhub")
}

fn config_file() -> PathBuf {
    config_dir().join("config.json")
}

/// The old `%APPDATA%\workhub` location, used only to locate data to migrate
/// out of on first run against the new home. Never written to again.
fn old_appdata_dir() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("workhub"))
}

pub fn workspaces_dir() -> PathBuf {
    config_dir().join("workspaces")
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

/// Persists `cfg` to `config.json`, returning a descriptive error instead of
/// silently discarding a write failure (T-0064: on at least one machine
/// folder-shielding antivirus software blocked every write here for over a
/// week without any visible symptom other than settings reverting).
pub fn save(cfg: &Config) -> Result<(), String> {
    let dir = config_dir();
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("cannot create config directory {}: {e}", dir.display()))?;
    let text =
        serde_json::to_string_pretty(cfg).map_err(|e| format!("cannot serialize config: {e}"))?;
    let file = config_file();
    std::fs::write(&file, text).map_err(|e| format!("cannot write {}: {e}", file.display()))
}

/// One-time migration from the old `%APPDATA%\workhub` home to the new
/// `~/.workhub` one (T-0064). `%APPDATA%\Roaming` has been observed to
/// silently reject writes on at least one machine (folder-shielding
/// antivirus is the working hypothesis — `workspaces_dir()` already worked
/// around the same phenomenon before this change); a plain dot-folder under
/// the user's home directory does not have this problem.
///
/// Must run before `load()` is first called. Copies `config.json` and
/// `voice-history.json`, and renames (moves) the `models/` directory — all
/// best-effort: failures are logged to stderr and never stop startup, and
/// the old location is never deleted so this is always reversible by hand.
/// Skips entirely once the new location already has a `config.json`, so it
/// only ever runs once per machine.
pub fn migrate_from_appdata() {
    let new_dir = config_dir();
    if new_dir.join("config.json").exists() {
        return;
    }
    let Some(old_dir) = old_appdata_dir() else {
        return;
    };
    if !old_dir.join("config.json").exists() {
        return;
    }

    if let Err(e) = std::fs::create_dir_all(&new_dir) {
        eprintln!(
            "workhub migration: cannot create {}: {e}",
            new_dir.display()
        );
        return;
    }

    for file_name in ["config.json", "voice-history.json"] {
        let src = old_dir.join(file_name);
        let dst = new_dir.join(file_name);
        if !src.exists() {
            continue;
        }
        if let Err(e) = std::fs::copy(&src, &dst) {
            eprintln!(
                "workhub migration: cannot copy {} to {}: {e}",
                src.display(),
                dst.display()
            );
        }
    }

    let old_models = old_dir.join("models");
    if old_models.is_dir() {
        let new_models = new_dir.join("models");
        if let Err(e) = std::fs::rename(&old_models, &new_models) {
            eprintln!(
                "workhub migration: cannot move {} to {}: {e}",
                old_models.display(),
                new_models.display()
            );
        }
    }
}
