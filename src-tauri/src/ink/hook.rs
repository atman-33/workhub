//! Ink's consumer of the shared Raw Input keyboard listener
//! (`crate::rawkey`): it feeds Alt/S transitions into the pure
//! [`AltStateMachine`] and forwards the resulting [`InkEvent`]s to the main
//! thread, where the overlay window is driven.
//!
//! The listener itself is shared with the clips popup — see `rawkey.rs` for
//! why there can only be one raw-input registration per process.

use super::state::{AltStateMachine, InkEvent, KeyInput};
use crate::rawkey::{self, KeyEvent};
use std::sync::Mutex;
use tauri::AppHandle;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetDoubleClickTime, VK_MENU, VK_S};

/// Consumer name registered with `rawkey`.
const CONSUMER: &str = "ink";

/// State machine lives behind a mutex because the callback runs on the
/// listener thread.
static MACHINE: Mutex<Option<AltStateMachine>> = Mutex::new(None);

pub fn start(app: &AppHandle) -> Result<(), String> {
    let threshold = unsafe { GetDoubleClickTime() } as u64;
    *MACHINE.lock().unwrap() = Some(AltStateMachine::new(threshold));
    rawkey::register(app, CONSUMER, on_key)
}

pub fn stop() {
    rawkey::unregister(CONSUMER);
    *MACHINE.lock().unwrap() = None;
}

fn on_key(app: &AppHandle, event: KeyEvent) {
    // Raw input reports both Alt keys as the generic VK_MENU; the gesture does
    // not distinguish left from right.
    let key = if event.vk == VK_MENU.0 {
        if event.up {
            KeyInput::AltUp
        } else {
            KeyInput::AltDown
        }
    } else if event.vk == VK_S.0 {
        if event.up {
            KeyInput::SUp
        } else {
            KeyInput::SDown
        }
    } else if event.up {
        // Releases of unrelated keys carry no information for the gesture.
        return;
    } else {
        // Every other key press poisons a gesture attempt in progress, so that
        // an Alt shortcut is never mistaken for the first half of the gesture.
        KeyInput::OtherDown
    };
    let ink_event: Option<InkEvent> = MACHINE
        .lock()
        .ok()
        .and_then(|mut m| m.as_mut().and_then(|m| m.on_key(key, event.time_ms)));
    if let Some(ink_event) = ink_event {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || super::dispatch(&handle, ink_event));
    }
}
