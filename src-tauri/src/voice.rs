//! Global voice-input dictation: a global hotkey toggles microphone
//! recording, the audio is transcribed locally via `stt.rs`, and the result
//! is pasted into whichever app currently has focus (clipboard + simulated
//! Ctrl+V, with the original clipboard restored afterwards).
//!
//! Follows the `quick_capture.rs` conventions: the indicator window is built
//! hidden at startup and only ever shown/hidden from here (never built
//! inside the hotkey handler, which on Windows runs synchronously inside
//! WndProc); the hotkey is (re)registered through `apply_shortcut`, tried
//! against a configured value then fallbacks, exactly like quick capture.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::storage;

pub const WINDOW_LABEL: &str = "voice-indicator";
const WINDOW_SIZE: (f64, f64) = (220.0, 48.0);
/// Tried after the configured hotkey when registration fails.
const FALLBACK_SHORTCUTS: &[&str] = &["Ctrl+Alt+Space"];
/// Recording auto-stops after this long even without a second hotkey press.
const MAX_RECORDING_SECS: u64 = 120;

#[derive(Clone, Debug, Default, PartialEq)]
pub enum Phase {
    #[default]
    Idle,
    Recording,
    Transcribing,
    Error(String),
}

struct RecordingHandle {
    stop_tx: mpsc::Sender<()>,
}

#[derive(Default)]
pub struct VoiceState {
    phase: Mutex<Phase>,
    shortcut: Mutex<Option<Shortcut>>,
    recording: Mutex<Option<RecordingHandle>>,
}

/// Ordered registration candidates: the preferred key first, then fallbacks,
/// deduplicated. Mirrors `quick_capture::candidates`.
fn candidates<'a>(preferred: &'a str, fallbacks: &[&'a str]) -> Vec<&'a str> {
    let mut list = vec![preferred];
    for f in fallbacks {
        if !list.contains(f) {
            list.push(f);
        }
    }
    list
}

/// Create the (hidden) indicator window. Idempotent.
pub fn create_window(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window(WINDOW_LABEL).is_some() {
        return Ok(());
    }
    WebviewWindowBuilder::new(
        app,
        WINDOW_LABEL,
        WebviewUrl::App("voice-indicator.html".into()),
    )
    .title("workhub voice indicator")
    .inner_size(WINDOW_SIZE.0, WINDOW_SIZE.1)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    // Non-focusable: the indicator must never steal focus from the app
    // the transcript is about to be pasted into.
    .focusable(false)
    .focused(false)
    .visible(false)
    .shadow(false)
    .transparent(true)
    .background_color(tauri::window::Color(0, 0, 0, 0))
    .build()?;
    Ok(())
}

fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(WINDOW_LABEL)
}

fn position_bottom_center(app: &AppHandle, win: &WebviewWindow) {
    let Some(monitor) = app.primary_monitor().ok().flatten() else {
        return;
    };
    let Ok(size) = win.outer_size() else { return };
    let x = monitor.position().x + (monitor.size().width as i32 - size.width as i32) / 2;
    let y = monitor.position().y + monitor.size().height as i32 - size.height as i32 - 96;
    let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
}

fn show_indicator(app: &AppHandle) {
    let Some(win) = window(app) else { return };
    position_bottom_center(app, &win);
    let _ = win.show();
}

fn hide_indicator(app: &AppHandle) {
    let Some(win) = window(app) else { return };
    let _ = win.hide();
}

#[derive(Serialize, Clone)]
struct StatePayload {
    state: &'static str,
    message: Option<String>,
}

fn emit_phase(app: &AppHandle, phase: &Phase) {
    let (state, message) = match phase {
        Phase::Idle => ("idle", None),
        Phase::Recording => ("recording", None),
        Phase::Transcribing => ("transcribing", None),
        Phase::Error(msg) => ("error", Some(msg.clone())),
    };
    let _ = app.emit("voice:state", StatePayload { state, message });
}

fn set_phase(app: &AppHandle, phase: Phase) {
    let state = app.state::<VoiceState>();
    *state.phase.lock().unwrap() = phase.clone();
    emit_phase(app, &phase);
    match phase {
        Phase::Idle => hide_indicator(app),
        Phase::Recording | Phase::Transcribing => show_indicator(app),
        Phase::Error(_) => {
            show_indicator(app);
            schedule_error_clear(app);
        }
    }
}

