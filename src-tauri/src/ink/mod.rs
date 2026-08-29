//! Screen-annotation ("ink") overlay, ported from the Desktop Ink app:
//! double-press Alt and hold the second press to draw temporary strokes on
//! the monitor under the cursor; releasing Alt clears them. Alt+S cycles the
//! pen color; Alt+C saves the annotated screen as a capture (see `store`);
//! Shift snaps strokes to horizontal/vertical.
//!
//! Windows-only (Raw Input keyboard listener); no-op stubs elsewhere.

#[cfg(windows)]
mod state;

#[cfg(windows)]
mod capture;
#[cfg(windows)]
mod hook;
#[cfg(windows)]
mod overlay;
#[cfg(windows)]
pub mod store;

use tauri::AppHandle;

/// Managed Tauri state tracking whether the key listener is registered.
#[derive(Default)]
pub struct InkState(#[cfg(windows)] std::sync::Mutex<bool>);

/// Create the (hidden) overlay window and start observing keys.
///
/// Idempotent, but deliberately **not** a no-op when the listener is already
/// marked as running: calling this again re-creates a lost overlay window and
/// makes `rawkey` re-register its raw-input device. Turning the feature off
/// and on again is how a user says "the gesture stopped working", and the
/// earlier early-return meant that gesture did nothing whenever the flag and
/// the real state had drifted apart.
#[cfg(windows)]
pub fn start(app: &AppHandle) {
    use tauri::Manager;
    let state = app.state::<InkState>();
    let mut running = state.0.lock().unwrap();
    if let Err(e) = overlay::create_overlay(app) {
        eprintln!("ink: failed to create overlay window: {e}");
        return;
    }
    match hook::start(app) {
        Ok(()) => *running = true,
        Err(e) => {
            *running = false;
            eprintln!("ink: failed to start the key listener: {e}");
        }
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
        state::InkEvent::Save => overlay::request_save(app),
    }
}

#[cfg(not(windows))]
pub fn start(_app: &AppHandle) {}

#[cfg(not(windows))]
pub fn stop(_app: &AppHandle) {}

/// Stubs for the non-Windows build. The capture store is reachable from the
/// command layer, which is not compiled per platform — keeping the stubs here
/// keeps every `#[cfg]` for this feature inside the ink module.
#[cfg(not(windows))]
pub mod store {
    use std::path::Path;
    use tauri::AppHandle;

    #[derive(serde::Serialize, Clone)]
    pub struct InkCapture {
        pub path: String,
        pub name: String,
        pub width: u32,
        pub height: u32,
        pub modified_ms: u64,
        pub size_bytes: u64,
        pub thumbnail: String,
    }

    const UNSUPPORTED: &str = "screen annotation is only available on Windows";

    pub fn save_capture(_app: &AppHandle, _dir: &Path, _b64: &str) -> Result<String, String> {
        Err(UNSUPPORTED.into())
    }

    pub fn save_crop(_app: &AppHandle, _source: &Path, _b64: &str) -> Result<String, String> {
        Err(UNSUPPORTED.into())
    }

    pub fn list(_dir: &Path) -> Result<Vec<InkCapture>, String> {
        Ok(Vec::new())
    }

    pub fn read_full(_path: &Path) -> Result<String, String> {
        Err(UNSUPPORTED.into())
    }

    pub fn copy_to_clipboard(_app: &AppHandle, _path: &Path) -> Result<(), String> {
        Err(UNSUPPORTED.into())
    }

    pub fn copy_png(_app: &AppHandle, _b64: &str) -> Result<(), String> {
        Err(UNSUPPORTED.into())
    }

    pub fn delete(_path: &Path) -> Result<(), String> {
        Err(UNSUPPORTED.into())
    }
}
