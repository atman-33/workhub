//! Global voice-input dictation: a global hotkey toggles microphone
//! recording, the audio is transcribed locally via `stt.rs`, and the result
//! is pasted into whichever app currently has focus (`paste.rs`: clipboard +
//! simulated Ctrl+V, with the original clipboard restored afterwards).
//!
//! Follows the `quick_capture.rs` conventions: the indicator window is built
//! hidden at startup and only ever shown/hidden from here (never built
//! inside the hotkey handler, which on Windows runs synchronously inside
//! WndProc); the hotkey is (re)registered through `apply_shortcut`, tried
//! against a configured value then fallbacks, exactly like quick capture.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::storage;
use crate::window_place;

pub const WINDOW_LABEL: &str = "voice-indicator";
const WINDOW_SIZE: (f64, f64) = (340.0, 48.0);
/// Grown to this size (top-left anchored) once the first `voice:preview`
/// chunk arrives; shrunk back to `WINDOW_SIZE` on idle/error.
const PREVIEW_WINDOW_SIZE: (f64, f64) = (420.0, 160.0);
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
    /// Raised by `cancel_recording` for the dictation session in flight, and
    /// lowered again when the next recording starts. It lives here rather
    /// than on `RecordingHandle` because a cancel is just as likely to arrive
    /// during transcription, by which point the handle is already gone.
    cancelled: AtomicBool,
    /// Last position (physical pixels) seen via `WindowEvent::Moved` on the
    /// indicator window; persisted to config when the indicator is hidden.
    indicator_pos: Mutex<Option<(i32, i32)>>,
}

/// What a finished dictation session should do with what it produced. Pulled
/// out of `record_and_finish` so the cancel semantics are testable without a
/// microphone: a cancelled session discards its transcript, and stays quiet
/// about a transcription error nobody is waiting for any more.
#[derive(Debug, PartialEq)]
enum Finish {
    /// Paste the transcript and keep it in the history.
    Deliver(String),
    /// The user cancelled: drop the transcript, paste nothing, record
    /// nothing, and leave the phase alone (`cancel_recording` already set
    /// it).
    Discard,
    /// Nothing was said.
    Nothing,
    /// Transcription failed and the user is still waiting on it.
    Failed(String),
}

fn finish_for(cancelled: bool, result: Result<String, String>) -> Finish {
    if cancelled {
        return Finish::Discard;
    }
    match result {
        Ok(text) if !text.is_empty() => Finish::Deliver(text),
        Ok(_) => Finish::Nothing,
        Err(e) => Finish::Failed(e),
    }
}

