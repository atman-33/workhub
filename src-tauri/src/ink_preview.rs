//! Ink preview: a floating always-on-top window that shows one saved capture
//! at full size, with the crop selection on top of it. Opened from the Ink
//! tab by clicking a thumbnail; dragged by its header, resized like any
//! window (undecorated, but Windows still gives it resize borders and
//! resize cursors), dismissed with Esc or its close button.
//!
//! Built hidden at startup for the same reason quick capture is (see
//! quick_capture.rs module docs) — re-showing a pre-built window is instant
//! and cannot hit the message-pump self-block a build inside a Windows event
//! handler suffers. Closing (✕ / Esc / Alt+F4) hides the window instead of
//! destroying it, so every open after the first is a show.

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::models::WindowRect;
use crate::storage;

pub const WINDOW_LABEL: &str = "ink-preview";
const DEFAULT_SIZE: (f64, f64) = (960.0, 640.0);
/// Below this the crop handles and the header controls stop being usable.
const MIN_SIZE: (f64, f64) = (420.0, 300.0);

#[derive(serde::Serialize, Clone)]
struct OpenPayload {
    path: String,
}

/// Create the (hidden) preview window. Idempotent; called once at setup and
/// again from `open` if the window was somehow lost.
pub fn create_window(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window(WINDOW_LABEL).is_some() {
        return Ok(());
    }
    // Only the size is carried over; the window always opens at the cursor
    // (see `open`), so the saved position is deliberately ignored.
    let (width, height) = storage::load()
        .settings
        .ink_preview_rect
        .map_or(DEFAULT_SIZE, |r| {
            (r.width.max(MIN_SIZE.0), r.height.max(MIN_SIZE.1))
        });
    let win = WebviewWindowBuilder::new(
        app,
        WINDOW_LABEL,
        WebviewUrl::App("ink-preview.html".into()),
    )
    .title("workhub — ink preview")
    .inner_size(width, height)
    .min_inner_size(MIN_SIZE.0, MIN_SIZE.1)
    // Stays above the main window while a crop is in progress, so a stray
    // click on the app never buries it mid-selection. Esc or ✕ dismisses it.
    .always_on_top(true)
    .skip_taskbar(true)
    .decorations(false)
    .visible(false)
    // The app is dark-only; paint the native window in the app background
    // color so no white flashes before WebView2 renders.
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

/// Show the window over `path`: place it at the cursor (next to the
/// thumbnail click that opened it), focus it, and tell the frontend to load
/// the image. Re-opening with another path re-initializes the form.
pub fn open(app: &AppHandle, path: String) -> tauri::Result<()> {
    if app.get_webview_window(WINDOW_LABEL).is_none() {
        create_window(app)?;
    }
    let Some(win) = app.get_webview_window(WINDOW_LABEL) else {
        return Ok(());
    };
    crate::window_place::place_at_cursor(app, &win);
    let _ = win.show();
    let _ = win.set_focus();
    app.emit_to(WINDOW_LABEL, "ink-preview://open", OpenPayload { path })
}

/// Remember the window's size and hide it. Persisting here (not on every
/// Moved/Resized) keeps config writes off the hot path.
pub fn hide(app: &AppHandle) {
    let Some(win) = app.get_webview_window(WINDOW_LABEL) else {
        return;
    };
    if let Some(rect) = current_rect(&win) {
        let mut cfg = storage::load();
        cfg.settings.ink_preview_rect = Some(rect);
        if let Err(e) = storage::save(&cfg) {
            eprintln!("ink-preview: failed to persist window rect: {e}");
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
    // remember those.
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
