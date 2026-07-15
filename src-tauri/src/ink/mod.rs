//! Screen-annotation ("ink") overlay, ported from the Desktop Ink app:
//! double-press Alt and hold the second press to draw temporary strokes on
//! the monitor under the cursor; releasing Alt clears them. Alt+S cycles the
//! pen color; Shift snaps strokes to horizontal/vertical.
//!
//! Windows-only (Raw Input keyboard listener); no-op stubs elsewhere.

#[cfg(windows)]
mod state;

#[cfg(windows)]
mod hook;
#[cfg(windows)]
mod overlay;

use tauri::AppHandle;

/// Managed Tauri state holding the running keyboard hook (if any).
#[derive(Default)]
pub struct InkState(#[cfg(windows)] std::sync::Mutex<Option<hook::InkHook>>);

/// Create the (hidden) overlay window and install the keyboard hook.
/// Idempotent: does nothing if the hook is already running.
#[cfg(windows)]
pub fn start(app: &AppHandle) {
    use tauri::Manager;
    let state = app.state::<InkState>();
    let mut guard = state.0.lock().unwrap();
    if guard.is_some() {
        return;
    }
    if let Err(e) = overlay::create_overlay(app) {
        eprintln!("ink: failed to create overlay window: {e}");
        return;
    }
    match hook::start(app) {
        Ok(hook) => *guard = Some(hook),
        Err(e) => eprintln!("ink: failed to install keyboard hook: {e}"),
    }
}

/// Uninstall the keyboard hook and hide the overlay. The overlay window is
/// kept (hidden) so re-enabling is cheap.
#[cfg(windows)]
pub fn stop(app: &AppHandle) {
    use tauri::Manager;
    let state = app.state::<InkState>();
    let hook = state.0.lock().unwrap().take();
    if let Some(hook) = hook {
        hook.stop();
    }
    overlay::deactivate(app);
}

#[cfg(windows)]
fn dispatch(app: &AppHandle, event: state::InkEvent) {
    match event {
        state::InkEvent::Activate => overlay::activate(app),
        state::InkEvent::Deactivate => overlay::deactivate(app),
        state::InkEvent::CycleColor => overlay::cycle_color(app),
    }
}

#[cfg(not(windows))]
pub fn start(_app: &AppHandle) {}

#[cfg(not(windows))]
pub fn stop(_app: &AppHandle) {}
