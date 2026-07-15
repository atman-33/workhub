//! Global Alt/S key listener for the ink overlay, built on the Raw Input API
//! (`RegisterRawInputDevices` + `RIDEV_INPUTSINK`) instead of a
//! `WH_KEYBOARD_LL` hook: low-level hook delivery silently starves when this
//! process's own WebView2 child window holds keyboard focus, whereas raw
//! input arrives on our dedicated thread's message queue regardless of focus
//! and never participates in (or blocks) the system hook chain. Resulting
//! [`InkEvent`]s are forwarded to the main thread, where the overlay window
//! is driven. Raw input is observe-only — keys are never consumed.

use super::state::{AltStateMachine, InkEvent, KeyInput};
use std::sync::{Mutex, OnceLock};
use tauri::AppHandle;
use windows::core::w;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::SystemInformation::GetTickCount64;
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetDoubleClickTime, VK_MENU, VK_S};
use windows::Win32::UI::Input::{
    GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER,
    RIDEV_INPUTSINK, RIDEV_REMOVE, RID_INPUT, RIM_TYPEKEYBOARD,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW,
    PostThreadMessageW, RegisterClassW, TranslateMessage, HWND_MESSAGE, MSG, WINDOW_EX_STYLE,
    WINDOW_STYLE, WM_INPUT, WM_QUIT, WNDCLASSW,
};

/// `RAWKEYBOARD.Flags` bit: this is a key release (break), not a press.
const RI_KEY_BREAK: u16 = 1;
/// HID usage page/id for keyboards.
const HID_USAGE_PAGE_GENERIC: u16 = 0x01;
const HID_USAGE_GENERIC_KEYBOARD: u16 = 0x06;

/// Set once when the listener first starts; read from the window procedure.
static APP: OnceLock<AppHandle> = OnceLock::new();
/// State machine lives behind a mutex because the wndproc is a plain fn.
static MACHINE: Mutex<Option<AltStateMachine>> = Mutex::new(None);

/// Handle to the running raw-input thread; dropping it without
/// [`InkHook::stop`] leaves the thread running until app exit.
pub struct InkHook {
    thread_id: u32,
    join: Option<std::thread::JoinHandle<()>>,
}

impl InkHook {
    pub fn stop(mut self) {
        unsafe {
            let _ = PostThreadMessageW(self.thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
        }
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

pub fn start(app: &AppHandle) -> Result<InkHook, String> {
    let _ = APP.set(app.clone());
    let (tx, rx) = std::sync::mpsc::channel::<Result<u32, String>>();
    let join = std::thread::Builder::new()
        .name("ink-raw-input".into())
        .spawn(move || unsafe {
            let threshold = GetDoubleClickTime() as u64;
            *MACHINE.lock().unwrap() = Some(AltStateMachine::new(threshold));

            let hinstance = GetModuleHandleW(None).unwrap_or_default();
            let class_name = w!("workhub-ink-raw-input");
            let wc = WNDCLASSW {
                lpfnWndProc: Some(wndproc),
                hInstance: hinstance.into(),
                lpszClassName: class_name,
                ..Default::default()
            };
            // May fail with "class already exists" when the listener is
            // restarted (settings toggle) — that is fine, the class persists
            // for the process lifetime.
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
                // INPUTSINK: deliver input to this window's queue even while
                // some other window (including our own webview) has focus.
                dwFlags: RIDEV_INPUTSINK,
                hwndTarget: hwnd,
            };
            if let Err(e) =
                RegisterRawInputDevices(&[device], std::mem::size_of::<RAWINPUTDEVICE>() as u32)
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
            let _ =
                RegisterRawInputDevices(&[remove], std::mem::size_of::<RAWINPUTDEVICE>() as u32);
            let _ = DestroyWindow(hwnd);
            *MACHINE.lock().unwrap() = None;
        })
        .map_err(|e| format!("failed to spawn raw-input thread: {e}"))?;
    let thread_id = rx
        .recv()
        .map_err(|e| format!("raw-input thread died: {e}"))??;
    Ok(InkHook {
        thread_id,
        join: Some(join),
    })
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
            let is_up = kb.Flags & RI_KEY_BREAK != 0;
            // Raw input reports both Alt keys as the generic VK_MENU; the
            // gesture does not distinguish left from right.
            let key = if kb.VKey == VK_MENU.0 {
                Some(if is_up {
                    KeyInput::AltUp
                } else {
                    KeyInput::AltDown
                })
            } else if kb.VKey == VK_S.0 {
                Some(if is_up {
                    KeyInput::SUp
                } else {
                    KeyInput::SDown
                })
            } else {
                None
            };
            if let Some(key) = key {
                let event: Option<InkEvent> = MACHINE
                    .lock()
                    .ok()
                    .and_then(|mut m| m.as_mut().and_then(|m| m.on_key(key, GetTickCount64())));
                if let Some(event) = event {
                    if let Some(app) = APP.get() {
                        let handle = app.clone();
                        let _ = app.run_on_main_thread(move || super::dispatch(&handle, event));
                    }
                }
            }
        }
        return LRESULT(0);
    }
    DefWindowProcW(hwnd, msg, wparam, lparam)
}
