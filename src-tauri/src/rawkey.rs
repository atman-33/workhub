//! Shared global keyboard listener, built on the Raw Input API
//! (`RegisterRawInputDevices` + `RIDEV_INPUTSINK`) instead of a
//! `WH_KEYBOARD_LL` hook: low-level hook delivery silently starves when this
//! process's own WebView2 child window holds keyboard focus, whereas raw
//! input arrives on our dedicated thread's message queue regardless of focus
//! and never participates in (or blocks) the system hook chain. Raw input is
//! observe-only — keys are never consumed.
//!
//! **Why this is shared rather than one listener per feature:** raw-input
//! device registration is per *process* and per usage page/usage. A second
//! `RegisterRawInputDevices` call for the keyboard usage replaces the first
//! one's `hwndTarget`, so a feature that registers its own listener silently
//! steals every key from the feature that registered earlier. Both the ink
//! overlay (`ink/`) and the clips popup (`clips/`) therefore register a
//! *consumer* here, and this module owns the single registration.
//!
//! Consumers are called on the listener thread with the raw virtual-key code,
//! whether it was a press or a release, and the time the input was posted
//! (`RAWKEYBOARD` carries no timestamp of its own — see `message_time_ms`).
//! Anything touching windows must hop to the
//! main thread itself — see `AppHandle::run_on_main_thread`.

#![cfg(windows)]

use std::sync::{Arc, Mutex, OnceLock};
use tauri::AppHandle;
use windows::core::w;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::SystemInformation::GetTickCount64;
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::Input::{
    GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER,
    RIDEV_INPUTSINK, RIDEV_REMOVE, RID_INPUT, RIM_TYPEKEYBOARD,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageTime, GetMessageW,
    PostThreadMessageW, RegisterClassW, TranslateMessage, HWND_MESSAGE, MSG, WINDOW_EX_STYLE,
    WINDOW_STYLE, WM_INPUT, WM_QUIT, WNDCLASSW,
};

/// `RAWKEYBOARD.Flags` bit: this is a key release (break), not a press.
const RI_KEY_BREAK: u16 = 1;
/// HID usage page/id for keyboards.
const HID_USAGE_PAGE_GENERIC: u16 = 0x01;
const HID_USAGE_GENERIC_KEYBOARD: u16 = 0x06;

/// One observed key transition.
#[derive(Debug, Clone, Copy)]
pub struct KeyEvent {
    /// Virtual-key code. Raw input reports the *generic* modifier codes
    /// (`VK_MENU`, `VK_CONTROL`, `VK_SHIFT`), not the left/right variants.
    pub vk: u16,
    /// True for a key release.
    pub up: bool,
    /// When the key transition was *posted*, on the `GetTickCount64()` scale —
    /// not when we got around to handling it. Gesture recognizers compare
    /// these, so a stalled message queue must not stretch the gaps.
    pub time_ms: u64,
}

type Callback = Arc<dyn Fn(&AppHandle, KeyEvent) + Send + Sync>;

struct Consumer {
    key: &'static str,
    callback: Callback,
}

/// Set once when the listener first starts; read from the window procedure.
static APP: OnceLock<AppHandle> = OnceLock::new();
static CONSUMERS: Mutex<Vec<Consumer>> = Mutex::new(Vec::new());
static LISTENER: Mutex<Option<Listener>> = Mutex::new(None);

struct Listener {
    thread_id: u32,
    join: Option<std::thread::JoinHandle<()>>,
}

