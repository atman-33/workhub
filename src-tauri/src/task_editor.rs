//! Task editor: the window that edits (or creates) one task. Opened from the
//! board by clicking a card; the Rust side shows the pre-built window and
//! emits `task-editor://open` with the payload the form needs, and every open
//! re-initializes the form — the same contract as the quick-capture and
//! ink-preview windows.
//!
//! Built hidden at startup for the same reason those two are (see the
//! quick_capture.rs module docs) — re-showing a pre-built window is instant.
//! Closing (✕ / Alt+F4) hides the window instead of destroying it, so every
//! open after the first is a show. Esc deliberately does *not* close it: this
//! window is meant to sit open next to the board, and dismissing a form that
//! is being typed into by a stray Esc is a hard mistake to undo.
//!
//! Three deliberate departures from the other helper windows, all for the
//! same reason — this is a window the user parks on a second screen and works
//! in, not a pop-up that appears at the cursor and disappears again:
//!
//! - **Position is restored, not re-derived.** `window_place` explains why the
//!   pop-ups only remember their size and always open at the cursor; here the
//!   whole point is to reopen where it was left, so the saved position is
//!   applied and then clamped back into a work area (a second screen that is
//!   no longer attached would otherwise put it out of reach).
//! - **Not always-on-top.** It stays open for long stretches, so floating over
//!   every other app would make it a nuisance rather than a convenience.
//! - **Not hidden from the taskbar.** On a multi-screen desk a window with no
//!   taskbar entry is a window you cannot get back once something covers it.

use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use crate::models::WindowRect;
use crate::storage;

pub const WINDOW_LABEL: &str = "task-editor";
const DEFAULT_SIZE: (f64, f64) = (640.0, 720.0);
/// Below this the field grid collapses and the footer buttons stop fitting.
const MIN_SIZE: (f64, f64) = (380.0, 320.0);

/// Create the (hidden) editor window. Idempotent; called once at setup and
/// again from `open` if the window was somehow lost.
pub fn create_window(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window(WINDOW_LABEL).is_some() {
        return Ok(());
    }
    let saved = storage::load().settings.task_editor_rect;
    let (width, height) = saved.map_or(DEFAULT_SIZE, |r| {
        (r.width.max(MIN_SIZE.0), r.height.max(MIN_SIZE.1))
    });
    let win = WebviewWindowBuilder::new(
        app,
        WINDOW_LABEL,
        WebviewUrl::App("task-editor.html".into()),
    )
    .title("workhub — task editor")
    .inner_size(width, height)
    .min_inner_size(MIN_SIZE.0, MIN_SIZE.1)
    .decorations(false)
    .visible(false)
    // The app is dark-only; paint the native window in the app background
    // color so no white flashes before WebView2 renders (index.css --background).
    .background_color(tauri::window::Color(0x14, 0x15, 0x1c, 0xff))
    .build()?;
    let app_handle = app.clone();
    win.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            hide(&app_handle);
        }
    });
    Ok(())
}

fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(WINDOW_LABEL)
}

/// Show the editor on `payload` (the form's whole input: mode, task, project
/// suggestions, settings it needs), restoring the window where it was left.
/// Re-opening with another payload re-initializes the form, which is how
/// clicking a second card while the editor is open switches it over.
///
/// The payload is passed through opaquely: what the form needs is a frontend
/// concern, and threading a mirror of it through Rust would mean editing two
/// files every time a field is added.
pub fn open(app: &AppHandle, payload: serde_json::Value) -> tauri::Result<()> {
    if window(app).is_none() {
        create_window(app)?;
    }
    let Some(win) = window(app) else {
        return Ok(());
    };
    restore_rect(app, &win);
    let _ = win.show();
    let _ = win.unminimize();
    let _ = win.set_focus();
    app.emit_to(WINDOW_LABEL, "task-editor://open", payload)
}

/// Apply the saved position/size, then pull the window back into a work area.
/// The clamp is what makes an unplugged second screen recoverable: the saved
/// coordinates then resolve to no monitor, `clamp_to_work_area` falls back to
/// the primary one, and the window lands somewhere reachable.
fn restore_rect(app: &AppHandle, win: &WebviewWindow) {
    let Some(rect) = storage::load().settings.task_editor_rect else {
        // Never positioned by the user yet: put it where they are looking.
        crate::window_place::place_at_cursor(app, win);
        return;
    };
    let _ = win.set_size(LogicalSize::new(
        rect.width.max(MIN_SIZE.0),
        rect.height.max(MIN_SIZE.1),
    ));
    let _ = win.set_position(LogicalPosition::new(rect.x, rect.y));
    crate::window_place::clamp_to_work_area(app, win);
}

/// Remember the window's position and size, then hide it. Persisting here
/// (not on every Moved/Resized) keeps config writes off the hot path.
pub fn hide(app: &AppHandle) {
    let Some(win) = window(app) else { return };
    if let Some(rect) = current_rect(&win) {
        let mut cfg = storage::load();
        cfg.settings.task_editor_rect = Some(rect);
        if let Err(e) = storage::save(&cfg) {
            eprintln!("task-editor: failed to persist window rect: {e}");
        }
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

#[cfg(test)]
mod tests {
    #[test]
    fn settings_default_has_no_saved_rect() {
        assert!(crate::models::Settings::default()
            .task_editor_rect
            .is_none());
    }

    #[test]
    fn settings_deserialize_missing_field_uses_default() {
        // Config files written before this window existed have no such key;
        // they must still deserialize (config compatibility contract).
        let s: crate::models::Settings = serde_json::from_str("{}").unwrap();
        assert!(s.task_editor_rect.is_none());
    }
}
