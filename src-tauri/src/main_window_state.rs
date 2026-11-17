//! Remembering how the main window was left (T-1275).
//!
//! Unlike the pop-up helper windows (see `window_place`), the main window is
//! one the user arranges once and expects to find again: its size, where it
//! sits — including which monitor — and whether it was maximized. That is
//! what this module saves and restores.
//!
//! The state lives in `~/.workhub/config.json` (`Settings::main_window_rect`
//! and `main_window_maximized`), next to the helper windows' rects. It is
//! machine-local on purpose: it is not in `vault_settings::VAULT_SCOPED`, so
//! switching vaults never moves the window.
//!
//! The decisions are plain functions of numbers so each has a test; the
//! functions that touch the window are thin wrappers around them.
//!
//! - **Restoring** happens in `setup`, while the window is still hidden
//!   (`tauri.conf.json` creates it `visible: false`), so the default size is
//!   never painted. The reveal that follows the zoom (T-0491) is untouched,
//!   and so is the minimized start after a sign-in launch.
//! - **Saving** happens when the window closes, shortly after it moves or
//!   resizes, and before a self-update restarts the process — `app.restart()`
//!   does not go through `CloseRequested`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition, WebviewWindow};

use crate::models::MainWindowRect;
use crate::storage;
use crate::window_place::clamp_into;

const WINDOW_LABEL: &str = "main";

/// Smallest size the window may be restored at, in logical pixels. Mirrors
/// `minWidth` / `minHeight` in `tauri.conf.json`.
const MIN_SIZE: (f64, f64) = (720.0, 440.0);

/// How far into the saved window (physical pixels, right and down from its
/// top-left corner) the point sits that must still be on a monitor for the
/// saved position to count as reachable. It lands on the title bar, which is
/// what the user grabs to bring a window back.
const PROBE: (i32, i32) = (48, 16);

/// Wait between a move/resize and the save it triggers, so dragging the
/// window does not write the config file on every pixel.
const SAVE_DELAY: Duration = Duration::from_millis(1000);

/// A monitor's work area (the screen minus the taskbar) in physical pixels,
/// with the scale factor that turns saved logical sizes into physical ones.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Area {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub scale: f64,
}

impl Area {
    fn contains(&self, point: (i32, i32)) -> bool {
        point.0 >= self.x
            && point.0 < self.x + self.width
            && point.1 >= self.y
            && point.1 < self.y + self.height
    }
}

/// Where and how large to put the window: the position in physical pixels
/// (outer top-left), the size in logical pixels (inner).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Placement {
    pub position: (i32, i32),
    pub size: (f64, f64),
}

/// Turns a saved rect into a placement that is on screen *now*.
///
/// - The saved position is kept when its title-bar point (see [`PROBE`]) is
///   inside some monitor's work area, and pulled fully inside that work area.
/// - Otherwise — the monitor it was on is gone, or the layout changed — the
///   position is dropped and the window is centered on `primary` (or the
///   first monitor when there is no primary).
/// - The size is never below [`MIN_SIZE`] and never above the work area it
///   lands on; the work area wins if the two disagree.
///
/// `None` when there are no monitors at all, so the caller leaves the window
/// as the config created it.
pub fn fit_to_monitors(
    saved: &MainWindowRect,
    areas: &[Area],
    primary: Option<Area>,
) -> Option<Placement> {
    let probe = (saved.x + PROBE.0, saved.y + PROBE.1);
    let on_monitor = areas.iter().copied().find(|a| a.contains(probe));
    let target = on_monitor.or(primary).or_else(|| areas.first().copied())?;

    let to_physical = |logical: f64| (logical * target.scale).round() as i32;
    let width = to_physical(saved.width)
        .max(to_physical(MIN_SIZE.0))
        .min(target.width);
    let height = to_physical(saved.height)
        .max(to_physical(MIN_SIZE.1))
        .min(target.height);

    let position = if on_monitor.is_some() {
        clamp_into(
            (saved.x, saved.y),
            (width, height),
            (target.x, target.y),
            (target.width, target.height),
        )
    } else {
        (
            target.x + (target.width - width) / 2,
            target.y + (target.height - height) / 2,
        )
    };
    Some(Placement {
        position,
        size: (width as f64 / target.scale, height as f64 / target.scale),
    })
}

