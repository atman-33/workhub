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
//!
//! **Staying alive.** A registration that was accepted at startup can stop
//! delivering later: locking the session, an RDP disconnect/reconnect, a fast
//! user switch, resuming from sleep, or a display/device reconfiguration all
//! leave a process observing raw input with nothing arriving, and the API
//! reports no error at any point. The symptom is a global gesture that stops
//! working until the app is restarted. The listener therefore
//!
//! - re-registers on the system events that are known to break delivery
//!   (`WM_WTSSESSION_CHANGE`, `WM_DISPLAYCHANGE`, `WM_INPUT_DEVICE_CHANGE`,
//!   `WM_POWERBROADCAST`) — re-registering the same `hwndTarget` is cheap and
//!   idempotent, so a false positive costs nothing;
//! - runs a watchdog timer that re-registers (with a backoff) after a long
//!   stretch with no `WM_INPUT` at all;
//! - records health counters that `diagnostics` exposes to the UI, so a
//!   report of "the gesture stopped working" can be told apart from a gesture
//!   that is being recognized but not acted on.
//!
//! Note that no amount of re-registration defeats **UIPI**: while a window of
//! an elevated process is in the foreground, a normal-privilege process
//! receives no keyboard input at all. `diagnostics` flags that case separately
//! instead of pretending it is a listener fault.

#![cfg(windows)]

