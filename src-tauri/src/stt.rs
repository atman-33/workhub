//! Local speech-to-text: whisper.cpp (ggml) model management and
//! transcription. No LLM, no cloud — everything runs on-device via
//! `whisper-rs`.
//!
//! Models are stored in `~/.workhub/models/ggml-<name>.bin`, mirroring how
//! `storage::config_dir()` derives the app's config directory. The
//! catalog (URL/size/checksum) is taken from the same upstream
//! `whisper.cpp` release ggerganov publishes models from; note the
//! `checksum` values published alongside those models are **SHA-1**, not
//! SHA-256 (verified: they are 40 hex chars / 160 bits) — verification here
//! uses SHA-1 to match, via the `sha1` crate.

use serde::Serialize;
use sha1::{Digest, Sha1};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::storage;

/// One entry in the whisper.cpp ggml model catalog.
pub struct ModelInfo {
    /// Short id used in Settings and the model directory filename
    /// (`ggml-<name>.bin`), e.g. "small".
    pub name: &'static str,
    pub url: &'static str,
    /// Human-readable size for the Settings UI (display only; the SHA-1
    /// checksum is the actual integrity gate).
    pub size_label: &'static str,
    pub size_bytes: u64,
    pub sha1: &'static str,
}

pub const MODELS: &[ModelInfo] = &[
    ModelInfo {
        name: "tiny",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
        size_label: "~75 MB",
        size_bytes: 77_691_713,
        sha1: "bd577a113a864445d4c299885e0cb97d4ba92b5f",
    },
    ModelInfo {
        name: "base",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
        size_label: "~142 MB",
        size_bytes: 147_951_465,
        sha1: "465707469ff3a37a2b9b8d8f89f2f99de7299dac",
    },
    ModelInfo {
        name: "small",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
        size_label: "~466 MB",
        size_bytes: 487_601_967,
        sha1: "55356645c2b361a969dfd0ef2c5a50d530afd8d5",
    },
];

fn model_info(name: &str) -> Option<&'static ModelInfo> {
    MODELS.iter().find(|m| m.name == name)
}

/// `~/.workhub/models`, created on demand.
pub fn models_dir() -> PathBuf {
    storage::config_dir().join("models")
}

fn model_path(name: &str) -> PathBuf {
    models_dir().join(format!("ggml-{name}.bin"))
}

fn part_path(name: &str) -> PathBuf {
    models_dir().join(format!("ggml-{name}.bin.part"))
}

#[derive(Serialize, Clone)]
pub struct ModelStatus {
    pub model: String,
    pub size_label: String,
    pub downloaded: bool,
    pub active: bool,
}

/// Per-model download/active status for the Settings UI.
pub fn model_status() -> Vec<ModelStatus> {
    let active = storage::load().settings.voice_model;
    MODELS
        .iter()
        .map(|m| ModelStatus {
            model: m.name.to_string(),
            size_label: m.size_label.to_string(),
            downloaded: model_path(m.name).is_file(),
            active: m.name == active,
        })
        .collect()
}

#[derive(Serialize, Clone)]
struct DownloadProgress {
    model: String,
    downloaded: u64,
    total: u64,
}

#[derive(Serialize, Clone)]
struct DownloadError {
    model: String,
    message: String,
}

