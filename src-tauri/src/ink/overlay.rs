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
//!
//! Every activation is answered by the page; one that is not marks the page
//! dead and the window is rebuilt once the gesture ends (see `health.rs`).

use super::health::{OverlayHealth, ACK_TIMEOUT_MS};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use windows::Win32::System::SystemInformation::GetTickCount64;

pub const OVERLAY_LABEL: &str = "ink-overlay";

/// Whether the overlay page is still answering.
static HEALTH: Mutex<OverlayHealth> = Mutex::new(OverlayHealth::new());

/// How long a rebuild waits on each step (the main thread running a closure,
/// the old window's label being released) before giving up.
const REBUILD_STEP_TIMEOUT_MS: u64 = 2_500;
const DESTROY_POLL_MS: u64 = 50;

fn health() -> MutexGuard<'static, OverlayHealth> {
    HEALTH
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub fn create_overlay(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window(OVERLAY_LABEL).is_some() {
        return Ok(());
    }
    // A fresh page has not registered its listeners yet; activations sent
    // before it does are not held against it.
    health().on_window_created();
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
struct CursorPos {
    x: f64,
    y: f64,
}

/// `seq` is echoed back through `ink_overlay_ack`, which is how a dead page
/// is told apart from a live one.
#[derive(serde::Serialize, Clone)]
struct ActivatePayload {
    seq: u64,
    cursor: Option<CursorPos>,
}

/// Show the overlay on the monitor currently under the mouse cursor and start
/// accepting strokes.
pub fn activate(app: &AppHandle) {
    // The window is created once at startup, but it can be gone by now (a
    // webview crash, a close that got through). Rebuild it instead of
    // silently doing nothing, which from the outside is indistinguishable
    // from the gesture never being recognized.
    if window(app).is_none() {
        if let Err(e) = create_overlay(app) {
            crate::diag!("ink: failed to re-create the overlay window: {e}");
            return;
        }
    }
    let Some(win) = window(app) else { return };
    // Another always-on-top window (a screen-share toolbar, a game overlay)
    // may have taken the top of the z-order since the last activation, which
    // leaves the strokes drawn but invisible. Assert the flag again.
    if let Err(e) = win.set_always_on_top(true) {
        crate::diag!("ink: failed to re-assert always-on-top: {e}");
    }
    let cursor = app.cursor_position().ok();
    let monitor = cursor
        .and_then(|pos| app.monitor_from_point(pos.x, pos.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    let mut cursor_pos: Option<CursorPos> = None;
    if let Some(monitor) = &monitor {
        let _ = win.set_position(*monitor.position());
        let _ = win.set_size(*monitor.size());
        // Grab the screen *before* the overlay is shown: this is the picture
        // Alt+C composes the strokes onto, and a grab taken any later would
        // include them. Cheap enough (a BitBlt, no encoding) to sit in front
        // of the window becoming visible.
        let (pos, size) = (monitor.position(), monitor.size());
        super::store::capture_background(pos.x, pos.y, size.width as i32, size.height as i32);
        if let Some(cursor) = cursor {
            cursor_pos = Some(CursorPos {
                x: cursor.x - f64::from(pos.x),
                y: cursor.y - f64::from(pos.y),
            });
        }
    } else {
        super::store::clear_background();
    }
    if let Err(e) = win.show() {
        // Swallowing this used to turn a window-manager failure into "the
        // Alt gesture does nothing", with nothing anywhere to say otherwise.
        crate::diag!("ink: failed to show the overlay window: {e}");
        return;
    }
    let _ = win.set_ignore_cursor_events(false);
    let activation = health().on_activate();
    crate::diag!(
        "ink: gesture recognised, overlay activation #{}{}",
        activation.seq,
        if activation.checked {
            ""
        } else {
            " (page not ready yet, answer not checked)"
        }
    );
    let payload = ActivatePayload {
        seq: activation.seq,
        cursor: cursor_pos,
    };
    if let Err(e) = app.emit_to(OVERLAY_LABEL, "ink://activate", payload) {
        crate::diag!(
            "ink: failed to send activation #{} to the overlay: {e}",
            activation.seq
        );
    }
    if activation.checked {
        watch_for_answer(app, activation.seq);
    }
}

/// Clear all strokes, hide the overlay, and restore click-through.
pub fn deactivate(app: &AppHandle) {
    super::store::clear_background();
    health().on_deactivate();
    if let Some(win) = window(app) {
        let _ = app.emit_to(OVERLAY_LABEL, "ink://deactivate", ());
        let _ = win.set_ignore_cursor_events(true);
        let _ = win.hide();
    }
    // A page that stopped answering during this gesture is replaced now that
    // nothing is being drawn on it.
    rebuild_if_due(app, false, "the overlay page stopped answering");
}

/// The overlay page has registered its listeners (sent once per page load).
pub fn on_page_ready() {
    health().on_ready();
}

/// The overlay page received activation `seq`.
pub fn on_page_ack(seq: u64) {
    health().on_ack(seq);
}

/// Replace the overlay window with a new one: the manual restart's half of
/// the recovery. Runs even when nothing looks wrong, because the page can be
/// broken in ways the answer check does not see.
pub fn rebuild(app: &AppHandle) {
    rebuild_if_due(app, true, "a manual restart");
}

/// Give the page `ACK_TIMEOUT_MS` to answer activation `seq`.
fn watch_for_answer(app: &AppHandle, seq: u64) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(ACK_TIMEOUT_MS));
        let (unanswered, active) = {
            let mut h = health();
            (h.on_timeout(seq), h.is_active())
        };
        if !unanswered {
            return;
        }
        crate::diag!(
            "ink: overlay page did not answer activation #{seq} within {ACK_TIMEOUT_MS}ms; {}",
            if active {
                "rebuilding it once the gesture ends"
            } else {
                "rebuilding it"
            }
        );
        if !active {
            rebuild_if_due(&app, false, "the overlay page stopped answering");
        }
    });
}