use crate::models::InputListenerDiagnostics;
use std::sync::{Arc, Mutex, OnceLock};
use tauri::AppHandle;
use windows::core::w;
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::RemoteDesktop::{
    WTSRegisterSessionNotification, WTSUnRegisterSessionNotification, NOTIFY_FOR_THIS_SESSION,
};
use windows::Win32::System::SystemInformation::GetTickCount64;
use windows::Win32::System::Threading::{
    GetCurrentThreadId, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Input::{
    GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER,
    RIDEV_DEVNOTIFY, RIDEV_INPUTSINK, RIDEV_REMOVE, RID_INPUT, RIM_TYPEKEYBOARD,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetForegroundWindow,
    GetMessageTime, GetMessageW, GetWindowThreadProcessId, KillTimer, PostMessageW,
    PostThreadMessageW, RegisterClassW, SetTimer, TranslateMessage, HWND_MESSAGE, MSG,
    WINDOW_EX_STYLE, WINDOW_STYLE, WM_APP, WM_DISPLAYCHANGE, WM_INPUT, WM_INPUT_DEVICE_CHANGE,
    WM_POWERBROADCAST, WM_QUIT, WM_TIMER, WNDCLASSW,
};

/// `RAWKEYBOARD.Flags` bit: this is a key release (break), not a press.
const RI_KEY_BREAK: u16 = 1;
/// HID usage page/id for keyboards.
const HID_USAGE_PAGE_GENERIC: u16 = 0x01;
const HID_USAGE_GENERIC_KEYBOARD: u16 = 0x06;

/// Session change (lock/unlock, RDP connect/disconnect, fast user switch).
/// Delivered only after `WTSRegisterSessionNotification`.
const WM_WTSSESSION_CHANGE: u32 = 0x02B1;
/// Asks the listener thread to re-register its raw-input device. Posted from
/// other threads (see `request_reregister`).
const WM_APP_REREGISTER: u32 = WM_APP + 1;

/// Watchdog timer id and period. The period only decides how often the idle
/// check runs; `IDLE_BEFORE_REREGISTER_MS` decides when it acts.
const WATCHDOG_TIMER_ID: usize = 1;
const WATCHDOG_PERIOD_MS: u32 = 30_000;
/// No `WM_INPUT` at all for this long is not proof of breakage — the user may
/// simply be away from the keyboard — but re-registering is harmless, so the
/// watchdog treats it as reason enough to try once.
const IDLE_BEFORE_REREGISTER_MS: u64 = 120_000;
/// Backoff between watchdog re-registrations, so an idle machine does not
/// re-register every two minutes all night.
const WATCHDOG_BACKOFF_BASE_MS: u64 = 60_000;
const WATCHDOG_BACKOFF_MAX_MS: u64 = 900_000;

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

/// Health counters for the single registration. Written from the listener
/// thread, read from whichever thread serves the diagnostics command.
struct Health {
    /// Tick count when the current listener registered its device.
    started_at: u64,
    /// Tick count of the last `WM_INPUT`, or 0 when none has arrived.
    last_input_at: u64,
    input_count: u64,
    reregistrations: u64,
    restarts: u64,
    last_reregister_at: u64,
    last_reregister_reason: Option<String>,
    last_error: Option<String>,
    /// Current watchdog backoff; reset whenever input flows again.
    watchdog_backoff_ms: u64,
}

/// Set once when the listener first starts; read from the window procedure.
static APP: OnceLock<AppHandle> = OnceLock::new();
static CONSUMERS: Mutex<Vec<Consumer>> = Mutex::new(Vec::new());
static LISTENER: Mutex<Option<Listener>> = Mutex::new(None);
static HEALTH: Mutex<Health> = Mutex::new(Health {
    started_at: 0,
    last_input_at: 0,
    input_count: 0,
    reregistrations: 0,
    restarts: 0,
    last_reregister_at: 0,
    last_reregister_reason: None,
    last_error: None,
    watchdog_backoff_ms: WATCHDOG_BACKOFF_BASE_MS,
});

struct Listener {
    thread_id: u32,
    /// The message-only window, as a raw handle so `Listener` stays `Send`.
    hwnd: isize,
    join: Option<std::thread::JoinHandle<()>>,
}

/// Register (or replace) the consumer stored under `key` and make sure the
/// listener thread is running. `key` is a stable feature name (`"ink"`,
/// `"clips"`), so re-registering after a settings toggle never stacks up
/// duplicate consumers.
///
/// When the listener is already running, this also asks it to re-register its
/// raw-input device: re-applying a feature's settings is the user's way of
/// saying "the gesture stopped working", and without this the registration
/// that actually broke would be left untouched whenever some *other* feature
/// kept the listener thread alive.
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
    let already_running = LISTENER.lock().unwrap().is_some();
    ensure_started()?;
    if already_running {
        request_reregister();
    }
    Ok(())
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

/// Tear the listener thread down and build it again, keeping the registered
/// consumers. This is the manual recovery behind the settings screen's
/// "restart the input listener" action: it rebuilds every piece that can go
/// stale (the thread, its message-only window, and the raw-input registration
/// itself) without disturbing which features are listening.
pub fn restart() -> Result<(), String> {
    stop();
    let result = ensure_started();
    let mut health = HEALTH.lock().unwrap();
    health.restarts += 1;
    health.watchdog_backoff_ms = WATCHDOG_BACKOFF_BASE_MS;
    if let Err(e) = &result {
        health.last_error = Some(e.clone());
    }
    result
}

/// Ask the listener thread to re-register its raw-input device. Safe to call
/// from any thread; a no-op when the listener is not running.
fn request_reregister() {
    let hwnd = LISTENER.lock().unwrap().as_ref().map(|l| l.hwnd);
    if let Some(hwnd) = hwnd {
        unsafe {
            let _ = PostMessageW(
                Some(HWND(hwnd as _)),
                WM_APP_REREGISTER,
                WPARAM(0),
                LPARAM(0),
            );
        }
    }
}

/// A snapshot of the listener's health for the diagnostics UI.
pub fn diagnostics() -> InputListenerDiagnostics {
    let now = unsafe { GetTickCount64() };
    let running = LISTENER.lock().unwrap().is_some();
    let consumers: Vec<String> = CONSUMERS
        .lock()
        .map(|c| c.iter().map(|c| c.key.to_string()).collect())
        .unwrap_or_default();
    let health = HEALTH.lock().unwrap();
    let since = |at: u64| (at != 0).then(|| now.saturating_sub(at));
    InputListenerDiagnostics {
        running,
        consumers,
        uptime_ms: since(health.started_at),
        last_input_ms_ago: since(health.last_input_at),
        input_count: health.input_count,
        reregistrations: health.reregistrations,
        restarts: health.restarts,
        last_reregister_ms_ago: since(health.last_reregister_at),
        last_reregister_reason: health.last_reregister_reason.clone(),
        last_error: health.last_error.clone(),
        elevated_foreground: foreground_is_elevated(),
    }
}

/// Best-effort UIPI check: whether the foreground window belongs to a process
/// we are not allowed to query. That is what an elevated (higher integrity)
/// app looks like from here, and while one is in front no keyboard input
/// reaches this process at all — no listener fix can change that, so the UI
/// says so rather than blaming the listener.
fn foreground_is_elevated() -> bool {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_invalid() {
            return false;
        }
        let mut pid: u32 = 0;
        if GetWindowThreadProcessId(hwnd, Some(&mut pid)) == 0 || pid == 0 {
            return false;
        }
        match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            Ok(handle) => {
                let _ = CloseHandle(handle);
                false
            }
            // Access denied on a limited query means a higher integrity level.
            Err(_) => true,
        }
    }
}

