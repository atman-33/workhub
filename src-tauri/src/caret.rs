//! Where the text caret of the *focused* application is, in screen
//! coordinates. Used to anchor the voice-input indicator next to the spot
//! the transcript is about to be pasted into, instead of parking it in a
//! corner the user is not looking at (see `window_place::place_near_caret`).
//!
//! Two probes, tried in order, because neither covers everything:
//!
//! 1. `GetGUIThreadInfo` — cheap and in-process-free, but only classic Win32
//!    controls (Notepad, most native edit boxes) report a caret rect there.
//! 2. UI Automation — covers Chromium, Electron, VS Code and friends, which
//!    is where dictation usually lands, at the cost of cross-process COM
//!    calls. Slow enough that callers must keep it off any thread that must
//!    not block (see `probe_with_timeout`).
//!
//! Everything here is Windows-only; other platforms get a `None` stub.

use std::sync::mpsc;
use std::time::Duration;

/// A caret (or, when only the focused control could be located, that
/// control's) rectangle in **physical screen pixels**. A collapsed caret has
/// a zero or near-zero `width`; `height` is the text line height, which is
/// what callers anchor to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CaretRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// How long a caller is willing to wait for the caret probe. UI Automation
/// talks to the focused app's provider, so a wedged or busy target app can
/// stall the call for far longer than the indicator can wait.
const PROBE_TIMEOUT: Duration = Duration::from_millis(300);

/// Runs the caret probe on a throwaway thread and gives up after
/// [`PROBE_TIMEOUT`]. A timed-out probe is abandoned, not cancelled — COM
/// gives no way to interrupt an in-flight call — but it is bounded work that
/// finishes on its own, and this runs at most once per recording.
pub fn probe_with_timeout() -> Option<CaretRect> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(caret_rect());
    });
    rx.recv_timeout(PROBE_TIMEOUT).ok().flatten()
}

/// The focused application's caret rectangle, or `None` when no probe could
/// locate one. Blocking: call it from a thread that can afford to wait.
#[cfg(windows)]
pub fn caret_rect() -> Option<CaretRect> {
    win::gui_thread_caret().or_else(win::uia_caret)
}

#[cfg(not(windows))]
pub fn caret_rect() -> Option<CaretRect> {
    None
}