/// The window's geometry as it is now, as the config stores it. `None` for a
/// minimized window, which reports coordinates like (-32000, -32000) and a
/// zero size — nothing there is worth remembering.
pub fn snapshot(
    position: (i32, i32),
    inner_size: (u32, u32),
    scale: f64,
) -> Option<MainWindowRect> {
    if position.0 <= -30000 || position.1 <= -30000 || inner_size.0 == 0 || inner_size.1 == 0 {
        return None;
    }
    Some(MainWindowRect {
        x: position.0,
        y: position.1,
        width: inner_size.0 as f64 / scale,
        height: inner_size.1 as f64 / scale,
    })
}

/// What was seen on the window when a save was asked for.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Observed {
    pub minimized: bool,
    pub maximized: bool,
    pub rect: Option<MainWindowRect>,
}

/// The state to store, given the one stored and what the window looks like.
///
/// A minimized window changes nothing. A maximized one only sets the flag:
/// the rect stays at the last *restored* geometry, so un-maximizing after the
/// next start lands where the window used to be (the task editor does the
/// same). Anything else replaces the rect and clears the flag.
pub fn next_state(
    stored: (Option<MainWindowRect>, bool),
    observed: Observed,
) -> (Option<MainWindowRect>, bool) {
    if observed.minimized {
        return stored;
    }
    if observed.maximized {
        return (stored.0, true);
    }
    (observed.rect.or(stored.0), false)
}

fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(WINDOW_LABEL)
}

fn observe(win: &WebviewWindow) -> Observed {
    let rect = match (win.outer_position(), win.inner_size(), win.scale_factor()) {
        (Ok(pos), Ok(size), Ok(scale)) => {
            snapshot((pos.x, pos.y), (size.width, size.height), scale)
        }
        _ => None,
    };
    Observed {
        minimized: win.is_minimized().unwrap_or(false),
        maximized: win.is_maximized().unwrap_or(false),
        rect,
    }
}

/// Persist how the window looks now. Writes only when something changed, so
/// calling it on every move/resize burst and on close is cheap.
pub fn save(app: &AppHandle) {
    let Some(win) = window(app) else { return };
    let observed = observe(&win);
    let mut cfg = storage::load();
    let stored = (
        cfg.settings.main_window_rect,
        cfg.settings.main_window_maximized,
    );
    let next = next_state(stored, observed);
    if next == stored {
        return;
    }
    (
        cfg.settings.main_window_rect,
        cfg.settings.main_window_maximized,
    ) = next;
    if let Err(e) = storage::save(&cfg) {
        crate::diag!("main-window: failed to persist window state: {e}");
    }
}

static SAVE_PENDING: AtomicBool = AtomicBool::new(false);

/// Ask for a [`save`] shortly from now. Many calls inside [`SAVE_DELAY`]
/// collapse into one save, taken at the end of the wait.
pub fn schedule_save(app: &AppHandle) {
    if SAVE_PENDING.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(SAVE_DELAY);
        SAVE_PENDING.store(false, Ordering::SeqCst);
        save(&app);
    });
}

fn areas(app: &AppHandle) -> Vec<Area> {
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .map(area_of)
        .collect()
}

fn area_of(monitor: &tauri::Monitor) -> Area {
    let work = monitor.work_area();
    Area {
        x: work.position.x,
        y: work.position.y,
        width: work.size.width as i32,
        height: work.size.height as i32,
        scale: monitor.scale_factor(),
    }
}