fn ensure_started() -> Result<(), String> {
    let mut guard = LISTENER.lock().unwrap();
    if guard.is_some() {
        return Ok(());
    }
    let (tx, rx) = std::sync::mpsc::channel::<Result<(u32, isize), String>>();
    let join = std::thread::Builder::new()
        .name("workhub-raw-input".into())
        .spawn(move || unsafe { listen(tx) })
        .map_err(|e| format!("failed to spawn raw-input thread: {e}"))?;
    let (thread_id, hwnd) = rx
        .recv()
        .map_err(|e| format!("raw-input thread died: {e}"))??;
    *guard = Some(Listener {
        thread_id,
        hwnd,
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
    let mut health = HEALTH.lock().unwrap();
    health.started_at = 0;
    health.last_input_at = 0;
}

/// (Re)register the keyboard usage against `hwnd`. Idempotent: re-registering
/// the same target simply replaces the identical entry.
unsafe fn register_device(hwnd: HWND) -> Result<(), String> {
    let device = RAWINPUTDEVICE {
        usUsagePage: HID_USAGE_PAGE_GENERIC,
        usUsage: HID_USAGE_GENERIC_KEYBOARD,
        // INPUTSINK: deliver input to this window's queue even while some
        // other window (including our own webview) has focus.
        // DEVNOTIFY: also deliver WM_INPUT_DEVICE_CHANGE, which is one of the
        // moments worth re-registering on.
        dwFlags: RIDEV_INPUTSINK | RIDEV_DEVNOTIFY,
        hwndTarget: hwnd,
    };
    RegisterRawInputDevices(&[device], std::mem::size_of::<RAWINPUTDEVICE>() as u32)
        .map_err(|e| format!("RegisterRawInputDevices failed: {e}"))
}

/// Re-register after something that is known to break delivery. `reason` is
/// recorded for the diagnostics UI; `watchdog` additionally widens the
/// backoff so an idle machine stops retrying every couple of minutes.
unsafe fn reregister(hwnd: HWND, reason: &str) {
    let result = register_device(hwnd);
    let now = GetTickCount64();
    let mut health = HEALTH.lock().unwrap();
    health.last_reregister_at = now;
    health.last_reregister_reason = Some(reason.to_string());
    match result {
        Ok(()) => {
            health.reregistrations += 1;
            health.last_error = None;
        }
        Err(e) => {
            eprintln!("rawkey: re-registration after {reason} failed: {e}");
            health.last_error = Some(e);
        }
    }
    if reason == WATCHDOG_REASON {
        health.watchdog_backoff_ms = next_backoff(health.watchdog_backoff_ms);
    }
}

/// The `reason` recorded for a watchdog-driven re-registration. Also the flag
/// that widens the backoff, so it is a constant rather than a bare string.
const WATCHDOG_REASON: &str = "watchdog";

/// The backoff after a watchdog re-registration that did not bring input back.
fn next_backoff(current_ms: u64) -> u64 {
    current_ms.saturating_mul(2).min(WATCHDOG_BACKOFF_MAX_MS)
}

/// Whether the watchdog should re-register now. Pure so the timing rules are
/// unit-testable without a live listener: nothing has been seen for a long
/// time *and* the backoff since the last attempt has elapsed. A
/// re-registration counts as activity itself, so the effective retry interval
/// is whichever of the two is longer.
fn watchdog_due(
    now_ms: u64,
    last_input_at: u64,
    last_reregister_at: u64,
    started_at: u64,
    backoff_ms: u64,
) -> bool {
    let last_activity = last_input_at.max(last_reregister_at).max(started_at);
    let idle = now_ms.saturating_sub(last_activity);
    let since_reregister = now_ms.saturating_sub(last_reregister_at);
    idle >= IDLE_BEFORE_REREGISTER_MS && since_reregister >= backoff_ms
}

/// Watchdog tick: re-register when nothing at all has arrived for a long time
/// and the backoff has elapsed.
unsafe fn watchdog_tick(hwnd: HWND) {
    let now = GetTickCount64();
    let due = {
        let health = HEALTH.lock().unwrap();
        watchdog_due(
            now,
            health.last_input_at,
            health.last_reregister_at,
            health.started_at,
            health.watchdog_backoff_ms,
        )
    };
    if due {
        reregister(hwnd, WATCHDOG_REASON);
    }
}

unsafe fn listen(tx: std::sync::mpsc::Sender<Result<(u32, isize), String>>) {
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

    if let Err(e) = register_device(hwnd) {
        HEALTH.lock().unwrap().last_error = Some(e.clone());
        let _ = tx.send(Err(e));
        let _ = DestroyWindow(hwnd);
        return;
    }

    // Session lock/unlock and RDP connect/disconnect are the classic moments
    // after which raw input silently stops arriving.
    let _ = WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION);
    SetTimer(Some(hwnd), WATCHDOG_TIMER_ID, WATCHDOG_PERIOD_MS, None);

    {
        let mut health = HEALTH.lock().unwrap();
        health.started_at = GetTickCount64();
        health.last_error = None;
        health.watchdog_backoff_ms = WATCHDOG_BACKOFF_BASE_MS;
    }
    let _ = tx.send(Ok((GetCurrentThreadId(), hwnd.0 as isize)));

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

    let _ = KillTimer(Some(hwnd), WATCHDOG_TIMER_ID);
    let _ = WTSUnRegisterSessionNotification(hwnd);
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
    match msg {
        WM_INPUT => {
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
                {
                    // Input is flowing: record it and forget the watchdog's
                    // widened backoff.
                    let mut health = HEALTH.lock().unwrap();
                    health.last_input_at = GetTickCount64();
                    health.input_count += 1;
                    health.watchdog_backoff_ms = WATCHDOG_BACKOFF_BASE_MS;
                }
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
            LRESULT(0)
        }
        // Everything below is a moment after which the registration may have
        // stopped delivering. Re-registering the same target is idempotent,
        // so acting on a false positive is harmless.
        WM_WTSSESSION_CHANGE => {
            reregister(hwnd, "session-change");
            LRESULT(0)
        }
        WM_DISPLAYCHANGE => {
            reregister(hwnd, "display-change");
            LRESULT(0)
        }
        WM_INPUT_DEVICE_CHANGE => {
            reregister(hwnd, "device-change");
            LRESULT(0)
        }
        WM_POWERBROADCAST => {
            reregister(hwnd, "power-broadcast");
            LRESULT(1)
        }
        WM_APP_REREGISTER => {
            reregister(hwnd, "requested");
            LRESULT(0)
        }
        WM_TIMER if wparam.0 == WATCHDOG_TIMER_ID => {
            watchdog_tick(hwnd);
            LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Ticks used by the tests, all relative to a listener that started at 0.
    const START: u64 = 0;

    #[test]
    fn recent_input_keeps_the_watchdog_quiet() {
        let now = 10 * 60_000;
        assert!(!watchdog_due(
            now,
            now - 1_000,
            0,
            START,
            WATCHDOG_BACKOFF_BASE_MS
        ));
    }

    #[test]
    fn a_long_silence_triggers_a_reregistration() {
        let now = 10 * 60_000;
        let last_input = now - IDLE_BEFORE_REREGISTER_MS;
        assert!(watchdog_due(
            now,
            last_input,
            0,
            START,
            WATCHDOG_BACKOFF_BASE_MS
        ));
    }

    #[test]
    fn a_fresh_listener_is_not_immediately_suspect() {
        // Just started, no input yet: the idle clock counts from the start,
        // so nothing happens until the silence is genuinely long.
        assert!(!watchdog_due(
            IDLE_BEFORE_REREGISTER_MS - 1,
            0,
            0,
            START,
            WATCHDOG_BACKOFF_BASE_MS
        ));
    }

    #[test]
    fn the_backoff_holds_off_a_second_attempt() {
        // Silent for hours, but the last attempt was inside the backoff.
        let now = 3 * 3_600_000;
        let last_reregister = now - (WATCHDOG_BACKOFF_BASE_MS - 1);
        assert!(!watchdog_due(
            now,
            0,
            last_reregister,
            START,
            WATCHDOG_BACKOFF_BASE_MS
        ));
        // Once both the backoff and a fresh silent stretch have elapsed, it
        // tries again: a re-registration counts as activity, so the effective
        // retry interval is whichever of the two is longer.
        let last_reregister = now - IDLE_BEFORE_REREGISTER_MS;
        assert!(watchdog_due(
            now,
            0,
            last_reregister,
            START,
            WATCHDOG_BACKOFF_BASE_MS
        ));
        // A widened backoff still holds it off at that same point.
        assert!(!watchdog_due(
            now,
            0,
            last_reregister,
            START,
            WATCHDOG_BACKOFF_MAX_MS
        ));
    }

    #[test]
    fn the_backoff_doubles_and_is_capped() {
        let mut backoff = WATCHDOG_BACKOFF_BASE_MS;
        for _ in 0..20 {
            backoff = next_backoff(backoff);
        }
        assert_eq!(backoff, WATCHDOG_BACKOFF_MAX_MS);
        assert_eq!(
            next_backoff(WATCHDOG_BACKOFF_BASE_MS),
            WATCHDOG_BACKOFF_BASE_MS * 2
        );
    }
}