#[cfg(windows)]
mod win {
    use super::CaretRect;
    use windows::Win32::Foundation::{HWND, POINT, RECT};
    use windows::Win32::Graphics::Gdi::ClientToScreen;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_MULTITHREADED, SAFEARRAY,
    };
    use windows::Win32::System::Ole::{
        SafeArrayDestroy, SafeArrayGetElement, SafeArrayGetLBound, SafeArrayGetUBound,
    };
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationTextPattern, IUIAutomationTextRange,
        TextUnit_Character, UIA_TextPatternId,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetGUIThreadInfo, GetWindowThreadProcessId, GUITHREADINFO,
    };

    /// A caret rect must have some height to be worth anchoring to; a
    /// collapsed caret legitimately has zero width, but a zero-height rect
    /// means the provider reported nothing useful.
    fn from_rect(r: RECT) -> Option<CaretRect> {
        let width = r.right - r.left;
        let height = r.bottom - r.top;
        if height <= 0 || width < 0 {
            return None;
        }
        Some(CaretRect {
            x: r.left,
            y: r.top,
            width,
            height,
        })
    }

    /// Probe 1: the caret the foreground thread reports to the window
    /// manager. Present for classic Win32 controls, absent for most
    /// browser-engine apps.
    pub fn gui_thread_caret() -> Option<CaretRect> {
        unsafe {
            let foreground = GetForegroundWindow();
            if foreground.is_invalid() {
                return None;
            }
            let thread = GetWindowThreadProcessId(foreground, None);
            if thread == 0 {
                return None;
            }
            let mut info = GUITHREADINFO {
                cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
                ..Default::default()
            };
            GetGUIThreadInfo(thread, &mut info).ok()?;
            if info.hwndCaret.is_invalid() {
                return None;
            }
            // rcCaret is relative to hwndCaret's client area.
            let caret = to_screen(info.hwndCaret, info.rcCaret)?;
            from_rect(caret)
        }
    }

    /// Converts a client-relative rect to screen coordinates.
    unsafe fn to_screen(hwnd: HWND, rect: RECT) -> Option<RECT> {
        let mut top_left = POINT {
            x: rect.left,
            y: rect.top,
        };
        let mut bottom_right = POINT {
            x: rect.right,
            y: rect.bottom,
        };
        if !ClientToScreen(hwnd, &mut top_left).as_bool()
            || !ClientToScreen(hwnd, &mut bottom_right).as_bool()
        {
            return None;
        }
        Some(RECT {
            left: top_left.x,
            top: top_left.y,
            right: bottom_right.x,
            bottom: bottom_right.y,
        })
    }

    /// Probe 2: UI Automation. Asks the focused element for its text
    /// selection and takes the last rectangle of it — for a collapsed caret
    /// that is the caret itself, and for a real selection it is the end,
    /// which is where typing continues. Falls back to the focused element's
    /// own bounding rectangle when no text pattern is available.
    pub fn uia_caret() -> Option<CaretRect> {
        unsafe {
            // UI Automation clients must live in the MTA: an STA client has
            // to pump messages for callbacks, which a throwaway probe thread
            // does not do. `RPC_E_CHANGED_MODE` means someone already picked
            // an apartment for this thread — carry on, but leave the
            // uninitialize to whoever did.
            let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
            let owns_com = hr.is_ok();
            let result = uia_caret_inner();
            if owns_com {
                CoUninitialize();
            }
            result
        }
    }

    unsafe fn uia_caret_inner() -> Option<CaretRect> {
        let automation: IUIAutomation =
            CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok()?;
        let focused = automation.GetFocusedElement().ok()?;

        if let Ok(pattern) =
            focused.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)
        {
            if let Some(rect) = selection_rect(&pattern) {
                return Some(rect);
            }
        }
        // No text pattern (or an empty selection): the focused control's own
        // rectangle still beats a screen corner.
        from_rect(focused.CurrentBoundingRectangle().ok()?)
    }

    /// The last bounding rectangle of the focused element's text selection.
    unsafe fn selection_rect(pattern: &IUIAutomationTextPattern) -> Option<CaretRect> {
        let selection = pattern.GetSelection().ok()?;
        if selection.Length().unwrap_or(0) <= 0 {
            return None;
        }
        let range = selection.GetElement(0).ok()?;
        last_rect(&range).or_else(|| {
            // A collapsed (degenerate) range reports no rectangles at all in
            // several providers, Chromium among them. Widening it to the
            // character under the caret gives them something to measure.
            let expanded = range.Clone().ok()?;
            expanded.ExpandToEnclosingUnit(TextUnit_Character).ok()?;
            last_rect(&expanded)
        })
    }

    /// Reads a text range's bounding rectangles (a flat `[left, top, width,
    /// height, ...]` array of doubles) and returns the last one.
    unsafe fn last_rect(range: &IUIAutomationTextRange) -> Option<CaretRect> {
        let values = read_f64_array(range.GetBoundingRectangles().ok()?);
        let chunk = values.chunks_exact(4).next_back()?;
        let (left, top, width, height) = (chunk[0], chunk[1], chunk[2], chunk[3]);
        if height <= 0.0 || width < 0.0 {
            return None;
        }
        Some(CaretRect {
            x: left.round() as i32,
            y: top.round() as i32,
            width: width.round() as i32,
            height: height.round() as i32,
        })
    }

    /// Copies a one-dimensional `SAFEARRAY` of `f64` into a `Vec` and frees
    /// it (the array is ours once UI Automation hands it over).
    unsafe fn read_f64_array(array: *mut SAFEARRAY) -> Vec<f64> {
        let mut out = Vec::new();
        if array.is_null() {
            return out;
        }
        if let (Ok(lower), Ok(upper)) = (SafeArrayGetLBound(array, 1), SafeArrayGetUBound(array, 1))
        {
            for index in lower..=upper {
                let mut value = 0f64;
                if SafeArrayGetElement(
                    array,
                    &index,
                    &mut value as *mut f64 as *mut core::ffi::c_void,
                )
                .is_ok()
                {
                    out.push(value);
                }
            }
        }
        let _ = SafeArrayDestroy(array);
        out
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        /// Live smoke test for the COM/UI Automation plumbing: focus a text
        /// field, then run
        /// `cargo test --release -- --ignored --nocapture caret_probe`.
        /// Ignored by default because it reads whatever happens to be
        /// focused on the machine running it.
        #[test]
        #[ignore = "depends on the live desktop's focused window"]
        fn caret_probe_reports_something() {
            let gui = gui_thread_caret();
            let uia = uia_caret();
            println!("GetGUIThreadInfo: {gui:?}");
            println!("UI Automation:    {uia:?}");
            assert!(
                gui.is_some() || uia.is_some(),
                "neither probe located a caret or a focused element"
            );
        }

        #[test]
        fn a_zero_height_rect_is_rejected() {
            assert!(from_rect(RECT {
                left: 10,
                top: 10,
                right: 12,
                bottom: 10,
            })
            .is_none());
        }

        #[test]
        fn a_collapsed_caret_keeps_its_zero_width() {
            assert_eq!(
                from_rect(RECT {
                    left: 100,
                    top: 200,
                    right: 100,
                    bottom: 218,
                }),
                Some(CaretRect {
                    x: 100,
                    y: 200,
                    width: 0,
                    height: 18,
                })
            );
        }
    }
}
