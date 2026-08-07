//! Clips: a clibor-style snippet picker. Double-tap Ctrl (bare, no other key)
//! anywhere in Windows to pop up the stored snippets, pick one, and have it
//! pasted into the app you were just typing in.
//!
//! The pieces:
//!
//! - `gesture.rs` — the pure double-tap state machine (unit-tested).
//! - `store.rs` — the snippet list, at `~/.workhub/clips.json`.
//! - `window.rs` — the popup window (`clips.html`), created hidden at startup.
//! - the key listener is shared with the ink overlay (`crate::rawkey`).
//! - the paste itself is shared with voice input (`crate::paste`).
//!
//! Windows-only (Raw Input listener + paste injection); no-op stubs elsewhere.

pub mod store;

#[cfg(windows)]
mod gesture;
#[cfg(windows)]
mod window;

use tauri::AppHandle;

#[cfg(windows)]
pub use window::{create_window, hide};

/// Managed Tauri state: whether the listener is registered, and which window
/// to hand focus back to when a snippet is picked.
#[derive(Default)]
pub struct ClipsState {
    #[cfg(windows)]
    running: std::sync::Mutex<bool>,
    /// Foreground window captured when the popup was shown (see `paste.rs`).
    #[cfg(windows)]
    paste_target: std::sync::Mutex<Option<isize>>,
}

#[cfg(windows)]
mod imp {
    use super::gesture::{TapInput, TapMachine};
    use super::{window, ClipsState};
    use crate::rawkey::{self, KeyEvent};
    use crate::storage;
    use std::sync::Mutex;
    use tauri::{AppHandle, Manager};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetDoubleClickTime, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
    };

    /// Consumer name registered with `rawkey`.
    const CONSUMER: &str = "clips";

    /// The virtual key the configured gesture watches, or `None` when the
    /// gesture is off. Kept alongside the machine so the callback does not
    /// have to re-read settings on every keystroke.
    static TRIGGER_VK: Mutex<Option<u16>> = Mutex::new(None);
    static MACHINE: Mutex<Option<TapMachine>> = Mutex::new(None);

    /// Maps the `clips_gesture` setting to the virtual key it watches.
    /// Unknown values (including `"off"`) disable the gesture.
    pub fn trigger_vk(gesture: &str) -> Option<u16> {
        match gesture {
            "ctrl-double" => Some(VK_CONTROL.0),
            "shift-double" => Some(VK_SHIFT.0),
            _ => None,
        }
    }

    /// True for keys that must not poison the gesture: the trigger itself,
    /// and the other modifiers, which Windows reports as ordinary key presses
    /// when they are pressed alongside it.
    fn is_modifier(vk: u16) -> bool {
        vk == VK_CONTROL.0
            || vk == VK_SHIFT.0
            || vk == VK_MENU.0
            || vk == VK_LWIN.0
            || vk == VK_RWIN.0
    }

    /// (Re)apply the gesture from the current settings: register the shared
    /// key listener when it is on, drop it when it is off. Safe to call again
    /// after a settings change.
    pub fn apply_gesture(app: &AppHandle) {
        let settings = storage::load().settings;
        let vk = settings
            .clips_enabled
            .then(|| trigger_vk(&settings.clips_gesture))
            .flatten();
        let state = app.state::<ClipsState>();
        let mut running = state.running.lock().unwrap();

        *TRIGGER_VK.lock().unwrap() = vk;
        match vk {
            Some(_) => {
                let threshold = unsafe { GetDoubleClickTime() } as u64;
                *MACHINE.lock().unwrap() = Some(TapMachine::new(threshold));
                if !*running {
                    match rawkey::register(app, CONSUMER, on_key) {
                        Ok(()) => *running = true,
                        Err(e) => eprintln!("clips: failed to start the key listener: {e}"),
                    }
                }
            }
            None => {
                *MACHINE.lock().unwrap() = None;
                if *running {
                    rawkey::unregister(CONSUMER);
                    *running = false;
                }
            }
        }
    }

    fn on_key(app: &AppHandle, event: KeyEvent) {
        let Some(trigger) = *TRIGGER_VK.lock().unwrap() else {
            return;
        };
        let input = if event.vk == trigger {
            if event.up {
                TapInput::ModifierUp
            } else {
                TapInput::ModifierDown
            }
        } else if event.up || is_modifier(event.vk) {
            // Releases of other keys say nothing about intent, and the other
            // modifiers are pressed *with* the trigger often enough that
            // treating them as interference would eat the gesture.
            return;
        } else {
            TapInput::OtherDown
        };
        let fired = MACHINE
            .lock()
            .ok()
            .and_then(|mut m| m.as_mut().map(|m| m.on_key(input, event.time_ms)))
            .unwrap_or(false);
        if fired {
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || window::show(&handle));
        }
    }

    /// Remember which window had focus, so a picked snippet can be pasted
    /// back into it after the popup takes focus away.
    pub fn remember_paste_target(app: &AppHandle) {
        if let Some(state) = app.try_state::<ClipsState>() {
            *state.paste_target.lock().unwrap() = crate::paste::foreground_window();
        }
    }

    pub fn take_paste_target(app: &AppHandle) -> Option<isize> {
        app.try_state::<ClipsState>()
            .and_then(|s| s.paste_target.lock().unwrap().take())
    }
}