/// Auto-hides the indicator ~4s after an error, unless a newer state (a
/// fresh recording, or another error) has already superseded it.
fn schedule_error_clear(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(4));
        let state = app.state::<VoiceState>();
        let mut guard = state.phase.lock().unwrap();
        if matches!(*guard, Phase::Error(_)) {
            *guard = Phase::Idle;
            drop(guard);
            emit_phase(&app, &Phase::Idle);
            hide_indicator(&app);
        }
    });
}

fn emit_error(app: &AppHandle, message: impl Into<String>) {
    let state = app.state::<VoiceState>();
    *state.recording.lock().unwrap() = None;
    set_phase(app, Phase::Error(message.into()));
}

/// Toggle entry point for the global hotkey: first press starts recording,
/// second press stops it and transcribes. Called from the
/// `tauri_plugin_global_shortcut` handler, which on Windows runs inside
/// WndProc — everything here must be non-blocking; actual microphone and
/// model I/O happens on a dedicated background thread.
pub fn toggle(app: &AppHandle) {
    let phase = app.state::<VoiceState>().phase.lock().unwrap().clone();
    match phase {
        Phase::Idle | Phase::Error(_) => start_recording(app),
        Phase::Recording => stop_recording(app),
        Phase::Transcribing => {} // busy — ignore extra presses
    }
}

fn start_recording(app: &AppHandle) {
    let settings = storage::load().settings;
    if !settings.voice_enabled {
        emit_error(
            app,
            "Voice input is disabled — enable it in Settings > Voice.",
        );
        return;
    }
    if !crate::stt::models_dir()
        .join(format!("ggml-{}.bin", settings.voice_model))
        .is_file()
    {
        emit_error(
            app,
            format!(
                "Model '{}' is not downloaded — open Settings > Voice to download it.",
                settings.voice_model
            ),
        );
        return;
    }

    let state = app.state::<VoiceState>();
    {
        let mut recording = state.recording.lock().unwrap();
        if recording.is_some() {
            return;
        }
        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        *recording = Some(RecordingHandle { stop_tx });
        drop(recording);

        let app_handle = app.clone();
        std::thread::Builder::new()
            .name("voice-record".into())
            .spawn(move || record_and_finish(app_handle, stop_rx))
            .ok();
    }
    set_phase(app, Phase::Recording);
}

fn stop_recording(app: &AppHandle) {
    let state = app.state::<VoiceState>();
    let handle = state.recording.lock().unwrap().take();
    if let Some(handle) = handle {
        let _ = handle.stop_tx.send(());
    }
    set_phase(app, Phase::Transcribing);
}