/// Whether the session in flight has been cancelled. Checked at every point
/// the recording and transcription threads would otherwise change the phase
/// or produce output, so a cancel lands wherever in the pipeline it arrives.
fn is_cancelled(app: &AppHandle) -> bool {
    app.state::<VoiceState>().cancelled.load(Ordering::SeqCst)
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
    let win = WebviewWindowBuilder::new(
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

    // The pill/preview is draggable (`data-tauri-drag-region` in the React
    // app); remember where the user leaves it so it can be restored on the
    // next show instead of always snapping back to bottom-center.
    let app_handle = app.clone();
    win.on_window_event(move |event| {
        if let tauri::WindowEvent::Moved(pos) = event {
            if let Some(state) = app_handle.try_state::<VoiceState>() {
                *state.indicator_pos.lock().unwrap() = Some((pos.x, pos.y));
            }
        }
    });
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

/// Restores the indicator to its last dragged position if one is saved and
/// its rect still overlaps a currently connected monitor (a monitor may
/// have been unplugged since); returns `false` (leaving positioning to the
/// caller) otherwise.
fn restore_saved_position(app: &AppHandle, win: &WebviewWindow) -> bool {
    let Some((x, y)) = storage::load().settings.voice_indicator_position else {
        return false;
    };
    let Ok(size) = win.outer_size() else {
        return false;
    };
    let monitors = app.available_monitors().unwrap_or_default();
    let fits_a_monitor = monitors.iter().any(|m| {
        let mp = m.position();
        let ms = m.size();
        x < mp.x + ms.width as i32
            && x + size.width as i32 > mp.x
            && y < mp.y + ms.height as i32
            && y + size.height as i32 > mp.y
    });
    if !fits_a_monitor {
        return false;
    }
    let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
    true
}

/// Places the indicator next to whatever the user is looking at: the focused
/// app's text caret, or — when no caret could be located — the mouse cursor.
/// Both probes read the state of the *other* app, so this must run before the
/// indicator is shown (it is non-focusable, so showing it does not disturb
/// them, but the caret probe is the slow part and there is nothing to gain
/// from showing an unplaced window first).
///
/// The outcome is logged: "the indicator showed up somewhere odd" is only
/// diagnosable if the probe's answer and the placement that followed from it
/// are on the record (T-0251 was reported without either).
fn position_at_caret(app: &AppHandle, win: &WebviewWindow) {
    let probe = crate::caret::probe_with_timeout();
    match probe {
        Some(caret) if window_place::place_near_caret(app, win, caret) => {
            crate::diag!("voice: indicator anchored to {caret:?}");
        }
        // Either no caret at all (an app with no text focus, or a provider
        // that reports none), or one `place_near_caret` refused to anchor to
        // — the mouse is the next best guess at where the eye is.
        _ => {
            crate::diag!("voice: indicator placed at the cursor (caret probe: {probe:?})");
            window_place::place_at_cursor(app, win);
        }
    }
}

/// Restores the placement the "fixed" mode remembers: the last dragged
/// position, else bottom-center of the primary monitor.
fn position_fixed(app: &AppHandle, win: &WebviewWindow) {
    if !restore_saved_position(app, win) {
        position_bottom_center(app, win);
    }
}

fn show_indicator(app: &AppHandle) {
    let Some(win) = window(app) else { return };
    // Position only on the hidden→shown transition: phase changes mid-session
    // (recording→transcribing, errors) re-enter here, and repositioning then
    // would yank the window away from wherever the user just dragged it.
    if !win.is_visible().unwrap_or(false) {
        if storage::load().settings.voice_indicator_placement == "caret" {
            // Reached when a phase after Recording is the first to show the
            // indicator (a recording too short for its own placement to land,
            // or an error raised before it started). The mouse cursor stands
            // in for the caret here: it is close enough and, unlike the caret
            // probe, cannot block.
            window_place::place_at_cursor(app, &win);
        } else {
            position_fixed(app, &win);
        }
    }
    let _ = win.show();
}

/// Shows the indicator for a starting recording. In "caret" placement the
/// caret probe can block for up to a few hundred milliseconds, and
/// `start_recording` is reached from the global-shortcut handler — which on
/// Windows runs inside WndProc — so the probe, the placement and the show all
/// happen on a worker thread. The indicator therefore appears a few tens of
/// milliseconds after the hotkey; recording itself has already started.
fn show_indicator_for_recording(app: &AppHandle) {
    if storage::load().settings.voice_indicator_placement != "caret" {
        show_indicator(app);
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let Some(win) = window(&app) else { return };
        // A recording always re-anchors, even if the indicator is somehow
        // still visible from a previous phase: the caret is where the user
        // is looking *now*.
        position_at_caret(&app, &win);
        // The phase may have moved on (a very short recording) while the
        // probe was running; showing then would leave a stuck indicator.
        if matches!(
            *app.state::<VoiceState>().phase.lock().unwrap(),
            Phase::Recording
        ) {
            let _ = win.show();
        }
    });
}

fn hide_indicator(app: &AppHandle) {
    let Some(win) = window(app) else { return };
    persist_indicator_position(app);
    let _ = win.hide();
}

/// Persists the last known dragged position to config. Called only when the
/// indicator is hidden (not on every `Moved` event), so this is a single
/// write with no debounce needed.
///
/// Only "fixed" placement has anywhere to restore a saved position to; in
/// "caret" placement every recording re-anchors, so remembering a drag would
/// only grow config noise.
fn persist_indicator_position(app: &AppHandle) {
    if storage::load().settings.voice_indicator_placement == "caret" {
        return;
    }
    let state = app.state::<VoiceState>();
    let Some(pos) = *state.indicator_pos.lock().unwrap() else {
        return;
    };
    let mut cfg = storage::load();
    cfg.settings.voice_indicator_position = Some(pos);
    if let Err(e) = storage::save(&cfg) {
        crate::diag!("voice: failed to persist indicator position: {e}");
    }
}

/// Resizes the indicator window while keeping its top-left corner fixed
/// (Tauri's `set_size` on Windows can otherwise shift the origin).
fn resize_keep_top_left(win: &WebviewWindow, size: (f64, f64)) {
    let prev_pos = win.outer_position().ok();
    let _ = win.set_size(tauri::LogicalSize::new(size.0, size.1));
    if let Some(pos) = prev_pos {
        let _ = win.set_position(pos);
    }
}

/// Pill baseline: entered on idle/error and at the start of every recording
/// so a previous session's preview growth never leaks into the next.
fn reset_to_pill_size(app: &AppHandle) {
    let Some(win) = window(app) else { return };
    resize_keep_top_left(&win, WINDOW_SIZE);
}

/// Grows the indicator to the preview size; called by the transcriber
/// worker the first time it has text to show.
fn grow_to_preview_size(app: &AppHandle) {
    let Some(win) = window(app) else { return };
    resize_keep_top_left(&win, PREVIEW_WINDOW_SIZE);
    // Anchored to a caret near the bottom of the screen, the taller preview
    // window would otherwise hang off the work area.
    window_place::clamp_to_work_area(app, &win);
}

#[derive(Serialize, Clone)]
struct StatePayload {
    state: &'static str,
    message: Option<String>,
}

#[derive(Serialize, Clone)]
struct PreviewPayload {
    text: String,
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
        Phase::Idle => {
            // Reset before hiding so the next recording always starts pill-
            // sized, even if this session grew into the preview layout.
            reset_to_pill_size(app);
            hide_indicator(app);
        }
        Phase::Recording => {
            reset_to_pill_size(app);
            show_indicator_for_recording(app);
        }
        // Keep whatever size Recording left it at (pill if no preview text
        // arrived yet, preview if it did) — the worker keeps draining and
        // may still grow it via `grow_to_preview_size`.
        Phase::Transcribing => show_indicator(app),
        Phase::Error(_) => {
            reset_to_pill_size(app);
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
        emit_error(app, "Voice input is off (Settings > Voice)");
        return;
    }
    if !crate::stt::models_dir()
        .join(format!("ggml-{}.bin", settings.voice_model))
        .is_file()
    {
        emit_error(
            app,
            format!(
                "Model '{}' not downloaded (Settings > Voice)",
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
        // A new session starts uncancelled, whatever the last one ended as.
        state.cancelled.store(false, Ordering::SeqCst);

        let app_handle = app.clone();
        std::thread::Builder::new()
            .name("voice-record".into())
            .spawn(move || record_and_finish(app_handle, stop_rx))
            .ok();
    }
    // Warm the model up while the user is speaking, so the first chunk isn't
    // stuck behind a multi-second model load.
    crate::stt::preload(app);
    set_phase(app, Phase::Recording);
}

/// Command entry point for the indicator's stop button: same stop path as
/// the hotkey toggle when a recording is in progress, a no-op otherwise
/// (mirrors `toggle`'s `Phase::Recording` arm).
pub fn stop_recording_command(app: &AppHandle) {
    let phase = app.state::<VoiceState>().phase.lock().unwrap().clone();
    if matches!(phase, Phase::Recording) {
        stop_recording(app);
    }
}

/// Command entry point for the indicator's discard button: abandons the
/// dictation session without pasting or recording anything.
///
/// Deliberately not on the hotkey. Discarding is destructive and the hotkey
/// is a toggle, so a mistimed second press would silently throw a transcript
/// away; and the indicator window is non-focusable (it must never take focus
/// from the app the text is going into), so a key pressed while it is on
/// screen is delivered to that app, not to it. The button it is, then.
///
/// Works in both live phases. During recording the capture loop is stopped
/// and its audio dropped; during transcription whisper cannot be interrupted
/// mid-call, so the chunk already running is allowed to finish and then
/// thrown away with the rest — a second at most, and the indicator is gone
/// before it happens either way.
pub fn cancel_recording(app: &AppHandle) {
    let phase = app.state::<VoiceState>().phase.lock().unwrap().clone();
    if !matches!(phase, Phase::Recording | Phase::Transcribing) {
        return;
    }
    let state = app.state::<VoiceState>();
    state.cancelled.store(true, Ordering::SeqCst);
    // Ends the capture loop when there is still one running; already `None`
    // when the cancel arrives during transcription.
    if let Some(handle) = state.recording.lock().unwrap().take() {
        let _ = handle.stop_tx.send(());
    }
    // Close the indicator now: the worker threads still have a chunk of work
    // to wind down, and the user has said they are done looking at it.
    set_phase(app, Phase::Idle);
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
        crate::diag!("voice: input stream error: {err}");
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

    // Chunk-join streaming: a dedicated worker thread sequentially
    // transcribes finalized chunks as they're cut (see `voice_chunk.rs`) and
    // accumulates the running text, so stop latency is just the tail chunk
    // instead of a full-buffer re-pass.
    let (chunk_tx, chunk_rx) = mpsc::channel::<Vec<f32>>();
    let worker_app = app.clone();
    let worker = match std::thread::Builder::new()
        .name("voice-transcribe".into())
        .spawn(move || run_transcriber(worker_app, chunk_rx))
    {
        Ok(handle) => handle,
        Err(e) => {
            drop(stream);
            emit_error(&app, format!("failed to start transcriber: {e}"));
            return;
        }
    };

    let chunker = crate::voice_chunk::Chunker::new(native_rate);
    let mut pending_start = 0usize;
    let mut aborted = false;

    let started = Instant::now();
    loop {
        let stop_requested = match stop_rx.recv_timeout(Duration::from_millis(200)) {
            Ok(()) => true,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                started.elapsed() >= Duration::from_secs(MAX_RECORDING_SECS)
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => true,
        };

        // Cut any chunks whose trailing silence has arrived since the last
        // wakeup and hand them to the worker; clone out of the lock first so
        // resampling/sending never blocks the cpal capture callback.
        let ready_chunks: Vec<Vec<f32>> = {
            let buf = buffer.lock().unwrap();
            let mut chunks = Vec::new();
            while let Some(cut) = chunker.find_boundary(&buf[pending_start..]) {
                let end = pending_start + cut.end;
                if cut.has_min_speech {
                    chunks.push(buf[pending_start..end].to_vec());
                }
                pending_start = end;
            }
            chunks
        };
        for chunk in ready_chunks {
            let resampled = resample_to_16k(&chunk, native_rate);
            if chunk_tx.send(resampled).is_err() {
                // Worker exited early (transcription error) and dropped its
                // receiver — abort the session instead of recording on.
                aborted = true;
                break;
            }
        }
        if aborted || stop_requested {
            break;
        }
    }
    drop(stream);

    // Auto-stop (MAX_RECORDING_SECS) never calls `stop_recording`, so the
    // phase can still be Recording here; make sure it reflects Transcribing
    // either way (idempotent when `stop_recording` already set it). A
    // cancelled session is already Idle and must not be dragged back out.
    if !is_cancelled(&app) {
        set_phase(&app, Phase::Transcribing);
    }

    let state = app.state::<VoiceState>();
    *state.recording.lock().unwrap() = None;

    if aborted {
        drop(chunk_tx);
        let message = match worker.join() {
            Ok(Err(e)) => e,
            Ok(Ok(_)) => "transcription failed".to_string(),
            Err(_) => "voice: transcriber thread panicked".to_string(),
        };
        if is_cancelled(&app) {
            return;
        }
        emit_error(&app, message);
        return;
    }

    // Flush whatever's left as the final chunk, even without trailing
    // silence — this is the only transcription work left at stop time.
    let tail: Vec<f32> = {
        let buf = buffer.lock().unwrap();
        buf[pending_start..].to_vec()
    };
    // A cancelled session sends no tail: transcribing it would only delay
    // the worker's exit to produce text that is about to be thrown away.
    if !is_cancelled(&app) && chunker.has_min_speech(&tail) {
        let resampled = resample_to_16k(&tail, native_rate);
        let _ = chunk_tx.send(resampled);
    }
    drop(chunk_tx); // closes the channel so the worker's `for` loop ends

    let transcript = match worker.join() {
        Ok(result) => result,
        Err(_) => Err("voice: transcriber thread panicked".to_string()),
    };
    match finish_for(is_cancelled(&app), transcript) {
        Finish::Deliver(text) => {
            // Recorded regardless of paste success below — this history is
            // the safety net for when the paste target lost focus (or the
            // paste otherwise failed) between recording and now.
            record_history_entry(&app, &text);
            if let Err(e) = crate::paste::paste_text(&text) {
                crate::diag!("voice: paste failed: {e}");
            }
            set_phase(&app, Phase::Idle);
        }
        Finish::Nothing => set_phase(&app, Phase::Idle),
        Finish::Failed(e) => emit_error(&app, e),
        // `cancel_recording` already set the phase and hid the indicator.
        // Touching it here would fight a recording the user may have started
        // in the meantime.
        Finish::Discard => {}
    }
}

/// Appends a completed transcript to the persistent voice history (a safety
/// net independent of whether `paste::paste_text` succeeds) and notifies any
/// open windows so the Voice history tab can refresh live.
fn record_history_entry(app: &AppHandle, text: &str) {
    let model = storage::load().settings.voice_model;
    let entry = crate::voice_history::HistoryEntry::new(text.to_string(), model);
    crate::voice_history::record(entry);
    let _ = app.emit("voice:history-updated", ());
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

/// Runs on the dedicated `voice-transcribe` thread for one recording
/// session: sequentially transcribes chunks from `chunk_rx` (16 kHz mono,
/// already resampled by the caller), accumulating the running transcript and
/// emitting `voice:preview` after each one, until the sender is dropped
/// (normal stop) or a transcription call fails (session abort — the caller
/// then emits the error state).
fn run_transcriber(app: AppHandle, chunk_rx: mpsc::Receiver<Vec<f32>>) -> Result<String, String> {
    let stt_state = app.state::<crate::stt::SttState>();
    let mut accumulated = String::new();
    let mut grown = false;
    for chunk in chunk_rx {
        // The queue may still hold chunks cut before the user gave up on
        // this session; none of them is worth a whisper pass.
        if is_cancelled(&app) {
            break;
        }
        let prompt = tail_prompt(&accumulated);
        let text = crate::stt::transcribe(&stt_state, &chunk, Some(&prompt))?;
        let trimmed = text.trim();
        if trimmed.is_empty() {
            continue;
        }
        append_chunk_text(&mut accumulated, trimmed);
        if !grown {
            grow_to_preview_size(&app);
            grown = true;
        }
        let _ = app.emit(
            "voice:preview",
            PreviewPayload {
                text: accumulated.clone(),
            },
        );
    }
    Ok(accumulated)
}

/// Appends a trimmed chunk's text to the accumulated transcript, joining
/// with a single space unless the accumulated text is empty or already ends
/// in whitespace.
fn append_chunk_text(accumulated: &mut String, chunk_text: &str) {
    if !accumulated.is_empty() && !accumulated.ends_with(char::is_whitespace) {
        accumulated.push(' ');
    }
    accumulated.push_str(chunk_text);
}

/// Tail of the accumulated transcript carried as whisper's `initial_prompt`
/// so wording/spelling choices stay consistent across chunk boundaries.
fn tail_prompt(accumulated: &str) -> String {
    const TAIL_CHARS: usize = 200;
    let char_count = accumulated.chars().count();
    if char_count <= TAIL_CHARS {
        accumulated.to_string()
    } else {
        accumulated.chars().skip(char_count - TAIL_CHARS).collect()
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
                crate::diag!("voice: invalid shortcut {candidate}: {e}");
                continue;
            }
        };
        match app.global_shortcut().register(shortcut) {
            Ok(()) => {
                if candidate != preferred {
                    crate::diag!("voice: {preferred} is taken, registered {candidate} instead");
                }
                *state.shortcut.lock().unwrap() = Some(shortcut);
                return;
            }
            Err(e) => crate::diag!("voice: failed to register {candidate}: {e}"),
        }
    }
    crate::diag!("voice: could not register any hotkey ({preferred})");
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
    fn a_cancelled_session_discards_a_successful_transcript() {
        assert_eq!(finish_for(true, Ok("hello there".into())), Finish::Discard);
    }

    #[test]
    fn a_cancelled_session_reports_no_transcription_error() {
        // Nobody is waiting on the result any more, so an error popup would
        // be about work the user already abandoned.
        assert_eq!(
            finish_for(true, Err("model exploded".into())),
            Finish::Discard
        );
    }

    #[test]
    fn a_normal_session_delivers_its_transcript() {
        assert_eq!(
            finish_for(false, Ok("hello there".into())),
            Finish::Deliver("hello there".into())
        );
    }

    #[test]
    fn a_silent_session_delivers_nothing() {
        assert_eq!(finish_for(false, Ok(String::new())), Finish::Nothing);
    }

    #[test]
    fn a_failed_session_reports_its_error() {
        assert_eq!(
            finish_for(false, Err("model exploded".into())),
            Finish::Failed("model exploded".into())
        );
    }

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
        assert!(s.voice_indicator_position.is_none());
    }

    #[test]
    fn settings_deserialize_missing_fields_uses_defaults() {
        let s: crate::models::Settings = serde_json::from_str("{}").unwrap();
        assert!(s.voice_enabled);
        assert_eq!(s.voice_hotkey, "Ctrl+Shift+Space");
        assert_eq!(s.voice_model, "small");
        assert_eq!(s.voice_language, "auto");
        assert!(s.voice_indicator_position.is_none());
    }

    #[test]
    fn append_chunk_text_joins_with_single_space() {
        let mut acc = "Hello".to_string();
        append_chunk_text(&mut acc, "world");
        assert_eq!(acc, "Hello world");
    }

    #[test]
    fn append_chunk_text_does_not_double_space() {
        let mut acc = "Hello ".to_string();
        append_chunk_text(&mut acc, "world");
        assert_eq!(acc, "Hello world");
    }

    #[test]
    fn append_chunk_text_starts_clean_when_empty() {
        let mut acc = String::new();
        append_chunk_text(&mut acc, "Hello");
        assert_eq!(acc, "Hello");
    }

    #[test]
    fn tail_prompt_returns_whole_text_when_short() {
        assert_eq!(tail_prompt("short text"), "short text");
    }

    #[test]
    fn tail_prompt_truncates_to_last_200_chars() {
        let long: String = "a".repeat(500);
        let tail = tail_prompt(&long);
        assert_eq!(tail.chars().count(), 200);
        assert_eq!(tail, "a".repeat(200));
    }
}
