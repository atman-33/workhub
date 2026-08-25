//! Placing the pop-up helper windows (clips picker, quick capture, voice
//! indicator) on screen.
//!
//! They open where the user is already looking: invoked from inside another
//! app, by a gesture or a hotkey, so the eye is at the mouse cursor — or, for
//! the voice indicator, at the text caret the transcript is about to land in.
//! That is also why none of them remembers *where* it was left — only how big
//! it was. A window that reopens somewhere the user is not looking costs a
//! search every time.

use crate::caret::CaretRect;
use tauri::{AppHandle, PhysicalPosition, WebviewWindow};

/// Gap between the cursor and the window's top-left corner, in physical
/// pixels: enough that the pointer is not sitting on top of the first row.
const CURSOR_OFFSET: i32 = 12;

/// Vertical gap between the caret's text line and the window, in physical
/// pixels. Larger than `CURSOR_OFFSET` so the window clears descenders and
/// whatever the target app draws right under the caret line.
const CARET_GAP: i32 = 8;

/// Nudges `(x, y)` so a `size`-sized window sits fully inside `area`.
/// Clamping the origin up (rather than down) wins when the window is larger
/// than the area, which keeps its top-left visible instead of its bottom-right.
fn clamp_into(
    pos: (i32, i32),
    size: (i32, i32),
    area_pos: (i32, i32),
    area_size: (i32, i32),
) -> (i32, i32) {
    let clamp =
        |v: i32, len: i32, area_v: i32, area_len: i32| (v.min(area_v + area_len - len)).max(area_v);
    (
        clamp(pos.0, size.0, area_pos.0, area_size.0),
        clamp(pos.1, size.1, area_pos.1, area_size.1),
    )
}

