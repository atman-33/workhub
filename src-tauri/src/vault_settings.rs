//! Vault-scoped settings (T-0206).
//!
//! Workhub settings are not all of one kind. Some describe *this machine*
//! (paths, command templates, hotkeys, window geometry); some are *runtime
//! state* (selection, sort order, last-run stamps); and some describe the
//! *vault* — how the AI writes into it, what recurring tasks it grows, how
//! the tidy routine treats its inbox. Only the last kind is worth carrying
//! between machines, and the vault is usually its own git repository, so
//! that is where it belongs: a user who clones the vault on a second PC
//! gets those settings back without re-entering them.
//!
//! This module owns the split. `~/.workhub/config.json` stays the complete
//! config — nothing is removed from it, so deleting the vault file always
//! falls back to the local values — and `<vault>/.workhub/settings.json`
//! holds the vault-scoped subset, which wins when both are present.
//!
//! Adding a setting? See `docs/adr` and the repo rule
//! `.claude/rules/settings-placement.md` for where it goes.

use crate::models::{Config, Settings};
use serde_json::{Map, Value};
use std::path::PathBuf;

/// Format version of `<vault>/.workhub/settings.json`, so a future change of
/// shape can be recognized rather than guessed at.
const FORMAT_VERSION: u32 = 1;

/// Top-level `Settings` fields that belong to the vault rather than to this
/// machine. **The single source of truth for the split** — everything else
/// in this module is derived from it, and a new setting is made portable by
/// adding its name here and nowhere else.
///
/// Deliberately absent, and why:
/// - paths and command templates (`vault_path`, `worktree_root`, `*_cmd`,
///   `ink_dir`, `schedule_export_dir`) — different on every machine;
/// - hotkeys, window rects and voice/clips settings — hardware- and
///   OS-shell-specific;
/// - `projects`, `presets`, `selected`, `sort` — absolute paths and UI state;
/// - `secretary_enabled` and `memory_*` — read straight out of
///   `~/.workhub/config.json` by four separate agent-side scripts (the
///   Claude Code hooks, the memory engine, and two OpenCode plugins), so
///   moving them means teaching all of them this overlay first.
const VAULT_SCOPED: &[&str] = &[
    "custom_prompt",
    "task_language",
    "schedule_locale",
    "schedule_assignee",
    "schedule_model",
    "schedule_confirm",
    "mindmap_assignee",
    "mindmap_model",
    "mindmap_confirm",
    "recurring",
    "tidy",
];

/// The `tidy` sub-fields that are policy (portable) rather than run history.
/// `tidy` is carried as a whole object in `VAULT_SCOPED`, but its `anchor`,
/// `last_run` and `last_session_id` describe what happened on one machine,
/// so they are filtered out on the way in and on the way out.
const TIDY_SCOPED: &[&str] = &[
    "enabled",
    "assignee",
    "model",
    "interval_hours",
    "stale_days",
    "exclude_dirs",
];

/// `<vault>/.workhub/settings.json` for the configured vault, or `None` when
/// no usable vault is configured.
fn settings_file(cfg: &Config) -> Option<PathBuf> {
    let raw = cfg.settings.vault_path.as_deref()?.trim().to_string();
    if raw.is_empty() {
        return None;
    }
    let vault = PathBuf::from(raw.replace('\\', "/"));
    vault
        .is_dir()
        .then(|| vault.join(".workhub").join("settings.json"))
}

/// Keeps only the vault-scoped keys of a serialized `Settings` object,
/// trimming `tidy` down to its policy fields.
fn scoped_subset(settings: &Map<String, Value>) -> Map<String, Value> {
    let mut out = Map::new();
    for key in VAULT_SCOPED {
        let Some(value) = settings.get(*key) else {
            continue;
        };
        if *key == "tidy" {
            let Some(tidy) = value.as_object() else {
                continue;
            };
            let policy: Map<String, Value> = TIDY_SCOPED
                .iter()
                .filter_map(|k| tidy.get(*k).map(|v| ((*k).to_string(), v.clone())))
                .collect();
            out.insert((*key).to_string(), Value::Object(policy));
        } else {
            out.insert((*key).to_string(), value.clone());
        }
    }
    out
}

/// The vault-scoped subset of `settings`, as it is written to the vault file.
pub fn extract(settings: &Settings) -> Map<String, Value> {
    let Ok(Value::Object(all)) = serde_json::to_value(settings) else {
        return Map::new();
    };
    scoped_subset(&all)
}

