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
//! Two deliberate departures from the other helper windows, both because this
//! is a window the user works in for a while rather than a pop-up that appears
//! and disappears:
//!
//! - **Not always-on-top.** It stays open for long stretches, so floating over
//!   every other app would make it a nuisance rather than a convenience.
//! - **Not hidden from the taskbar.** On a multi-screen desk a window with no
//!   taskbar entry is a window you cannot get back once something covers it.
//!
//! **Where it opens follows the house rule**, though: like every pop-up here it
//! remembers only its size and opens at the cursor (`window_place` explains
//! why — a window that reappears somewhere the user is not looking costs a
//! search every time). Restoring the last position was tried and rejected: the
//! editor is opened by clicking a card, so coming up on another screen meant
//! hunting for it. Parking it on a second screen still works, by leaving it
//! open — an already-visible window is never moved, only re-pointed at the
//! task that was just clicked.
//!
//! Being undecorated, the header stands in for the title bar: dragging moves
//! the window and double-clicking it toggles maximize, both from Tauri's
//! `data-tauri-drag-region` (see task-editor-form.tsx). Whether it was left
//! maximized *is* remembered, so it reopens the way it was closed.

use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
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
    // Only a window coming back from hidden gets placed. One that is already up
    // is being used — parked on another screen, most likely — and moving it
    // because a card was clicked would undo the user's own placement.
    if !win.is_visible().unwrap_or(false) {
        restore_geometry(app, &win);
        let _ = win.show();
    }
    let _ = win.unminimize();
    let _ = win.set_focus();
    app.emit_to(WINDOW_LABEL, "task-editor://open", payload)
}

/// Size the window from what was saved, put it where the user is looking, then
/// re-maximize if that is how it was left. Order matters: `place_at_cursor`
/// keeps the window inside a work area, which it can only do once the window is
/// the size it is going to be.
fn restore_geometry(app: &AppHandle, win: &WebviewWindow) {
    let settings = storage::load().settings;
    // Un-maximize first so the size below lands on the restored geometry —
    // that is what the window drops back to when the user un-maximizes it.
    let _ = win.unmaximize();
    if let Some(rect) = settings.task_editor_rect {
        let _ = win.set_size(LogicalSize::new(
            rect.width.max(MIN_SIZE.0),
            rect.height.max(MIN_SIZE.1),
        ));
    }
    crate::window_place::place_at_cursor(app, win);
    if settings.task_editor_maximized {
        let _ = win.maximize();
    }
}

/// Remember how the window was left, then hide it. Persisting here (not on
/// every Moved/Resized) keeps config writes off the hot path.
pub fn hide(app: &AppHandle) {
    let Some(win) = window(app) else { return };
    let maximized = win.is_maximized().unwrap_or(false);
    let mut cfg = storage::load();
    let mut dirty = cfg.settings.task_editor_maximized != maximized;
    cfg.settings.task_editor_maximized = maximized;
    // A maximized window reports the maximized size, which is not a size to
    // reopen at — keep the last restored one so un-maximizing has somewhere to
    // go back to.
    if !maximized {
        if let Some(rect) = current_rect(&win) {
            cfg.settings.task_editor_rect = Some(rect);
            dirty = true;
        }
    }
    if dirty {
        if let Err(e) = storage::save(&cfg) {
            eprintln!("task-editor: failed to persist window state: {e}");
        }
    }
    let _ = win.hide();
}

/// The window's current size, as a `WindowRect` whose position is zeroed: only
/// the size survives a close, so there is nothing to put in `x` and `y`.
/// `WindowRect` is the shape every window's saved geometry uses, and the
/// pop-ups that also discard their position store it the same way.
fn current_rect(win: &WebviewWindow) -> Option<WindowRect> {
    let (pos, size, scale) = (
        win.outer_position().ok()?,
        win.inner_size().ok()?,
        win.scale_factor().ok()?,
    );
    // A minimized window reports coordinates like (-32000, -32000) and a zero
    // size — nothing there is worth remembering.
    if pos.x <= -30000 || pos.y <= -30000 || size.width == 0 {
        return None;
    }
    let size = size.to_logical::<f64>(scale);
    Some(WindowRect {
        x: 0.0,
        y: 0.0,
        width: size.width,
        height: size.height,
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn settings_default_has_no_saved_rect() {
        let s = crate::models::Settings::default();
        assert!(s.task_editor_rect.is_none());
        assert!(!s.task_editor_maximized);
    }

    #[test]
    fn settings_deserialize_missing_field_uses_default() {
        // Config files written before this window existed have no such key;
        // they must still deserialize (config compatibility contract).
        let s: crate::models::Settings = serde_json::from_str("{}").unwrap();
        assert!(s.task_editor_rect.is_none());
        assert!(!s.task_editor_maximized);
    }
}
