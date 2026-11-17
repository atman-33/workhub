//! What saving the settings has to decide, apart from writing the file.
//!
//! `commands::save_config` used to hold these decisions inline, next to the
//! calls that act on them, which made them impossible to test: the acting
//! half needs an `AppHandle`. The deciding half is here, as plain functions
//! of the settings before and after, so each rule has a test.

use crate::models::{Config, Settings};

/// Shapes the config the caller sent into the one that is saved.
///
/// - Switching vaults adopts the settings the newly opened vault carries: the
///   vault-scoped settings belong to the vault being opened, not to the one
///   being left behind (T-0206). Saving into the same vault leaves them as
///   sent.
/// - The main window's saved geometry belongs to the backend, which updates it
///   as the window moves. The settings dialog only round-trips what it loaded
///   at startup, so whatever it sends is stale by now; keep the stored one.
/// - The tidy schedule's anchor is seeded (to `now_secs`) the first time the
///   routine is enabled, so the interval has a phase to count from. An anchor
///   that is already set is never moved.
pub fn prepare(before: &Settings, config: &mut Config, now_secs: u64) {
    if config.settings.vault_path != before.vault_path {
        crate::vault_settings::overlay(config);
    }
    config.settings.main_window_rect = before.main_window_rect;
    config.settings.main_window_maximized = before.main_window_maximized;
    if config.settings.tidy.enabled && config.settings.tidy.anchor.is_none() {
        config.settings.tidy.anchor = Some(now_secs);
    }
}

/// Which side effects a save has to trigger, by comparing the settings before
/// and after it. Each one fires only when the setting it depends on changed.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Effects {
    /// Register/unregister start-with-Windows; the new state.
    pub autostart: Option<bool>,
    /// Start (`true`) or stop (`false`) the ink keyboard hook.
    pub ink: Option<bool>,
    /// Re-register the quick-capture hotkey.
    pub quick_capture: bool,
    /// Re-register the voice-input hotkey.
    pub voice: bool,
    /// Start/stop/retarget the clips key listener.
    pub clips: bool,
}

pub fn effects(before: &Settings, after: &Settings) -> Effects {
    Effects {
        autostart: (after.autostart != before.autostart).then_some(after.autostart),
        ink: (after.ink_enabled != before.ink_enabled).then_some(after.ink_enabled),
        quick_capture: after.quick_capture_enabled != before.quick_capture_enabled
            || after.quick_capture_shortcut != before.quick_capture_shortcut,
        voice: after.voice_enabled != before.voice_enabled
            || after.voice_hotkey != before.voice_hotkey,
        clips: after.clips_enabled != before.clips_enabled
            || after.clips_gesture != before.clips_gesture,
    }
}