/// Overlays `overlay` (a vault file's `settings` object) onto `settings`.
/// Unknown and out-of-scope keys are ignored, so a vault written by a newer
/// or hand-edited workhub can never inject a machine-local value; `tidy` is
/// merged field by field so the local run history survives.
fn apply(settings: &mut Settings, overlay: &Map<String, Value>) {
    let Ok(Value::Object(mut all)) = serde_json::to_value(&*settings) else {
        return;
    };
    for (key, value) in scoped_subset(overlay) {
        if key == "tidy" {
            let (Some(Value::Object(local)), Value::Object(incoming)) =
                (all.get_mut("tidy"), &value)
            else {
                continue;
            };
            for (k, v) in incoming {
                local.insert(k.clone(), v.clone());
            }
        } else {
            all.insert(key, value);
        }
    }
    if let Ok(merged) = serde_json::from_value::<Settings>(Value::Object(all)) {
        *settings = merged;
    }
}

/// Reads the vault file's `settings` object, or `None` when there is no
/// vault, no file, or the file cannot be parsed. A broken file is ignored
/// rather than fatal: the local config is always a complete fallback.
fn read(cfg: &Config) -> Option<Map<String, Value>> {
    let file = settings_file(cfg)?;
    let text = std::fs::read_to_string(&file).ok()?;
    let value: Value = serde_json::from_str(&text)
        .map_err(|e| eprintln!("vault settings: cannot parse {}: {e}", file.display()))
        .ok()?;
    match value.get("settings") {
        Some(Value::Object(map)) => Some(map.clone()),
        _ => None,
    }
}

/// Applies the vault's settings on top of `cfg`, if there are any. Called by
/// `storage::load`, so every existing `storage::load()` call site sees the
/// merged result without knowing this split exists.
pub fn overlay(cfg: &mut Config) {
    if let Some(map) = read(cfg) {
        apply(&mut cfg.settings, &map);
    }
}

/// Writes the vault-scoped subset of `cfg` to `<vault>/.workhub/settings.json`.
/// A missing vault is not an error — the config simply stays machine-local.
pub fn write(cfg: &Config) -> Result<(), String> {
    let Some(file) = settings_file(cfg) else {
        return Ok(());
    };
    let dir = file.parent().expect("settings.json has a parent");
    std::fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    let mut doc = Map::new();
    doc.insert("version".into(), Value::from(FORMAT_VERSION));
    doc.insert("settings".into(), Value::Object(extract(&cfg.settings)));
    let text = serde_json::to_string_pretty(&Value::Object(doc))
        .map_err(|e| format!("cannot serialize vault settings: {e}"))?;
    std::fs::write(&file, text).map_err(|e| format!("cannot write {}: {e}", file.display()))
}

