//! Clips popup window lifecycle.
//!
//! Like `quick_capture.rs`, the window is created hidden at startup and only
//! ever shown/hidden from here — never built from the gesture handler, which
//! runs on the raw-input thread and hops to the main thread (building a
//! WebView2 window from inside the main event loop self-blocks for ~10s).
//!
//! Unlike the ink overlay and the voice indicator, this window *takes* focus:
//! it has a filter box and arrow-key navigation. The window that had focus
//! when the gesture fired is therefore remembered here, and focus is handed
//! back to it before the snippet is pasted (see `paste_clip`).

use tauri::{AppHandle, Emitter, LogicalPosition, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri::{Runtime, WebviewWindow};

use crate::models::WindowRect;
use crate::storage;

pub const WINDOW_LABEL: &str = "clips-popup";
const DEFAULT_SIZE: (f64, f64) = (460.0, 420.0);

/// Create the (hidden) popup window. Idempotent; called once at setup.
pub fn create_window(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window(WINDOW_LABEL).is_some() {
        return Ok(());
    }
    let rect = storage::load().settings.clips_rect;
    let (width, height) = rect.map_or(DEFAULT_SIZE, |r| (r.width, r.height));
    let win = WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::App("clips.html".into()))
        .title("workhub — clips")
        .inner_size(width, height)
        .min_inner_size(320.0, 220.0)
        .always_on_top(true)
        .skip_taskbar(true)
        .decorations(false)
        .visible(false)
        // The app is dark-only; paint the native window in the app background
        // color so no white flashes before WebView2 renders (index.css).
        .background_color(tauri::window::Color(0x14, 0x15, 0x1c, 0xff))
        .build()?;
    if let Some(r) = rect {
        let _ = win.set_position(LogicalPosition::new(r.x, r.y));
    }
    // Clicking away is the same as pressing Escape — a picker that lingers
    // behind the window you were typing into is just clutter.
    let app_handle = app.clone();
    win.on_window_event(move |event| {
        if let tauri::WindowEvent::Focused(false) = event {
            hide(&app_handle);
        }
    });
    Ok(())
}

fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(WINDOW_LABEL)
}

/// Show the popup centered on the monitor under the cursor (or at its
/// remembered spot), remembering which window had focus so the paste can go
/// back to it.
pub fn show(app: &AppHandle) {
    let Some(win) = window(app) else { return };
    if win.is_visible().unwrap_or(false) {
        return;
    }
    super::remember_paste_target(app);
    if storage::load().settings.clips_rect.is_none() {
        center_on_cursor_monitor(app, &win);
    }
    let _ = win.show();
    let _ = win.set_focus();
    let _ = app.emit_to(WINDOW_LABEL, "clips://activate", ());
}

/// Remember the current window rect and hide. Persisting here (not on every
/// Moved/Resized) keeps config writes off the hot path.
pub fn hide(app: &AppHandle) {
    let Some(win) = window(app) else { return };
    if !win.is_visible().unwrap_or(false) {
        return;
    }
    if let Some(rect) = current_rect(&win) {
        let mut cfg = storage::load();
        cfg.settings.clips_rect = Some(rect);
        if let Err(e) = storage::save(&cfg) {
            eprintln!("clips: failed to persist window rect: {e}");
        }
    }
    let _ = win.hide();
}

fn current_rect<R: Runtime>(win: &WebviewWindow<R>) -> Option<WindowRect> {
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
