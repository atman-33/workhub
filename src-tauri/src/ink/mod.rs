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

/// Managed Tauri state tracking whether the key listener is registered.
#[derive(Default)]
pub struct InkState(#[cfg(windows)] std::sync::Mutex<bool>);

/// Create the (hidden) overlay window and start observing keys.
/// Idempotent: does nothing if the listener is already registered.
#[cfg(windows)]
pub fn start(app: &AppHandle) {
    use tauri::Manager;
    let state = app.state::<InkState>();
    let mut running = state.0.lock().unwrap();
    if *running {
        return;
    }
    if let Err(e) = overlay::create_overlay(app) {
        eprintln!("ink: failed to create overlay window: {e}");
        return;
    }
    match hook::start(app) {
        Ok(()) => *running = true,
        Err(e) => eprintln!("ink: failed to start the key listener: {e}"),
    }
}

/// Stop observing keys and hide the overlay. The overlay window is kept
/// (hidden) so re-enabling is cheap.
#[cfg(windows)]
pub fn stop(app: &AppHandle) {
    use tauri::Manager;
    let state = app.state::<InkState>();
    let mut running = state.0.lock().unwrap();
    if *running {
        hook::stop();
        *running = false;
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