/// Creates the vault file from the current local settings when the vault has
/// none yet, so an existing install keeps the values it already had instead
/// of silently reverting to defaults on the next machine. Best-effort: a
/// failure is reported and ignored, exactly like the appdata migration.
pub fn seed_if_missing(cfg: &Config) {
    let Some(file) = settings_file(cfg) else {
        return;
    };
    if file.exists() {
        return;
    }
    if let Err(e) = write(cfg) {
        eprintln!("vault settings: cannot seed: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::TidySettings;

    fn overlay_of(pairs: Value) -> Map<String, Value> {
        pairs.as_object().expect("object").clone()
    }

    #[test]
    fn extract_keeps_only_vault_scoped_fields() {
        let settings = Settings {
            task_language: "ja".into(),
            worktree_root: "D:/machine-local".into(),
            ..Settings::default()
        };
        let scoped = extract(&settings);

        assert_eq!(scoped.get("task_language"), Some(&Value::from("ja")));
        assert!(
            !scoped.contains_key("worktree_root"),
            "machine-local paths must not reach the vault file"
        );
        assert!(!scoped.contains_key("vault_path"));
        assert!(!scoped.contains_key("voice_hotkey"));
    }

    #[test]
    fn extract_drops_tidy_run_history() {
        let settings = Settings {
            tidy: TidySettings {
                last_run: Some(1234),
                last_session_id: Some("abc".into()),
                anchor: Some(99),
                interval_hours: 6,
                ..TidySettings::default()
            },
            ..Settings::default()
        };
        let tidy = extract(&settings)
            .get("tidy")
            .and_then(|v| v.as_object().cloned())
            .expect("tidy is carried");

        assert_eq!(tidy.get("interval_hours"), Some(&Value::from(6)));
        assert!(!tidy.contains_key("last_run"));
        assert!(!tidy.contains_key("last_session_id"));
        assert!(!tidy.contains_key("anchor"));
    }

    #[test]
    fn apply_overrides_scoped_fields_only() {
        let mut settings = Settings {
            task_language: "en".into(),
            worktree_root: "D:/machine-local".into(),
            ..Settings::default()
        };
        apply(
            &mut settings,
            &overlay_of(serde_json::json!({
                "task_language": "ja",
                "worktree_root": "C:/from-another-pc",
                "vault_path": "C:/someone-elses-vault",
            })),
        );

        assert_eq!(settings.task_language, "ja");
        assert_eq!(
            settings.worktree_root, "D:/machine-local",
            "a vault file must never move this machine's worktree root"
        );
        assert_eq!(settings.vault_path, None);
    }

    #[test]
    fn apply_merges_tidy_without_losing_run_history() {
        let mut settings = Settings {
            tidy: TidySettings {
                last_run: Some(1234),
                last_session_id: Some("abc".into()),
                interval_hours: 24,
                ..TidySettings::default()
            },
            ..Settings::default()
        };
        apply(
            &mut settings,
            &overlay_of(serde_json::json!({
                "tidy": { "interval_hours": 12, "last_run": 999 }
            })),
        );

        assert_eq!(settings.tidy.interval_hours, 12);
        assert_eq!(
            settings.tidy.last_run,
            Some(1234),
            "run history is this machine's, not the vault's"
        );
        assert_eq!(settings.tidy.last_session_id.as_deref(), Some("abc"));
    }

    #[test]
    fn apply_ignores_unknown_keys() {
        let mut settings = Settings::default();
        apply(
            &mut settings,
            &overlay_of(serde_json::json!({ "not_a_setting": true })),
        );
        assert_eq!(settings.task_language, Settings::default().task_language);
    }

    #[test]
    fn every_scoped_key_exists_on_settings() {
        let value = serde_json::to_value(Settings::default()).expect("serialize");
        let all = value.as_object().expect("object");
        for key in VAULT_SCOPED {
            assert!(all.contains_key(*key), "unknown vault-scoped key: {key}");
        }
        let tidy = all
            .get("tidy")
            .and_then(|v| v.as_object())
            .expect("tidy object");
        for key in TIDY_SCOPED {
            assert!(tidy.contains_key(*key), "unknown tidy key: {key}");
        }
    }
    fn temp_vault(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("workhub-vault-settings-{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn config_for(vault: &std::path::Path, settings: Settings) -> Config {
        Config {
            settings: Settings {
                vault_path: Some(vault.to_string_lossy().into_owned()),
                ..settings
            },
            ..Config::default()
        }
    }

    #[test]
    fn write_then_overlay_round_trips_scoped_values() {
        let vault = temp_vault("roundtrip");
        let written = config_for(
            &vault,
            Settings {
                task_language: "ja".into(),
                custom_prompt: "answer in Japanese".into(),
                worktree_root: "D:/machine-local".into(),
                ..Settings::default()
            },
        );
        write(&written).expect("write vault settings");

        let mut read_back = config_for(&vault, Settings::default());
        overlay(&mut read_back);

        assert_eq!(read_back.settings.task_language, "ja");
        assert_eq!(read_back.settings.custom_prompt, "answer in Japanese");
        assert_eq!(
            read_back.settings.worktree_root,
            Settings::default().worktree_root,
            "the vault file carries no machine-local value to restore"
        );
        std::fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn seed_writes_once_and_never_overwrites() {
        let vault = temp_vault("seed");
        let cfg = config_for(
            &vault,
            Settings {
                task_language: "ja".into(),
                ..Settings::default()
            },
        );
        seed_if_missing(&cfg);
        let file = vault.join(".workhub").join("settings.json");
        assert!(file.is_file(), "seeding creates the file");

        let other = config_for(
            &vault,
            Settings {
                task_language: "en".into(),
                ..Settings::default()
            },
        );
        seed_if_missing(&other);
        let mut restored = config_for(&vault, Settings::default());
        overlay(&mut restored);
        assert_eq!(
            restored.settings.task_language, "ja",
            "an existing vault file is the vault's, not this machine's to reseed"
        );
        std::fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn a_broken_vault_file_falls_back_to_local_settings() {
        let vault = temp_vault("broken");
        std::fs::create_dir_all(vault.join(".workhub")).unwrap();
        std::fs::write(vault.join(".workhub").join("settings.json"), "{not json").unwrap();

        let mut cfg = config_for(
            &vault,
            Settings {
                task_language: "ja".into(),
                ..Settings::default()
            },
        );
        overlay(&mut cfg);
        assert_eq!(cfg.settings.task_language, "ja");
        std::fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn no_vault_configured_is_not_an_error() {
        let cfg = Config::default();
        assert!(write(&cfg).is_ok());
        seed_if_missing(&cfg);
    }
}
