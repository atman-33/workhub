//! Low-level keyboard hook (WH_KEYBOARD_LL) that feeds Alt/S transitions into
//! the [`AltStateMachine`]. The hook runs on a dedicated thread with its own
//! Win32 message loop; resulting [`InkEvent`]s are forwarded to the main
//! thread, where the overlay window is driven. The hook never swallows keys —
//! it always calls `CallNextHookEx`.

use super::state::{AltStateMachine, InkEvent, KeyInput};
use std::sync::{Mutex, OnceLock};
use tauri::AppHandle;
use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetDoubleClickTime, VK_LMENU, VK_RMENU, VK_S};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetMessageW, PostThreadMessageW, SetWindowsHookExW,
    TranslateMessage, UnhookWindowsHookEx, KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL, WM_KEYDOWN,
    WM_KEYUP, WM_QUIT, WM_SYSKEYDOWN, WM_SYSKEYUP,
};

/// Set once when the hook first starts; read from the hook procedure.
static APP: OnceLock<AppHandle> = OnceLock::new();
/// State machine lives behind a mutex because the hook proc is a plain fn.
static MACHINE: Mutex<Option<AltStateMachine>> = Mutex::new(None);

/// Handle to the running hook thread; dropping it without [`InkHook::stop`]
/// leaves the thread running until app exit (harmless but avoid it).
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
        .name("ink-keyboard-hook".into())
        .spawn(move || unsafe {
            let threshold = GetDoubleClickTime() as u64;
            *MACHINE.lock().unwrap() = Some(AltStateMachine::new(threshold));
            let hook = match SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), None, 0) {
                Ok(hook) => hook,
                Err(e) => {
                    let _ = tx.send(Err(format!("SetWindowsHookExW failed: {e}")));
                    return;
                }
            };
            let _ = tx.send(Ok(GetCurrentThreadId()));
            // Message loop keeps the LL hook alive; WM_QUIT (from stop()) ends it.
            let mut msg = MSG::default();
            loop {
                let ret = GetMessageW(&mut msg, None, 0, 0);
                if ret.0 == 0 || ret.0 == -1 {
                    break;
                }
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            let _ = UnhookWindowsHookEx(hook);
            *MACHINE.lock().unwrap() = None;
        })
        .map_err(|e| format!("failed to spawn hook thread: {e}"))?;
    let thread_id = rx.recv().map_err(|e| format!("hook thread died: {e}"))??;
    Ok(InkHook {
        thread_id,
        join: Some(join),
    })
}

unsafe extern "system" fn hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let kbd = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
        let msg = wparam.0 as u32;
        let is_down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
        let is_up = msg == WM_KEYUP || msg == WM_SYSKEYUP;
        let key = if kbd.vkCode == VK_LMENU.0 as u32 || kbd.vkCode == VK_RMENU.0 as u32 {
            if is_down {
                Some(KeyInput::AltDown)
            } else if is_up {
                Some(KeyInput::AltUp)
            } else {
                None
            }
        } else if kbd.vkCode == VK_S.0 as u32 {
            if is_down {
                Some(KeyInput::SDown)
            } else if is_up {
                Some(KeyInput::SUp)
            } else {
                None
            }
        } else {
            None
        };
        if let Some(key) = key {
            let event: Option<InkEvent> = MACHINE
                .lock()
                .ok()
                .and_then(|mut m| m.as_mut().and_then(|m| m.on_key(key, kbd.time as u64)));
            if let Some(event) = event {
                // Keep the hook proc fast: hand the window work to the main
                // thread. A slow LL hook gets silently removed by Windows.
                if let Some(app) = APP.get() {
                    let handle = app.clone();
                    let _ = app.run_on_main_thread(move || super::dispatch(&handle, event));
                }
            }
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}
