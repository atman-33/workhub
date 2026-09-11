//! Docs viewer windows (T-0279): a document or one figure from the Docs tab,
//! popped out into a window of its own.
//!
//! The Docs tab's preview is a pane beside the tree, and a wide mermaid
//! diagram or a screenshot is drawn at whatever width that pane has left.
//! These windows are the way out: a whole document on a second screen, or one
//! diagram at a size where it can actually be read.
//!
//! Deliberately unlike the app's other helper windows:
//!
//! - **Built on demand, one per pop-out, destroyed on close.** The task
//!   editor and quick capture are pre-built and re-shown because they are one
//!   form that is opened constantly; a viewer is opened now and then, and
//!   several side by side is the point (two diagrams to compare, a document
//!   and the figure from it).
//! - **Decorated.** An ordinary window with the OS title bar: it is read for
//!   a while, maximized, snapped, moved between screens — everything the title
//!   bar already does, with nothing to re-implement.
//!
//! It still opens at the cursor, like every window here (see `window_place`).
//!
//! What to show is handed over as an opaque JSON payload, held here until the
//! window asks for it (`payload`). Passing it through the URL would cap its
//! size, and a figure payload carries a whole SVG or a data-URI image.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Every viewer's label starts with this; `capabilities/default.json` grants
/// the viewers their permissions by the same prefix.
pub const LABEL_PREFIX: &str = "docs-viewer-";

const DEFAULT_SIZE: (f64, f64) = (1000.0, 760.0);
const MIN_SIZE: (f64, f64) = (360.0, 240.0);

/// Payloads of the open viewers, by window label.
#[derive(Default)]
pub struct DocsViewerState {
    payloads: Mutex<HashMap<String, serde_json::Value>>,
    next: AtomicU32,
}

/// Opens a new viewer on `payload`. `payload.title`, when it is a string,
/// becomes the window title.
pub fn open(app: &AppHandle, payload: serde_json::Value) -> Result<(), String> {
    let state = app.state::<DocsViewerState>();
    let label = format!(
        "{LABEL_PREFIX}{}",
        state.next.fetch_add(1, Ordering::Relaxed) + 1
    );
    let title = payload
        .get("title")
        .and_then(|t| t.as_str())
        .filter(|t| !t.trim().is_empty())
        .map(|t| format!("{t} — workhub"))
        .unwrap_or_else(|| "workhub — docs".into());
    state
        .payloads
        .lock()
        .map_err(|e| e.to_string())?
        .insert(label.clone(), payload);

    let win = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("docs-viewer.html".into()))
        .title(title)
        .inner_size(DEFAULT_SIZE.0, DEFAULT_SIZE.1)
        .min_inner_size(MIN_SIZE.0, MIN_SIZE.1)
        .visible(false)
        // Dark-only app: paint the native window in the app background so no
        // white flashes before WebView2 renders (index.css --background).
        .background_color(tauri::window::Color(0x14, 0x15, 0x1c, 0xff))
        .build()
        .map_err(|e| {
            forget(app, &label);
            e.to_string()
        })?;

    let app_handle = app.clone();
    let closing = label.clone();
    win.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            forget(&app_handle, &closing);
        }
    });
    crate::window_place::place_at_cursor(app, &win);
    let _ = win.show();
    let _ = win.set_focus();
    Ok(())
}

/// The payload of the viewer labelled `label`, if it is one.
pub fn payload(app: &AppHandle, label: &str) -> Option<serde_json::Value> {
    let state = app.state::<DocsViewerState>();
    let payloads = state.payloads.lock().ok()?;
    payloads.get(label).cloned()
}

fn forget(app: &AppHandle, label: &str) {
    if let Ok(mut payloads) = app.state::<DocsViewerState>().payloads.lock() {
        payloads.remove(label);
    }
}
