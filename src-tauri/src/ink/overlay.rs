//! Ink overlay window lifecycle. One transparent, always-on-top, non-focusable
//! fullscreen webview (label `ink-overlay`) is created hidden at startup and
//! reused: on activation it is moved to the monitor under the cursor and shown;
//! on deactivation it is cleared, hidden, and made click-through again.

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

/// Show the overlay on the monitor currently under the mouse cursor and start
/// accepting strokes.
pub fn activate(app: &AppHandle) {
    let Some(win) = window(app) else { return };
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|pos| app.monitor_from_point(pos.x, pos.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    if let Some(monitor) = monitor {
        let _ = win.set_position(*monitor.position());
        let _ = win.set_size(*monitor.size());
    }
    let _ = win.show();
    let _ = win.set_ignore_cursor_events(false);
    let _ = app.emit_to(OVERLAY_LABEL, "ink://activate", ());
    // Make the pen-color crosshair appear immediately, not on first move.
    // Twice, with a delay: right after show() the webview may not be
    // hit-testable yet, and after a hide/show cycle Chromium needs fresh
    // pointer-over state before it honors cursor changes.
    std::thread::spawn(|| {
        for delay in [120, 300] {
            std::thread::sleep(std::time::Duration::from_millis(delay));
            jiggle_cursor();
        }
    });
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
    // Jiggle after the webview had time to apply the new CSS cursor; twice,
    // in case the first fires before the style landed.
    std::thread::spawn(|| {
        for delay in [80, 250] {
            std::thread::sleep(std::time::Duration::from_millis(delay));
            jiggle_cursor();
        }
    });
}

/// Walk the cursor a tiny square (net zero) via `SendInput` so the webview
/// re-evaluates its CSS cursor. Without this, a cursor change (pen-color
/// crosshair on activate / Alt+S) only becomes visible once the user
/// physically moves the mouse. `SetCursorPos` is NOT sufficient: it bypasses
/// the input pipeline and Chromium ignores its WM_MOUSEMOVE for cursor
/// re-evaluation until the page has seen a real pointer interaction. A single
/// ±1px `SendInput` pair also proved unreliable right after a hide/show cycle
/// (pointer-over state lost, moves coalesced away); a spaced multi-step walk
/// resembles physical motion closely enough to re-establish it.
fn jiggle_cursor() {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_MOVE, MOUSEINPUT,
    };
    fn mouse_move(dx: i32, dy: i32) -> INPUT {
        INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx,
                    dy,
                    mouseData: 0,
                    dwFlags: MOUSEEVENTF_MOVE,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }
    unsafe {
        for (dx, dy) in [(3, 0), (0, 3), (-3, 0), (0, -3)] {
            SendInput(&[mouse_move(dx, dy)], std::mem::size_of::<INPUT>() as i32);
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }
}