/// Put the (still hidden) main window back the way it was left. Does nothing
/// on a first run, when there is nothing saved.
pub fn restore(app: &AppHandle) {
    let Some(win) = window(app) else { return };
    let settings = storage::load().settings;
    if let Some(saved) = settings.main_window_rect {
        let primary = app.primary_monitor().ok().flatten().map(|m| area_of(&m));
        if let Some(placement) = fit_to_monitors(&saved, &areas(app), primary) {
            // Position first: it can move the window to a monitor with a
            // different scale, and the logical size is read against the
            // monitor the window is on when it is set.
            let _ = win.set_position(PhysicalPosition::new(
                placement.position.0,
                placement.position.1,
            ));
            let _ = win.set_size(LogicalSize::new(placement.size.0, placement.size.1));
        }
    }
    if settings.main_window_maximized {
        let _ = win.maximize();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Settings;

    const PRIMARY: Area = Area {
        x: 0,
        y: 0,
        width: 1920,
        height: 1040, // 1080 minus a taskbar
        scale: 1.0,
    };
    /// A second monitor to the left of the primary, hence negative x.
    const LEFT: Area = Area {
        x: -1920,
        y: -200,
        width: 1920,
        height: 1040,
        scale: 1.0,
    };

    fn rect(x: i32, y: i32, width: f64, height: f64) -> MainWindowRect {
        MainWindowRect {
            x,
            y,
            width,
            height,
        }
    }

    fn fit(saved: MainWindowRect, areas: &[Area]) -> Placement {
        fit_to_monitors(&saved, areas, areas.first().copied()).unwrap()
    }

    #[test]
    fn a_window_that_fits_is_put_back_exactly() {
        let p = fit(rect(200, 100, 1200.0, 800.0), &[PRIMARY]);
        assert_eq!(p.position, (200, 100));
        assert_eq!(p.size, (1200.0, 800.0));
    }

    #[test]
    fn a_window_on_a_secondary_monitor_stays_there() {
        let p = fit(rect(-1700, 0, 1000.0, 700.0), &[PRIMARY, LEFT]);
        assert_eq!(p.position, (-1700, 0));
    }

    #[test]
    fn a_window_whose_monitor_is_gone_is_centered_on_the_primary() {
        // Saved on LEFT; only PRIMARY is plugged in now.
        let p = fit(rect(-1700, 0, 1000.0, 700.0), &[PRIMARY]);
        assert_eq!(p.position, ((1920 - 1000) / 2, (1040 - 700) / 2));
        assert_eq!(p.size, (1000.0, 700.0));
    }

    #[test]
    fn a_position_that_no_monitor_covers_any_more_is_dropped() {
        // Same monitors as before, but the saved spot is below all of them.
        let p = fit(rect(300, 5000, 1000.0, 700.0), &[PRIMARY]);
        assert_eq!(p.position, ((1920 - 1000) / 2, (1040 - 700) / 2));
    }

    #[test]
    fn a_window_hanging_off_the_edge_is_pulled_back_inside() {
        let p = fit(rect(1500, 600, 1000.0, 700.0), &[PRIMARY]);
        assert_eq!(p.position, (1920 - 1000, 1040 - 700));
    }

    #[test]
    fn a_window_larger_than_the_work_area_shrinks_to_it() {
        // A monitor that got smaller since the window was saved.
        let p = fit(rect(0, 0, 3000.0, 2000.0), &[PRIMARY]);
        assert_eq!(p.size, (1920.0, 1040.0));
        assert_eq!(p.position, (0, 0));
    }

    #[test]
    fn a_tiny_saved_size_is_raised_to_the_minimum() {
        let p = fit(rect(100, 100, 100.0, 100.0), &[PRIMARY]);
        assert_eq!(p.size, MIN_SIZE);
    }

    #[test]
    fn the_work_area_wins_when_it_is_smaller_than_the_minimum() {
        let tiny = Area {
            x: 0,
            y: 0,
            width: 600,
            height: 400,
            scale: 1.0,
        };
        let p = fit(rect(0, 0, 1000.0, 700.0), &[tiny]);
        assert_eq!(p.size, (600.0, 400.0));
    }

    #[test]
    fn the_size_follows_the_scale_of_the_monitor_it_lands_on() {
        // 150% monitor: 1000 logical is 1500 physical, and comes back as 1000.
        let hidpi = Area {
            scale: 1.5,
            ..PRIMARY
        };
        let p = fit(rect(100, 100, 1000.0, 600.0), &[hidpi]);
        assert_eq!(p.size, (1000.0, 600.0));
        // The clamp is done in physical pixels: 1500 wide fits in 1920.
        assert_eq!(p.position, (100, 100));
    }

    #[test]
    fn the_primary_monitor_is_the_fallback_not_the_first_listed() {
        let p = fit_to_monitors(
            &rect(9000, 9000, 1000.0, 700.0),
            &[LEFT, PRIMARY],
            Some(PRIMARY),
        )
        .unwrap();
        assert_eq!(p.position, ((1920 - 1000) / 2, (1040 - 700) / 2));
    }

    #[test]
    fn no_monitors_means_nothing_to_place() {
        assert_eq!(fit_to_monitors(&rect(0, 0, 1000.0, 700.0), &[], None), None);
    }

    #[test]
    fn a_minimized_window_has_no_geometry_to_remember() {
        assert_eq!(snapshot((-32000, -32000), (0, 0), 1.0), None);
        assert_eq!(snapshot((100, 100), (0, 0), 1.0), None);
    }

    #[test]
    fn a_snapshot_stores_the_size_in_logical_pixels() {
        assert_eq!(
            snapshot((10, 20), (1500, 900), 1.5),
            Some(rect(10, 20, 1000.0, 600.0))
        );
    }

    fn seen(minimized: bool, maximized: bool, r: Option<MainWindowRect>) -> Observed {
        Observed {
            minimized,
            maximized,
            rect: r,
        }
    }

    #[test]
    fn a_minimized_window_changes_nothing() {
        let stored = (Some(rect(1, 2, 800.0, 600.0)), true);
        assert_eq!(next_state(stored, seen(true, false, None)), stored);
    }

    #[test]
    fn a_maximized_window_keeps_the_restored_rect_and_sets_the_flag() {
        let stored = (Some(rect(1, 2, 800.0, 600.0)), false);
        let maximized_rect = Some(rect(0, 0, 1920.0, 1040.0));
        assert_eq!(
            next_state(stored, seen(false, true, maximized_rect)),
            (Some(rect(1, 2, 800.0, 600.0)), true)
        );
    }

    #[test]
    fn maximizing_on_a_first_run_stores_only_the_flag() {
        assert_eq!(
            next_state((None, false), seen(false, true, None)),
            (None, true)
        );
    }

    #[test]
    fn a_normal_window_replaces_the_rect_and_clears_the_flag() {
        let now = Some(rect(50, 60, 900.0, 650.0));
        assert_eq!(
            next_state(
                (Some(rect(1, 2, 800.0, 600.0)), true),
                seen(false, false, now)
            ),
            (now, false)
        );
    }

    #[test]
    fn an_unreadable_window_keeps_what_was_stored() {
        let stored = (Some(rect(1, 2, 800.0, 600.0)), false);
        assert_eq!(next_state(stored, seen(false, false, None)), stored);
    }

    #[test]
    fn settings_default_has_no_saved_main_window() {
        let s = Settings::default();
        assert!(s.main_window_rect.is_none());
        assert!(!s.main_window_maximized);
    }

    #[test]
    fn settings_deserialize_missing_field_uses_default() {
        // Config files written before this existed have no such key; they
        // must still deserialize (config compatibility contract).
        let s: Settings = serde_json::from_str("{}").unwrap();
        assert!(s.main_window_rect.is_none());
        assert!(!s.main_window_maximized);
    }
}