fn rebuild_if_due(app: &AppHandle, force: bool, reason: &'static str) {
    let now = unsafe { GetTickCount64() };
    if !health().take_rebuild(now, force) {
        return;
    }
    let app = app.clone();
    // Never on the main thread: `destroy` only takes effect once the event
    // loop gets back to it, and waiting for that from inside it would hang.
    std::thread::spawn(move || {
        crate::diag!("ink: rebuilding the overlay window after {reason}");
        match replace_window(&app) {
            Ok(()) => crate::diag!("ink: overlay window rebuilt"),
            Err(e) => crate::diag!("ink: overlay rebuild failed: {e}"),
        }
        health().on_rebuilt();
    });
}

/// Run `f` on the main thread and wait for its result.
fn on_main_thread<T: Send + 'static>(
    app: &AppHandle,
    f: impl FnOnce(&AppHandle) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = tx.send(f(&handle));
    })
    .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_millis(REBUILD_STEP_TIMEOUT_MS))
        .map_err(|_| "the main thread did not respond".to_string())?
}

/// Destroy the overlay window, wait for its label to be released, and build
/// a new one. Blocking; call from a background thread.
fn replace_window(app: &AppHandle) -> Result<(), String> {
    on_main_thread(app, |app| match window(app) {
        Some(win) => win.destroy().map_err(|e| e.to_string()),
        None => Ok(()),
    })?;
    let mut waited = 0;
    while window(app).is_some() {
        if waited >= REBUILD_STEP_TIMEOUT_MS {
            return Err("the old window was not released".into());
        }
        std::thread::sleep(Duration::from_millis(DESTROY_POLL_MS));
        waited += DESTROY_POLL_MS;
    }
    on_main_thread(app, |app| create_overlay(app).map_err(|e| e.to_string()))
}

/// Cycle the pen color for new strokes (red → blue → green).
pub fn cycle_color(app: &AppHandle) {
    let _ = app.emit_to(OVERLAY_LABEL, "ink://cycle-color", ());
}

/// Ask the overlay for its strokes so they can be composed onto the screen
/// grab and saved. Drawing continues: the answer comes back as the
/// `save_ink_capture` command, and the overlay reports the outcome itself.
pub fn request_save(app: &AppHandle) {
    let _ = app.emit_to(OVERLAY_LABEL, "ink://save", ());
}
