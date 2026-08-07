//! Paste injection into whatever app currently has OS keyboard focus:
//! put the text on the clipboard, synthesize Ctrl+V, then restore whatever
//! was on the clipboard before.
//!
//! Win32 clipboard APIs, not the webview clipboard plugin: the app does not
//! have focus when this runs, so the paste target is some other process.
//! Shared by voice input (`voice.rs`, which pastes a transcript) and the
//! clips popup (`clips/`, which pastes a stored snippet).

#[cfg(windows)]
use std::time::Duration;

/// Copies `text` to the clipboard, sends Ctrl+V to whichever window currently
/// has focus, then restores the previous clipboard contents.
#[cfg(windows)]
pub fn paste_text(text: &str) -> Result<(), String> {
    let previous = clipboard::read_text();
    clipboard::write_text(text)?;
    std::thread::sleep(Duration::from_millis(50));
    clipboard::send_ctrl_v();
    std::thread::sleep(Duration::from_millis(150));
    if let Some(prev) = previous {
        let _ = clipboard::write_text(&prev);
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn paste_text(_text: &str) -> Result<(), String> {
    Err("paste injection is only implemented on Windows".into())
}

/// Puts `text` on the clipboard without pasting — the fallback when focus
/// could not be handed back to the paste target, so the user can still paste
/// it manually.
#[cfg(windows)]
pub fn copy_text(text: &str) -> Result<(), String> {
    clipboard::write_text(text)
}

#[cfg(not(windows))]
pub fn copy_text(_text: &str) -> Result<(), String> {
    Err("clipboard access is only implemented on Windows".into())
}

/// Handle of the window that currently has OS foreground focus, as a raw
/// pointer value so callers can hold it without a Windows type dependency.
/// `None` when there is no foreground window.
#[cfg(windows)]
pub fn foreground_window() -> Option<isize> {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    let hwnd = unsafe { GetForegroundWindow() };
    (!hwnd.is_invalid()).then_some(hwnd.0 as isize)
}

#[cfg(not(windows))]
pub fn foreground_window() -> Option<isize> {
    None
}

/// Hands focus back to a window previously captured with
/// [`foreground_window`]. `SetForegroundWindow` alone is refused by Windows
/// unless the calling process is the foreground one (or was very recently),
/// so on failure this attaches to the target's input queue and retries —
/// the standard workaround. Returns whether the window ended up in the
/// foreground.
#[cfg(windows)]
pub fn restore_foreground(hwnd: isize) -> bool {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows::Win32::UI::Input::KeyboardAndMouse::SetFocus;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId, IsIconic, IsWindow, SetForegroundWindow,
        ShowWindow, SW_SHOW,
    };

    let target = HWND(hwnd as *mut _);
    unsafe {
        if !IsWindow(Some(target)).as_bool() {
            return false;
        }
        if IsIconic(target).as_bool() {
            let _ = ShowWindow(target, SW_SHOW);
        }
        if SetForegroundWindow(target).as_bool() && GetForegroundWindow() == target {
            return true;
        }
        // Attach our input queue to the target's thread, which lifts the
        // foreground-change restriction for the duration of the attachment.
        let target_thread = GetWindowThreadProcessId(target, None);
        let this_thread = GetCurrentThreadId();
        if target_thread == 0 || target_thread == this_thread {
            return GetForegroundWindow() == target;
        }
        let attached = AttachThreadInput(this_thread, target_thread, true).as_bool();
        let _ = SetForegroundWindow(target);
        let _ = SetFocus(Some(target));
        if attached {
            let _ = AttachThreadInput(this_thread, target_thread, false);
        }
        GetForegroundWindow() == target
    }
}

#[cfg(not(windows))]
pub fn restore_foreground(_hwnd: isize) -> bool {
    false
}

#[cfg(windows)]
mod clipboard {
    use windows::Win32::Foundation::{HANDLE, HGLOBAL};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, GetClipboardData, IsClipboardFormatAvailable,
        OpenClipboard, SetClipboardData,
    };
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    use windows::Win32::System::Ole::CF_UNICODETEXT;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_CONTROL, VK_V,
    };

    /// Current clipboard text, if any (used to save/restore around a paste).
    pub fn read_text() -> Option<String> {
        unsafe {
            OpenClipboard(None).ok()?;
            let text = (|| -> Option<String> {
                IsClipboardFormatAvailable(CF_UNICODETEXT.0 as u32).ok()?;
                let handle = GetClipboardData(CF_UNICODETEXT.0 as u32).ok()?;
                let hglobal = HGLOBAL(handle.0);
                let ptr = GlobalLock(hglobal);
                if ptr.is_null() {
                    return None;
                }
                let wide = std::slice::from_raw_parts(ptr as *const u16, wcslen(ptr as *const u16));
                let s = String::from_utf16_lossy(wide);
                let _ = GlobalUnlock(hglobal);
                Some(s)
            })();
            let _ = CloseClipboard();
            text
        }
    }

    unsafe fn wcslen(ptr: *const u16) -> usize {
        let mut len = 0usize;
        while *ptr.add(len) != 0 {
            len += 1;
        }
        len
    }

    pub fn write_text(text: &str) -> Result<(), String> {
        unsafe {
            OpenClipboard(None).map_err(|e| e.to_string())?;
            let result = (|| -> Result<(), String> {
                EmptyClipboard().map_err(|e| e.to_string())?;
                let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
                let bytes = wide.len() * std::mem::size_of::<u16>();
                let hmem = GlobalAlloc(GMEM_MOVEABLE, bytes).map_err(|e| e.to_string())?;
                if hmem.is_invalid() {
                    return Err("GlobalAlloc failed".into());
                }
                let ptr = GlobalLock(hmem);
                if ptr.is_null() {
                    return Err("GlobalLock failed".into());
                }
                std::ptr::copy_nonoverlapping(wide.as_ptr(), ptr.cast::<u16>(), wide.len());
                let _ = GlobalUnlock(hmem);
                SetClipboardData(CF_UNICODETEXT.0 as u32, Some(HANDLE(hmem.0)))
                    .map_err(|e| e.to_string())?;
                Ok(())
            })();
            let _ = CloseClipboard();
            result
        }
    }

    fn key_input(vk: windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY, up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    dwFlags: if up {
                        KEYEVENTF_KEYUP
                    } else {
                        Default::default()
                    },
                    ..Default::default()
                },
            },
        }
    }

    /// Synthesizes Ctrl+V via `SendInput` — goes to whichever window
    /// currently has OS keyboard focus.
    pub fn send_ctrl_v() {
        let inputs = [
            key_input(VK_CONTROL, false),
            key_input(VK_V, false),
            key_input(VK_V, true),
            key_input(VK_CONTROL, true),
        ];
        unsafe {
            SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        }
    }
}
