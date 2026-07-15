//! Ink overlay window lifecycle. One transparent, always-on-top, non-focusable
//! fullscreen webview (label `ink-overlay`) is created hidden at startup and
//! reused: on activation it is moved to the monitor under the cursor and shown;
//! on deactivation it is cleared, hidden, and made click-through again.
//!
//! The current pen color is shown by the webview as a cursor-following DOM
//! chip (plus the bottom-center palette badge) — NOT via the OS cursor:
//! WebView2/Windows cache the visible cursor and ignore CSS cursor changes
//! until a real pointer interaction, which made a pen-colored cursor
//! unreliable no matter how the change was nudged (SetCursorPos and SendInput
//! jiggles both failed in the pre-first-click state).

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const OVERLAY_LABEL: &str = "ink-overlay";

pub fn create_overlay(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window(OVERLAY_LABEL).is_some() {
        return Ok(());
    }
    let win = WebviewWindowBuilder::new(app, OVERLAY_LABEL, WebviewUrl::App("overlay.html".into()))
        .title("workhub ink overlay")
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        // Non-focusable (WS_EX_NOACTIVATE): drawing must not steal keyboard
        // focus from the app being annotated. Mouse input still arrives.
        .focusable(false)
        .focused(false)
        .visible(false)
        .shadow(false)
        .build()?;
    win.set_ignore_cursor_events(true)?;
    Ok(())
}

fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(OVERLAY_LABEL)
}

/// Cursor position at activation, in physical pixels relative to the chosen
/// monitor's (= overlay window's) origin. Lets the webview place the
/// pen-color chip immediately, before the first pointermove arrives.
#[derive(serde::Serialize, Clone)]
struct ActivatePayload {
    x: f64,
    y: f64,
}

/// Show the overlay on the monitor currently under the mouse cursor and start
/// accepting strokes.
pub fn activate(app: &AppHandle) {
    let Some(win) = window(app) else { return };
    let cursor = app.cursor_position().ok();
    let monitor = cursor
        .and_then(|pos| app.monitor_from_point(pos.x, pos.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    let mut payload: Option<ActivatePayload> = None;
    if let Some(monitor) = &monitor {
        let _ = win.set_position(*monitor.position());
        let _ = win.set_size(*monitor.size());
        if let Some(pos) = cursor {
            payload = Some(ActivatePayload {
                x: pos.x - f64::from(monitor.position().x),
                y: pos.y - f64::from(monitor.position().y),
            });
        }
    }
    let _ = win.show();
    let _ = win.set_ignore_cursor_events(false);
    let _ = app.emit_to(OVERLAY_LABEL, "ink://activate", payload);
}

/// Clear all strokes, hide the overlay, and restore click-through.
pub fn deactivate(app: &AppHandle) {
    let Some(win) = window(app) else { return };
    let _ = app.emit_to(OVERLAY_LABEL, "ink://deactivate", ());
    let _ = win.set_ignore_cursor_events(true);
    let _ = win.hide();
}

/// Cycle the pen color for new strokes (red → blue → green).
pub fn cycle_color(app: &AppHandle) {
    let _ = app.emit_to(OVERLAY_LABEL, "ink://cycle-color", ());
}