/// The unix time now, in seconds; 0 if the clock is before the epoch.
pub fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_vault(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("workhub-settings-save-{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn config_in(vault: &std::path::Path, language: &str) -> Config {
        Config {
            settings: Settings {
                vault_path: Some(vault.to_string_lossy().into_owned()),
                language: language.into(),
                ..Settings::default()
            },
            ..Config::default()
        }
    }

    // --- prepare: main window geometry ------------------------------------

    #[test]
    fn saving_settings_keeps_the_stored_main_window_geometry() {
        let stored = crate::models::MainWindowRect {
            x: 10,
            y: 20,
            width: 900.0,
            height: 600.0,
        };
        let before = Settings {
            main_window_rect: Some(stored),
            main_window_maximized: true,
            ..Settings::default()
        };
        // The dialog sends back what it loaded at startup: nothing.
        let mut config = Config::default();
        prepare(&before, &mut config, 100);

        assert_eq!(config.settings.main_window_rect, Some(stored));
        assert!(config.settings.main_window_maximized);
    }

    // --- prepare: vault switch -------------------------------------------

    #[test]
    fn switching_vaults_adopts_the_new_vaults_settings() {
        let new_vault = temp_vault("switch-new");
        crate::vault_settings::write(&config_in(&new_vault, "ja")).unwrap();

        let before = Settings {
            vault_path: Some("D:/old-vault".into()),
            language: "en".into(),
            ..Settings::default()
        };
        // The caller sends the new path with the old vault's language.
        let mut config = config_in(&new_vault, "en");
        prepare(&before, &mut config, 100);

        assert_eq!(config.settings.language, "ja");
        std::fs::remove_dir_all(&new_vault).ok();
    }

    #[test]
    fn saving_into_the_same_vault_keeps_what_the_caller_sent() {
        let vault = temp_vault("same");
        crate::vault_settings::write(&config_in(&vault, "ja")).unwrap();

        let before = config_in(&vault, "ja").settings;
        // The user changed the language in the dialog; the vault file still
        // says "ja" until this save writes it.
        let mut config = config_in(&vault, "en");
        prepare(&before, &mut config, 100);

        assert_eq!(config.settings.language, "en");
        std::fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn switching_to_a_vault_without_settings_keeps_what_was_sent() {
        let empty = temp_vault("switch-empty");
        let before = Settings {
            vault_path: Some("D:/old-vault".into()),
            ..Settings::default()
        };
        let mut config = config_in(&empty, "en");
        prepare(&before, &mut config, 100);

        assert_eq!(config.settings.language, "en");
        std::fs::remove_dir_all(&empty).ok();
    }

    #[test]
    fn clearing_the_vault_path_counts_as_a_switch_with_nothing_to_adopt() {
        let before = config_in(&PathBuf::from("D:/old-vault"), "ja").settings;
        let mut config = Config::default();
        config.settings.language = "en".into();
        prepare(&before, &mut config, 100);

        assert_eq!(config.settings.vault_path, None);
        assert_eq!(config.settings.language, "en");
    }

    // --- prepare: tidy anchor --------------------------------------------

    #[test]
    fn enabling_tidy_seeds_the_anchor_once() {
        let before = Settings::default();
        let mut config = Config::default();
        config.settings.tidy.enabled = true;
        assert_eq!(config.settings.tidy.anchor, None);

        prepare(&before, &mut config, 1234);
        assert_eq!(config.settings.tidy.anchor, Some(1234));

        // A later save does not move it.
        prepare(&before, &mut config, 9999);
        assert_eq!(config.settings.tidy.anchor, Some(1234));
    }

    #[test]
    fn a_disabled_tidy_gets_no_anchor() {
        let before = Settings::default();
        let mut config = Config::default();
        config.settings.tidy.enabled = false;
        prepare(&before, &mut config, 1234);
        assert_eq!(config.settings.tidy.anchor, None);
    }

    #[test]
    fn an_existing_anchor_is_never_overwritten() {
        let before = Settings::default();
        let mut config = Config::default();
        config.settings.tidy.enabled = true;
        config.settings.tidy.anchor = Some(42);
        prepare(&before, &mut config, 1234);
        assert_eq!(config.settings.tidy.anchor, Some(42));
    }

    // --- effects ---------------------------------------------------------

    #[test]
    fn an_unchanged_save_triggers_nothing() {
        let s = Settings::default();
        assert_eq!(effects(&s, &s.clone()), Effects::default());
    }

    #[test]
    fn autostart_reports_the_new_state_only_when_toggled() {
        let off = Settings {
            autostart: false,
            ..Settings::default()
        };
        let on = Settings {
            autostart: true,
            ..Settings::default()
        };
        assert_eq!(effects(&off, &on).autostart, Some(true));
        assert_eq!(effects(&on, &off).autostart, Some(false));
        assert_eq!(effects(&on, &on.clone()).autostart, None);
    }

    #[test]
    fn ink_reports_start_or_stop_only_when_toggled() {
        let off = Settings {
            ink_enabled: false,
            ..Settings::default()
        };
        let on = Settings {
            ink_enabled: true,
            ..Settings::default()
        };
        assert_eq!(effects(&off, &on).ink, Some(true));
        assert_eq!(effects(&on, &off).ink, Some(false));
        assert_eq!(effects(&on, &on.clone()).ink, None);
    }

    #[test]
    fn each_hotkey_effect_follows_its_own_enabled_flag_and_binding() {
        let base = Settings::default();

        let mut a = base.clone();
        a.quick_capture_enabled = !base.quick_capture_enabled;
        assert!(effects(&base, &a).quick_capture);
        let mut a = base.clone();
        a.quick_capture_shortcut = "Ctrl+Alt+Q".into();
        assert!(effects(&base, &a).quick_capture);

        let mut b = base.clone();
        b.voice_enabled = !base.voice_enabled;
        assert!(effects(&base, &b).voice);
        let mut b = base.clone();
        b.voice_hotkey = "Ctrl+Alt+V".into();
        assert!(effects(&base, &b).voice);

        let mut c = base.clone();
        c.clips_enabled = !base.clips_enabled;
        assert!(effects(&base, &c).clips);
        let mut c = base.clone();
        c.clips_gesture = "test-gesture".into();
        assert!(effects(&base, &c).clips);
    }

    #[test]
    fn changing_one_feature_does_not_trigger_the_others() {
        let base = Settings::default();
        let mut after = base.clone();
        after.voice_hotkey = "Ctrl+Alt+V".into();
        assert_eq!(
            effects(&base, &after),
            Effects {
                voice: true,
                ..Effects::default()
            }
        );
    }
}