/// Runs entirely on the dedicated `voice-record` thread: opens the default
/// input device, records until told to stop (or `MAX_RECORDING_SECS`
/// elapses), then hands the buffer off to transcription + paste.
fn record_and_finish(app: AppHandle, stop_rx: mpsc::Receiver<()>) {
    let host = cpal::default_host();
    let Some(device) = host.default_input_device() else {
        emit_error(&app, "No microphone found.");
        return;
    };
    let config = match device.default_input_config() {
        Ok(c) => c,
        Err(e) => {
            emit_error(&app, format!("No usable microphone input: {e}"));
            return;
        }
    };
    let sample_format = config.sample_format();
    let stream_config: cpal::StreamConfig = config.into();
    let native_rate = stream_config.sample_rate.0;
    let channels = stream_config.channels as usize;

    let buffer: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));
    let err_app = app.clone();
    let error_callback = move |err: cpal::StreamError| {
        eprintln!("voice: input stream error: {err}");
        let _ = err_app.emit(
            "voice:state",
            StatePayload {
                state: "error",
                message: Some(err.to_string()),
            },
        );
    };

    let stream_result: Result<cpal::Stream, String> = {
        let buffer = buffer.clone();
        match sample_format {
            cpal::SampleFormat::F32 => device
                .build_input_stream(
                    &stream_config,
                    move |data: &[f32], _| push_mono(&buffer, data, channels, |s| s),
                    error_callback,
                    None,
                )
                .map_err(|e| e.to_string()),
            cpal::SampleFormat::I16 => device
                .build_input_stream(
                    &stream_config,
                    move |data: &[i16], _| {
                        push_mono(&buffer, data, channels, |s| {
                            f32::from(s) / f32::from(i16::MAX)
                        })
                    },
                    error_callback,
                    None,
                )
                .map_err(|e| e.to_string()),
            cpal::SampleFormat::U16 => device
                .build_input_stream(
                    &stream_config,
                    move |data: &[u16], _| {
                        push_mono(&buffer, data, channels, |s| {
                            (f32::from(s) - 32768.0) / 32768.0
                        })
                    },
                    error_callback,
                    None,
                )
                .map_err(|e| e.to_string()),
            other => Err(format!("unsupported sample format: {other:?}")),
        }
    };
    let stream = match stream_result {
        Ok(s) => s,
        Err(e) => {
            emit_error(&app, format!("failed to open microphone: {e}"));
            return;
        }
    };
    if let Err(e) = stream.play() {
        emit_error(&app, format!("failed to start recording: {e}"));
        return;
    }

    let started = Instant::now();
    loop {
        match stop_rx.recv_timeout(Duration::from_millis(200)) {
            Ok(()) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if started.elapsed() >= Duration::from_secs(MAX_RECORDING_SECS) {
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    drop(stream);

    let state = app.state::<VoiceState>();
    *state.recording.lock().unwrap() = None;

    let samples = buffer.lock().unwrap().clone();
    finish_recording(&app, samples, native_rate);
}

fn push_mono<T: Copy>(
    buffer: &Arc<Mutex<Vec<f32>>>,
    data: &[T],
    channels: usize,
    convert: impl Fn(T) -> f32,
) {
    let mut buf = buffer.lock().unwrap();
    if channels <= 1 {
        buf.extend(data.iter().map(|&s| convert(s)));
    } else {
        for frame in data.chunks(channels) {
            let sum: f32 = frame.iter().map(|&s| convert(s)).sum();
            buf.push(sum / channels as f32);
        }
    }
}

fn finish_recording(app: &AppHandle, samples: Vec<f32>, native_rate: u32) {
    set_phase(app, Phase::Transcribing);
    let mono16k = resample_to_16k(&samples, native_rate);
    let stt_state = app.state::<crate::stt::SttState>();
    match crate::stt::transcribe(&stt_state, &mono16k) {
        Ok(text) if !text.is_empty() => {
            if let Err(e) = paste_text(&text) {
                eprintln!("voice: paste failed: {e}");
            }
            set_phase(app, Phase::Idle);
        }
        Ok(_) => set_phase(app, Phase::Idle),
        Err(e) => emit_error(app, e),
    }
}

/// Downsamples (or upsamples) mono PCM to 16 kHz via linear interpolation.
/// Pure so it's unit-testable without live audio.
pub fn resample_to_16k(input: &[f32], from_rate: u32) -> Vec<f32> {
    resample_linear(input, from_rate, 16_000)
}

fn resample_linear(input: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if input.is_empty() || from_rate == 0 || to_rate == 0 {
        return Vec::new();
    }
    if from_rate == to_rate {
        return input.to_vec();
    }
    let ratio = f64::from(from_rate) / f64::from(to_rate);
    let out_len = ((input.len() as f64) / ratio).round() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src_pos = i as f64 * ratio;
        let idx = src_pos.floor() as usize;
        let frac = (src_pos - idx as f64) as f32;
        let a = input[idx.min(input.len() - 1)];
        let b = input[(idx + 1).min(input.len() - 1)];
        out.push(a + (b - a) * frac);
    }
    out
}

/// Copies `text` to the clipboard, sends Ctrl+V to whichever window
/// currently has focus (never workhub's own — the indicator window is
/// non-focusable), then restores whatever text was on the clipboard before.
/// Win32 clipboard APIs, not the webview clipboard plugin: the app doesn't
/// have focus when this runs, so the paste target is some other process.
#[cfg(windows)]
fn paste_text(text: &str) -> Result<(), String> {
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
fn paste_text(_text: &str) -> Result<(), String> {
    Err("paste injection is only implemented on Windows".into())
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
    /// currently has OS keyboard focus (not this process's own windows,
    /// since the indicator is non-focusable and never takes it).
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

/// (Re)register the global hotkey from the current settings. Mirrors
/// `quick_capture::apply_shortcut`: tries the configured key, then
/// fallbacks, and reports what actually got registered.
pub fn apply_shortcut(app: &AppHandle) {
    let settings = storage::load().settings;
    let state = app.state::<VoiceState>();

    if let Some(prev) = state.shortcut.lock().unwrap().take() {
        let _ = app.global_shortcut().unregister(prev);
    }
    if !settings.voice_enabled {
        return;
    }

    let preferred = settings.voice_hotkey.as_str();
    for candidate in candidates(preferred, FALLBACK_SHORTCUTS) {
        let shortcut: Shortcut = match candidate.parse() {
            Ok(s) => s,
            Err(e) => {
                eprintln!("voice: invalid shortcut {candidate}: {e}");
                continue;
            }
        };
        match app.global_shortcut().register(shortcut) {
            Ok(()) => {
                if candidate != preferred {
                    eprintln!("voice: {preferred} is taken, registered {candidate} instead");
                }
                *state.shortcut.lock().unwrap() = Some(shortcut);
                return;
            }
            Err(e) => eprintln!("voice: failed to register {candidate}: {e}"),
        }
    }
    eprintln!("voice: could not register any hotkey ({preferred})");
}

/// True when `pressed` is the hotkey currently registered for voice input.
pub fn matches(app: &AppHandle, pressed: &Shortcut) -> bool {
    app.try_state::<VoiceState>()
        .is_some_and(|s| s.shortcut.lock().unwrap().as_ref() == Some(pressed))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidates_prefers_configured_key_then_fallbacks() {
        assert_eq!(
            candidates("Ctrl+Shift+Space", &["Ctrl+Alt+Space"]),
            vec!["Ctrl+Shift+Space", "Ctrl+Alt+Space"]
        );
    }

    #[test]
    fn candidates_dedupes_when_configured_equals_fallback() {
        assert_eq!(
            candidates("Ctrl+Alt+Space", &["Ctrl+Alt+Space"]),
            vec!["Ctrl+Alt+Space"]
        );
    }

    #[test]
    fn resample_identity_when_rate_matches() {
        let input = vec![0.1, 0.2, 0.3, 0.4];
        assert_eq!(resample_linear(&input, 16_000, 16_000), input);
    }

    #[test]
    fn resample_downsamples_to_expected_length() {
        let input = vec![0.0f32; 48_000]; // 1s @ 48kHz
        let out = resample_linear(&input, 48_000, 16_000);
        // 1s @ 16kHz
        assert!((out.len() as i64 - 16_000).abs() <= 1);
    }

    #[test]
    fn resample_upsamples_to_expected_length() {
        let input = vec![0.0f32; 8_000]; // 1s @ 8kHz
        let out = resample_linear(&input, 8_000, 16_000);
        assert!((out.len() as i64 - 16_000).abs() <= 1);
    }

    #[test]
    fn resample_empty_input_returns_empty() {
        assert!(resample_linear(&[], 48_000, 16_000).is_empty());
    }

    #[test]
    fn resample_interpolates_between_samples() {
        // 2 samples at half rate -> 4 samples at full rate; midpoints should
        // be interpolated, not just repeated.
        let input = vec![0.0, 1.0];
        let out = resample_linear(&input, 8_000, 16_000);
        assert_eq!(out.len(), 4);
        assert_eq!(out[0], 0.0);
    }

    #[test]
    fn settings_defaults() {
        let s = crate::models::Settings::default();
        assert!(s.voice_enabled);
        assert_eq!(s.voice_hotkey, "Ctrl+Shift+Space");
        assert_eq!(s.voice_model, "small");
        assert_eq!(s.voice_language, "auto");
    }

    #[test]
    fn settings_deserialize_missing_fields_uses_defaults() {
        let s: crate::models::Settings = serde_json::from_str("{}").unwrap();
        assert!(s.voice_enabled);
        assert_eq!(s.voice_hotkey, "Ctrl+Shift+Space");
        assert_eq!(s.voice_model, "small");
        assert_eq!(s.voice_language, "auto");
    }
}