/// Move `win` next to the mouse cursor, kept inside the work area of the
/// monitor the cursor is on (so it never lands under the taskbar or off the
/// edge). Falls back to the center of that work area when there is no cursor
/// position to be had.
pub fn place_at_cursor(app: &AppHandle, win: &WebviewWindow) {
    let Ok(size) = win.outer_size() else { return };
    let cursor = app.cursor_position().ok();
    let monitor = cursor
        .and_then(|pos| app.monitor_from_point(pos.x, pos.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else { return };

    let area = monitor.work_area();
    let area_pos = (area.position.x, area.position.y);
    let area_size = (area.size.width as i32, area.size.height as i32);
    let size = (size.width as i32, size.height as i32);

    let target = match cursor {
        Some(pos) => (pos.x as i32 + CURSOR_OFFSET, pos.y as i32 + CURSOR_OFFSET),
        None => (
            area_pos.0 + (area_size.0 - size.0) / 2,
            area_pos.1 + (area_size.1 - size.1) / 2,
        ),
    };
    let (x, y) = clamp_into(target, size, area_pos, area_size);
    let _ = win.set_position(PhysicalPosition::new(x, y));
}

/// Picks the origin for a `size`-sized window anchored to a caret: below the
/// caret's line by default, flipped above it when there is not enough room
/// left below. Column-aligned with the caret so the window reads as
/// belonging to the text being dictated.
fn anchor_to_caret(
    caret: CaretRect,
    size: (i32, i32),
    area_pos: (i32, i32),
    area_size: (i32, i32),
) -> (i32, i32) {
    let below = caret.y + caret.height + CARET_GAP;
    let fits_below = below + size.1 <= area_pos.1 + area_size.1;
    let y = if fits_below {
        below
    } else {
        caret.y - CARET_GAP - size.1
    };
    clamp_into((caret.x, y), size, area_pos, area_size)
}

/// Move `win` next to the focused app's text caret, kept inside the work area
/// of the monitor that caret is on. Returns `false` when the monitor could
/// not be resolved and nothing was moved, so the caller can fall back.
pub fn place_near_caret(app: &AppHandle, win: &WebviewWindow, caret: CaretRect) -> bool {
    let Ok(size) = win.outer_size() else {
        return false;
    };
    let monitor = app
        .monitor_from_point(caret.x as f64, caret.y as f64)
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else { return false };

    let area = monitor.work_area();
    let (x, y) = anchor_to_caret(
        caret,
        (size.width as i32, size.height as i32),
        (area.position.x, area.position.y),
        (area.size.width as i32, area.size.height as i32),
    );
    let _ = win.set_position(PhysicalPosition::new(x, y));
    true
}

/// Pulls `win` back inside the work area it currently sits on. Called after a
/// resize that grew the window (the voice indicator's preview panel), which
/// can otherwise push its bottom edge off-screen.
pub fn clamp_to_work_area(app: &AppHandle, win: &WebviewWindow) {
    let (Ok(size), Ok(pos)) = (win.outer_size(), win.outer_position()) else {
        return;
    };
    let monitor = app
        .monitor_from_point(pos.x as f64, pos.y as f64)
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else { return };

    let area = monitor.work_area();
    let (x, y) = clamp_into(
        (pos.x, pos.y),
        (size.width as i32, size.height as i32),
        (area.position.x, area.position.y),
        (area.size.width as i32, area.size.height as i32),
    );
    if (x, y) != (pos.x, pos.y) {
        let _ = win.set_position(PhysicalPosition::new(x, y));
    }
}

#[cfg(test)]
mod tests {
    use super::{anchor_to_caret, clamp_into, CaretRect, CARET_GAP};

    const AREA_POS: (i32, i32) = (0, 0);
    const AREA_SIZE: (i32, i32) = (1920, 1040); // 1080 minus a taskbar
    const PILL: (i32, i32) = (340, 48);

    fn caret(x: i32, y: i32) -> CaretRect {
        CaretRect {
            x,
            y,
            width: 0,
            height: 18,
        }
    }

    #[test]
    fn the_indicator_sits_under_the_caret_line() {
        assert_eq!(
            anchor_to_caret(caret(400, 300), PILL, AREA_POS, AREA_SIZE),
            (400, 300 + 18 + CARET_GAP)
        );
    }

    #[test]
    fn a_caret_near_the_bottom_flips_the_indicator_above_it() {
        let c = caret(400, 1030);
        assert_eq!(
            anchor_to_caret(c, PILL, AREA_POS, AREA_SIZE),
            (400, 1030 - CARET_GAP - PILL.1)
        );
    }

    #[test]
    fn a_caret_near_the_right_edge_pulls_the_indicator_back_in() {
        let (x, _) = anchor_to_caret(caret(1900, 300), PILL, AREA_POS, AREA_SIZE);
        assert_eq!(x, 1920 - PILL.0);
    }

    #[test]
    fn a_caret_on_a_secondary_monitor_stays_on_that_monitor() {
        let area_pos = (-1920, -200);
        let area_size = (1920, 1040);
        assert_eq!(
            anchor_to_caret(caret(-1800, 500), PILL, area_pos, area_size),
            (-1800, 500 + 18 + CARET_GAP)
        );
    }

    #[test]
    fn a_window_that_already_fits_is_left_alone() {
        assert_eq!(
            clamp_into((100, 200), (460, 420), AREA_POS, AREA_SIZE),
            (100, 200)
        );
    }

    #[test]
    fn a_window_past_the_right_or_bottom_edge_is_pulled_back_in() {
        assert_eq!(
            clamp_into((1800, 900), (460, 420), AREA_POS, AREA_SIZE),
            (1920 - 460, 1040 - 420)
        );
    }

    #[test]
    fn the_taskbar_area_is_excluded() {
        // Bottom edge is the work area's 1040, not the monitor's 1080.
        let (_, y) = clamp_into((0, 1039), (460, 420), AREA_POS, AREA_SIZE);
        assert_eq!(y, 1040 - 420);
    }

    #[test]
    fn a_window_larger_than_the_area_keeps_its_top_left_visible() {
        assert_eq!(
            clamp_into((300, 300), (3000, 2000), AREA_POS, AREA_SIZE),
            (0, 0)
        );
    }

    #[test]
    fn a_secondary_monitor_at_negative_coordinates_works() {
        let area_pos = (-1920, -200);
        let area_size = (1920, 1040);
        // Cursor near that monitor's bottom-right corner.
        assert_eq!(
            clamp_into((-100, 800), (460, 420), area_pos, area_size),
            (-1920 + 1920 - 460, -200 + 1040 - 420)
        );
    }
}
