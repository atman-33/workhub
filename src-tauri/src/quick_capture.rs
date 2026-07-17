//! Quick capture: a global hotkey (default Ctrl+Alt+N) opens a small
//! always-on-top window that turns the clipboard into an inbox task
//! (title + description form; the frontend calls the existing `create_task`).
//!
//! The window is created hidden at startup and reused — never built from the
//! hotkey handler: on Windows that handler runs synchronously inside WndProc
//! (the main event loop), and building a WebView2 window there self-blocks
//! for ~10s because the build waits on the very message pump it is holding
//! (measured in the kakisute app; see its src-tauri/src/windows.rs).

use tauri::{
    AppHandle, Emitter, LogicalPosition, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::models::WindowRect;
use crate::storage;

pub const WINDOW_LABEL: &str = "quick-capture";
const DEFAULT_SIZE: (f64, f64) = (480.0, 360.0);
/// Tried in order after the configured shortcut when registration fails
/// (e.g. another app already holds the key).
const FALLBACK_SHORTCUTS: &[&str] = &["Ctrl+Shift+N"];

/// The shortcut actually registered (may be a fallback, so the configured
/// string can't be used to identify it in the handler).
#[derive(Default)]
pub struct QuickCaptureState(pub std::sync::Mutex<Option<Shortcut>>);

/// Ordered registration candidates: the preferred key first, then fallbacks,
/// deduplicated. Pure so the ordering is unit-testable.
fn candidates<'a>(preferred: &'a str, fallbacks: &[&'a str]) -> Vec<&'a str> {
    let mut list = vec![preferred];
    for f in fallbacks {
        if !list.contains(f) {
            list.push(f);
        }
    }
    list
}

/// Create the (hidden) quick-capture window. Idempotent; called once at
/// setup so the hotkey handler only ever needs to show it.
pub fn create_window(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window(WINDOW_LABEL).is_some() {
        return Ok(());
    }
    let rect = storage::load().settings.quick_capture_rect;
    let (width, height) = rect.map_or(DEFAULT_SIZE, |r| (r.width, r.height));
    let win = WebviewWindowBuilder::new(
        app,
        WINDOW_LABEL,
        WebviewUrl::App("quick-capture.html".into()),
    )
    .title("workhub — quick capture")
    .inner_size(width, height)
    .always_on_top(true)
    .skip_taskbar(true)
    .decorations(false)
    .visible(false)
    // The app is dark-only; paint the native window in the app background
    // color so no white flashes before WebView2 renders (index.css --background).
    .background_color(tauri::window::Color(0x14, 0x15, 0x1c, 0xff))
    .build()?;
    if let Some(r) = rect {
        let _ = win.set_position(LogicalPosition::new(r.x, r.y));
    }
    Ok(())
}

fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(WINDOW_LABEL)
}

/// Show the window (at the remembered spot, else centered on the monitor
/// under the cursor), focus it, and tell the frontend to (re)initialize the
/// form from the clipboard.
pub fn show(app: &AppHandle) {
    let Some(win) = window(app) else { return };
    if storage::load().settings.quick_capture_rect.is_none() {
        center_on_cursor_monitor(app, &win);
    }
    let _ = win.show();
    let _ = win.set_focus();
    let _ = app.emit_to(WINDOW_LABEL, "quick-capture://activate", ());
}

/// Remember the current window rect and hide. Persisting here (not on every
/// Moved/Resized) keeps config writes off the hot path.
pub fn hide(app: &AppHandle) {
    let Some(win) = window(app) else { return };
    if let Some(rect) = current_rect(&win) {
        let mut cfg = storage::load();
        cfg.settings.quick_capture_rect = Some(rect);
        storage::save(&cfg);
    }
    let _ = win.hide();
}

fn current_rect(win: &WebviewWindow) -> Option<WindowRect> {
    let (pos, size, scale) = (
        win.outer_position().ok()?,
        win.inner_size().ok()?,
        win.scale_factor().ok()?,
    );
    // A minimized window reports coordinates like (-32000, -32000); don't
    // remember those or the next open would be off-screen.
    if pos.x <= -30000 || pos.y <= -30000 || size.width == 0 {
        return None;
    }
    let pos = pos.to_logical::<f64>(scale);
    let size = size.to_logical::<f64>(scale);
    Some(WindowRect {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
    })
}

fn center_on_cursor_monitor(app: &AppHandle, win: &WebviewWindow) {
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|pos| app.monitor_from_point(pos.x, pos.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else { return };
    let Ok(size) = win.outer_size() else { return };
    let x = monitor.position().x + (monitor.size().width as i32 - size.width as i32) / 2;
    let y = monitor.position().y + (monitor.size().height as i32 - size.height as i32) / 2;
    let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
}

/// (Re)register the global hotkey from the current settings. Tries the
/// configured key first, then fallbacks, and reports what was actually
/// registered. Safe to call again after a settings change.
pub fn apply_shortcut(app: &AppHandle) {
    let settings = storage::load().settings;
    let state = app.state::<QuickCaptureState>();

    // Drop the previous registration (if any) before re-registering.
    if let Some(prev) = state.0.lock().unwrap().take() {
        let _ = app.global_shortcut().unregister(prev);
    }
    if !settings.quick_capture_enabled {
        return;
    }

    let preferred = settings.quick_capture_shortcut.as_str();
    for candidate in candidates(preferred, FALLBACK_SHORTCUTS) {
        let shortcut: Shortcut = match candidate.parse() {
            Ok(s) => s,
            Err(e) => {
                eprintln!("quick-capture: invalid shortcut {candidate}: {e}");
                continue;
            }
        };
        match app.global_shortcut().register(shortcut) {
            Ok(()) => {
                if candidate != preferred {
                    eprintln!(
                        "quick-capture: {preferred} is taken, registered {candidate} instead"
                    );
                }
                *state.0.lock().unwrap() = Some(shortcut);
                return;
            }
            Err(e) => eprintln!("quick-capture: failed to register {candidate}: {e}"),
        }
    }
    eprintln!("quick-capture: could not register any hotkey ({preferred})");
}

/// True when `pressed` is the hotkey currently registered for quick capture.
pub fn matches(app: &AppHandle, pressed: &Shortcut) -> bool {
    app.try_state::<QuickCaptureState>()
        .is_some_and(|s| s.0.lock().unwrap().as_ref() == Some(pressed))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidates_prefers_configured_key_then_fallbacks() {
        assert_eq!(
            candidates("Ctrl+Alt+N", &["Ctrl+Shift+N"]),
            vec!["Ctrl+Alt+N", "Ctrl+Shift+N"]
        );
    }

    #[test]
    fn candidates_dedupes_when_configured_equals_fallback() {
        assert_eq!(
            candidates("Ctrl+Shift+N", &["Ctrl+Shift+N"]),
            vec!["Ctrl+Shift+N"]
        );
    }

    #[test]
    fn settings_defaults() {
        let s = crate::models::Settings::default();
        assert!(s.quick_capture_enabled);
        assert_eq!(s.quick_capture_shortcut, "Ctrl+Alt+N");
        assert!(s.quick_capture_rect.is_none());
    }

    #[test]
    fn settings_deserialize_missing_fields_uses_defaults() {
        // Older config.json files predate the quick-capture keys; they must
        // deserialize with the defaults (config compatibility contract).
        let s: crate::models::Settings = serde_json::from_str("{}").unwrap();
        assert!(s.quick_capture_enabled);
        assert_eq!(s.quick_capture_shortcut, "Ctrl+Alt+N");
        assert!(s.quick_capture_rect.is_none());
    }
}