#[cfg(windows)]
pub use imp::{apply_gesture, remember_paste_target};

/// Hide the popup, hand focus back to the app that had it, and paste the
/// snippet there. When focus cannot be restored (Windows refuses a
/// foreground change in some states), the text is left on the clipboard so
/// the user can paste it by hand — reported back as an error string.
#[cfg(windows)]
pub fn paste_clip(app: &AppHandle, id: &str) -> Result<(), String> {
    let Some(clip) = store::find(id) else {
        return Err(format!("clip {id} no longer exists"));
    };
    let target = imp::take_paste_target(app);
    window::hide(app);
    let Some(target) = target else {
        crate::paste::copy_text(&clip.text)?;
        return Err("no window to paste into — the text was copied to the clipboard".into());
    };
    if !crate::paste::restore_foreground(target) {
        crate::paste::copy_text(&clip.text)?;
        return Err(
            "could not focus the previous window — the text was copied to the clipboard".into(),
        );
    }
    // Let the restored window finish taking focus before the keystrokes land.
    std::thread::sleep(std::time::Duration::from_millis(60));
    crate::paste::paste_text(&clip.text)
}

#[cfg(not(windows))]
pub fn paste_clip(_app: &AppHandle, _id: &str) -> Result<(), String> {
    Err("the clips popup is only implemented on Windows".into())
}

#[cfg(not(windows))]
pub fn create_window(_app: &AppHandle) -> tauri::Result<()> {
    Ok(())
}

#[cfg(not(windows))]
pub fn apply_gesture(_app: &AppHandle) {}

#[cfg(not(windows))]
pub fn hide(_app: &AppHandle) {}

#[cfg(windows)]
#[cfg(test)]
mod tests {
    use super::imp::trigger_vk;
    use windows::Win32::UI::Input::KeyboardAndMouse::{VK_CONTROL, VK_SHIFT};

    #[test]
    fn gesture_setting_maps_to_a_trigger_key() {
        assert_eq!(trigger_vk("ctrl-double"), Some(VK_CONTROL.0));
        assert_eq!(trigger_vk("shift-double"), Some(VK_SHIFT.0));
        assert_eq!(trigger_vk("off"), None);
        assert_eq!(trigger_vk(""), None);
    }

    #[test]
    fn settings_defaults() {
        let s = crate::models::Settings::default();
        assert!(s.clips_enabled);
        assert_eq!(s.clips_gesture, "ctrl-double");
        assert!(s.clips_rect.is_none());
    }

    #[test]
    fn settings_deserialize_missing_fields_uses_defaults() {
        // Older config.json files predate the clips keys; they must
        // deserialize with the defaults (config compatibility contract).
        let s: crate::models::Settings = serde_json::from_str("{}").unwrap();
        assert!(s.clips_enabled);
        assert_eq!(s.clips_gesture, "ctrl-double");
    }
}