/// Downloads a model to a `.part` file, verifies its SHA-1 checksum, then
/// renames it into place. Emits `stt:download-progress` (throttled to ~4/s),
/// and `stt:download-done` / `stt:download-error` on completion.
pub fn download_model(app: &AppHandle, name: &str) -> Result<(), String> {
    let info = model_info(name).ok_or_else(|| format!("unknown model: {name}"))?;
    let dir = models_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let result = (|| -> Result<(), String> {
        let response = ureq::get(info.url)
            .call()
            .map_err(|e| format!("download failed: {e}"))?;
        let total = response
            .header("Content-Length")
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(info.size_bytes);

        let part = part_path(name);
        let mut file = std::fs::File::create(&part).map_err(|e| e.to_string())?;
        let mut reader = response.into_reader();
        let mut buf = [0u8; 64 * 1024];
        let mut downloaded: u64 = 0;
        let mut hasher = Sha1::new();
        let mut last_emit = Instant::now();
        loop {
            let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
            hasher.update(&buf[..n]);
            downloaded += n as u64;
            if last_emit.elapsed().as_millis() >= 250 {
                let _ = app.emit(
                    "stt:download-progress",
                    DownloadProgress {
                        model: name.to_string(),
                        downloaded,
                        total,
                    },
                );
                last_emit = Instant::now();
            }
        }
        drop(file);
        let _ = app.emit(
            "stt:download-progress",
            DownloadProgress {
                model: name.to_string(),
                downloaded,
                total,
            },
        );

        let digest = hasher.finalize();
        let hex = digest
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        if hex != info.sha1 {
            let _ = std::fs::remove_file(&part);
            return Err(format!(
                "checksum mismatch for {name}: expected {}, got {hex}",
                info.sha1
            ));
        }

        std::fs::rename(&part, model_path(name)).map_err(|e| e.to_string())?;
        Ok(())
    })();

    match &result {
        Ok(()) => {
            let _ = app.emit("stt:download-done", name);
        }
        Err(e) => {
            let _ = app.emit(
                "stt:download-error",
                DownloadError {
                    model: name.to_string(),
                    message: e.clone(),
                },
            );
        }
    }
    result
}

pub fn delete_model(name: &str) -> Result<(), String> {
    let path = model_path(name);
    if path.is_file() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Lazily-loaded, kept-resident whisper context. Reloaded when the
/// configured model changes.
#[derive(Default)]
pub struct SttState(pub Mutex<Option<(String, WhisperContext)>>);

/// Runs local transcription on 16 kHz mono PCM samples. Loads (or reloads,
/// if the configured model changed) the ggml model on first use and keeps it
/// resident in `SttState`. Intended to be called from
/// `tauri::async_runtime::spawn_blocking`.
///
/// `initial_prompt`, when non-empty, seeds whisper's context (used by the
/// streaming voice-input worker to carry the tail of the previous chunk's
/// transcript across chunk boundaries so wording stays consistent).
pub fn transcribe(
    state: &SttState,
    samples: &[f32],
    initial_prompt: Option<&str>,
) -> Result<String, String> {
    let settings = storage::load().settings;
    let model_name = settings.voice_model;
    let path = model_path(&model_name);
    if !path.is_file() {
        return Err(format!(
            "Model '{model_name}' not downloaded (Settings > Voice)"
        ));
    }

    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let needs_load = match guard.as_ref() {
        Some((loaded, _)) => loaded != &model_name,
        None => true,
    };
    if needs_load {
        let ctx = WhisperContext::new_with_params(
            path.to_str().ok_or("model path is not valid UTF-8")?,
            WhisperContextParameters::default(),
        )
        .map_err(|e| format!("failed to load model: {e}"))?;
        *guard = Some((model_name.clone(), ctx));
    }
    let (_, ctx) = guard.as_ref().expect("just populated");

    let mut whisper_state = ctx.create_state().map_err(|e| e.to_string())?;
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    let language = match settings.voice_language.as_str() {
        "auto" | "" => None,
        other => Some(other),
    };
    // set_language takes Option<&str> with the same lifetime as `params`;
    // `language` above already borrows from `settings`, which outlives this call.
    params.set_language(language);
    if let Some(prompt) = initial_prompt {
        if !prompt.is_empty() {
            params.set_initial_prompt(prompt);
        }
    }
    params.set_translate(false);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_no_timestamps(true);
    params.set_single_segment(false);

    whisper_state
        .full(params, samples)
        .map_err(|e| format!("transcription failed: {e}"))?;

    let n_segments = whisper_state.full_n_segments().map_err(|e| e.to_string())?;
    let mut text = String::new();
    for i in 0..n_segments {
        if let Ok(segment) = whisper_state.full_get_segment_text_lossy(i) {
            text.push_str(&segment);
        }
    }
    Ok(text.trim().to_string())
}