/// Register (or replace) the consumer stored under `key` and make sure the
/// listener thread is running. `key` is a stable feature name (`"ink"`,
/// `"clips"`), so re-registering after a settings toggle never stacks up
/// duplicate consumers.
pub fn register<F>(app: &AppHandle, key: &'static str, callback: F) -> Result<(), String>
where
    F: Fn(&AppHandle, KeyEvent) + Send + Sync + 'static,
{
    let _ = APP.set(app.clone());
    {
        let mut consumers = CONSUMERS.lock().unwrap();
        consumers.retain(|c| c.key != key);
        consumers.push(Consumer {
            key,
            callback: Arc::new(callback),
        });
    }
    ensure_started()
}

/// Drop the consumer stored under `key`; stops the listener thread once the
/// last consumer is gone.
pub fn unregister(key: &'static str) {
    let empty = {
        let mut consumers = CONSUMERS.lock().unwrap();
        consumers.retain(|c| c.key != key);
        consumers.is_empty()
    };
    if empty {
        stop();
    }
}

fn ensure_started() -> Result<(), String> {
    let mut guard = LISTENER.lock().unwrap();
    if guard.is_some() {
        return Ok(());
    }
    let (tx, rx) = std::sync::mpsc::channel::<Result<u32, String>>();
    let join = std::thread::Builder::new()
        .name("workhub-raw-input".into())
        .spawn(move || unsafe { listen(tx) })
        .map_err(|e| format!("failed to spawn raw-input thread: {e}"))?;
    let thread_id = rx
        .recv()
        .map_err(|e| format!("raw-input thread died: {e}"))??;
    *guard = Some(Listener {
        thread_id,
        join: Some(join),
    });
    Ok(())
}

fn stop() {
    let listener = LISTENER.lock().unwrap().take();
    if let Some(mut listener) = listener {
        unsafe {
            let _ = PostThreadMessageW(listener.thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
        }
        if let Some(join) = listener.join.take() {
            let _ = join.join();
        }
    }
}

unsafe fn listen(tx: std::sync::mpsc::Sender<Result<u32, String>>) {
    let hinstance = GetModuleHandleW(None).unwrap_or_default();
    let class_name = w!("workhub-raw-input");
    let wc = WNDCLASSW {
        lpfnWndProc: Some(wndproc),
        hInstance: hinstance.into(),
        lpszClassName: class_name,
        ..Default::default()
    };
    // May fail with "class already exists" when the listener is restarted
    // (settings toggle) — that is fine, the class persists for the process
    // lifetime.
    let _ = RegisterClassW(&wc);

    let hwnd = match CreateWindowExW(
        WINDOW_EX_STYLE(0),
        class_name,
        w!(""),
        WINDOW_STYLE(0),
        0,
        0,
        0,
        0,
        Some(HWND_MESSAGE),
        None,
        Some(hinstance.into()),
        None,
    ) {
        Ok(hwnd) => hwnd,
        Err(e) => {
            let _ = tx.send(Err(format!("CreateWindowExW failed: {e}")));
            return;
        }
    };

    let device = RAWINPUTDEVICE {
        usUsagePage: HID_USAGE_PAGE_GENERIC,
        usUsage: HID_USAGE_GENERIC_KEYBOARD,
        // INPUTSINK: deliver input to this window's queue even while some
        // other window (including our own webview) has focus.
        dwFlags: RIDEV_INPUTSINK,
        hwndTarget: hwnd,
    };
    if let Err(e) = RegisterRawInputDevices(&[device], std::mem::size_of::<RAWINPUTDEVICE>() as u32)
    {
        let _ = tx.send(Err(format!("RegisterRawInputDevices failed: {e}")));
        let _ = DestroyWindow(hwnd);
        return;
    }

    let _ = tx.send(Ok(GetCurrentThreadId()));

    // Pump until WM_QUIT (posted by stop()).
    let mut msg = MSG::default();
    loop {
        let ret = GetMessageW(&mut msg, None, 0, 0);
        if ret.0 == 0 || ret.0 == -1 {
            break;
        }
        let _ = TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    let remove = RAWINPUTDEVICE {
        usUsagePage: HID_USAGE_PAGE_GENERIC,
        usUsage: HID_USAGE_GENERIC_KEYBOARD,
        dwFlags: RIDEV_REMOVE,
        hwndTarget: HWND::default(),
    };
    let _ = RegisterRawInputDevices(&[remove], std::mem::size_of::<RAWINPUTDEVICE>() as u32);
    let _ = DestroyWindow(hwnd);
}

/// Post time of the message being dispatched, on the 64-bit tick scale.
///
/// `GetMessageTime()` is the accurate one — it is the tick count when the
/// input was posted, so a queue that stalls (a busy main thread, a heavy
/// foreground app) cannot stretch the gap between two key transitions. It is
/// only 32 bits though, so rebase it onto `GetTickCount64()` to keep the
/// timestamps monotonic across the 49-day wrap that the recognizers would
/// otherwise see as an enormous gap.
unsafe fn message_time_ms() -> u64 {
    let now = GetTickCount64();
    let lag = (now as u32).wrapping_sub(GetMessageTime() as u32) as u64;
    // A nonsensical lag means the message did not come from the input queue;
    // fall back to "now".
    if lag > 60_000 {
        now
    } else {
        now - lag
    }
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if msg == WM_INPUT {
        let mut raw = RAWINPUT::default();
        let mut size = std::mem::size_of::<RAWINPUT>() as u32;
        let copied = GetRawInputData(
            HRAWINPUT(lparam.0 as _),
            RID_INPUT,
            Some(&mut raw as *mut _ as *mut _),
            &mut size,
            std::mem::size_of::<RAWINPUTHEADER>() as u32,
        );
        if copied != u32::MAX && raw.header.dwType == RIM_TYPEKEYBOARD.0 {
            let kb = raw.data.keyboard;
            let event = KeyEvent {
                vk: kb.VKey,
                up: kb.Flags & RI_KEY_BREAK != 0,
                time_ms: message_time_ms(),
            };
            // Snapshot the callbacks and drop the lock before calling them:
            // a consumer is free to (un)register from inside its own handler.
            let callbacks: Vec<Callback> = CONSUMERS
                .lock()
                .map(|c| c.iter().map(|c| c.callback.clone()).collect())
                .unwrap_or_default();
            if let Some(app) = APP.get() {
                for callback in callbacks {
                    callback(app, event);
                }
            }
        }
        return LRESULT(0);
    }
    DefWindowProcW(hwnd, msg, wparam, lparam)
}
