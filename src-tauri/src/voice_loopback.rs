//! WASAPI loopback capture of the system's output audio (T-0316).
//!
//! Meeting dictation needs the other side's voice too, and `cpal` exposes no
//! loopback API — an input stream only ever hears the microphone. So this
//! module talks to WASAPI directly (through the already-depended-on `windows`
//! crate): the default render endpoint is opened in shared mode with
//! `AUDCLNT_STREAMFLAGS_LOOPBACK`, which yields exactly what is being played,
//! downmixed here to mono `f32`. The caller (`voice.rs`) resamples that feed
//! to 16 kHz and mixes it with the microphone feed.
//!
//! Anything failing here (no output device, unsupported mix format, COM
//! error) is an `Err(String)` and the caller falls back to microphone-only
//! rather than failing the session: one side heard beats none.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use windows::Win32::Media::Audio::{
    eMultimedia, eRender, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator,
    MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
    AUDCLNT_STREAMFLAGS_LOOPBACK, WAVEFORMATEX, WAVEFORMATEXTENSIBLE,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
    COINIT_MULTITHREADED,
};

/// How long `start` waits for WASAPI init before giving up.
const INIT_TIMEOUT: Duration = Duration::from_secs(5);
/// Shared-mode buffer requested from the audio engine (100ns units: 1s).
const HNS_BUFFER: i64 = 10_000_000;
/// Poll interval of the capture loop.
const POLL: Duration = Duration::from_millis(15);

/// wFormatTag values (mmreg.h) matched as literals so no const-type juggling.
const TAG_PCM: u32 = 1; // WAVE_FORMAT_PCM
const TAG_IEEE_FLOAT: u32 = 3; // WAVE_FORMAT_IEEE_FLOAT
const TAG_EXTENSIBLE: u32 = 0xFFFE; // WAVE_FORMAT_EXTENSIBLE

/// Tail of the KSDATAFORMAT_SUBTYPE_{PCM,IEEE_FLOAT} GUIDs; data1 is 1 or 3.
const SUBTYPE_TAIL_DATA23: (u16, u16) = (0x0000, 0x0010);
const SUBTYPE_TAIL_DATA4: [u8; 8] = [0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71];

/// Mono f32 samples as captured; the caller resamples to 16 kHz from `rate`.
pub struct LoopbackCapture {
    buffer: Arc<Mutex<Vec<f32>>>,
    rate: u32,
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl LoopbackCapture {
    /// Starts capturing the default render endpoint. Blocks (up to a few
    /// seconds) until WASAPI init either reports the mix rate or fails.
    pub fn start() -> Result<Self, String> {
        let (tx, rx) = mpsc::channel::<Result<u32, String>>();
        let buffer: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let thread_buf = buffer.clone();
        let thread_stop = stop.clone();
        let thread = std::thread::Builder::new()
            .name("voice-loopback".into())
            .spawn(move || run(thread_buf, &thread_stop, tx))
            .map_err(|e| format!("voice: failed to spawn loopback thread: {e}"))?;
        let rate = rx
            .recv_timeout(INIT_TIMEOUT)
            .map_err(|_| "voice: loopback init timed out".to_string())??;
        Ok(Self {
            buffer,
            rate,
            stop,
            thread: Some(thread),
        })
    }

    /// Mix rate of the captured endpoint; resample `drain` output from this.
    pub fn rate(&self) -> u32 {
        self.rate
    }

    /// Takes all samples captured so far (mono f32 at `rate()`).
    pub fn drain(&self) -> Vec<f32> {
        std::mem::take(&mut *self.buffer.lock().unwrap())
    }

    /// Signals the capture loop to exit and waits for it.
    pub fn stop(mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

/// Mixes two 16 kHz mono slices sample-wise (mean where both are present).
/// Pure so it is unit-testable without an audio device. Clock drift between
/// the microphone and the render endpoint means the slices are rarely the
/// same length: the missing tail of the shorter one passes the other through
/// instead of dipping to silence.
pub fn mix_16k(a: &[f32], b: &[f32]) -> Vec<f32> {
    if a.is_empty() {
        return b.to_vec();
    }
    if b.is_empty() {
        return a.to_vec();
    }
    let n = a.len().max(b.len());
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        match (a.get(i), b.get(i)) {
            (Some(&x), Some(&y)) => out.push((x + y) * 0.5),
            (Some(&x), None) => out.push(x),
            (None, Some(&y)) => out.push(y),
            (None, None) => {}
        }
    }
    out
}

#[derive(Clone, Copy, PartialEq)]
enum LoopFormat {
    F32,
    I16,
}

fn run(buffer: Arc<Mutex<Vec<f32>>>, stop: &AtomicBool, ready: mpsc::Sender<Result<u32, String>>) {
    let mut ready = Some(ready);
    // SAFETY: every WASAPI/COM call below runs on this thread, which owns its
    // COM apartment (initialized first, uninitialized last).
    let result = unsafe { init_and_capture(&buffer, stop, &mut ready) };
    if let Err(e) = result {
        crate::diag!("voice: loopback error: {e}");
        // Init may not have reported yet: never leave `start()` hanging.
        if let Some(tx) = ready.take() {
            let _ = tx.send(Err(e));
        }
    }
}

/// COM apartment setup/teardown around the real work.
unsafe fn init_and_capture(
    buffer: &Arc<Mutex<Vec<f32>>>,
    stop: &AtomicBool,
    ready: &mut Option<mpsc::Sender<Result<u32, String>>>,
) -> Result<(), String> {
    CoInitializeEx(None, COINIT_MULTITHREADED)
        .ok()
        .map_err(|e| format!("voice: COM init failed: {e}"))?;
    let result = init_and_capture_inner(buffer, stop, ready);
    CoUninitialize();
    result
}

unsafe fn init_and_capture_inner(
    buffer: &Arc<Mutex<Vec<f32>>>,
    stop: &AtomicBool,
    ready: &mut Option<mpsc::Sender<Result<u32, String>>>,
) -> Result<(), String> {
    let enumerator: IMMDeviceEnumerator =
        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .map_err(|e| format!("voice: no audio device enumerator: {e}"))?;
    let device = enumerator
        .GetDefaultAudioEndpoint(eRender, eMultimedia)
        .map_err(|e| format!("voice: no output device for loopback: {e}"))?;
    let client: IAudioClient = device
        .Activate(CLSCTX_ALL, None)
        .map_err(|e| format!("voice: loopback client activate failed: {e}"))?;
    let mix = client
        .GetMixFormat()
        .map_err(|e| format!("voice: loopback mix format query failed: {e}"))?;
    let parsed = parse_mix_format(mix);
    // The format pointer is only needed for `Initialize` below.
    let (format, channels, rate) = match parsed {
        Ok(p) => p,
        Err(e) => {
            CoTaskMemFree(Some(mix as *const _ as *const core::ffi::c_void));
            return Err(e);
        }
    };
    // SAFETY: `mix` is a valid mix format until freed after `Initialize`.
    let init = client.Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK,
        HNS_BUFFER,
        0,
        mix as *const _,
        None,
    );
    CoTaskMemFree(Some(mix as *const _ as *const core::ffi::c_void));
    init.map_err(|e| format!("voice: loopback initialize failed: {e}"))?;

    let capture: IAudioCaptureClient = client
        .GetService()
        .map_err(|e| format!("voice: loopback capture service failed: {e}"))?;
    client
        .Start()
        .map_err(|e| format!("voice: loopback start failed: {e}"))?;
    if let Some(tx) = ready.take() {
        let _ = tx.send(Ok(rate));
    }

    loop {
        if stop.load(Ordering::SeqCst) {
            break;
        }
        // Drain every pending packet before sleeping, so the shared buffer
        // never lags more than one poll interval behind playback.
        loop {
            let frames = capture
                .GetNextPacketSize()
                .map_err(|e| format!("voice: loopback packet query failed: {e}"))?;
            if frames == 0 {
                break;
            }
            let mut data: *mut u8 = std::ptr::null_mut();
            let mut got: u32 = 0;
            let mut flags: u32 = 0;
            capture
                .GetBuffer(&mut data, &mut got, &mut flags, None, None)
                .map_err(|e| format!("voice: loopback buffer read failed: {e}"))?;
            if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 {
                buffer
                    .lock()
                    .unwrap()
                    .extend(std::iter::repeat_n(0.0, got as usize * channels));
            } else if got > 0 && !data.is_null() {
                // SAFETY: `data` points at `got * channels` interleaved
                // samples of `format`, valid until `ReleaseBuffer`.
                push_mono_from_interleaved(buffer, data, got as usize, channels, format);
            }
            capture
                .ReleaseBuffer(got)
                .map_err(|e| format!("voice: loopback buffer release failed: {e}"))?;
        }
        std::thread::sleep(POLL);
    }
    let _ = client.Stop();
    Ok(())
}

/// Reads the mix format into (sample format, channel count, sample rate).
/// Only the two layouts render endpoints actually produce are accepted —
/// 32-bit float and 16-bit PCM, plain or extensible.
unsafe fn parse_mix_format(mix: *const WAVEFORMATEX) -> Result<(LoopFormat, usize, u32), String> {
    // SAFETY: caller guarantees a valid mix format pointer. The struct is
    // packed, so copy it out whole — field references would be unaligned.
    let wfx: WAVEFORMATEX = *mix;
    let bits = wfx.wBitsPerSample;
    let channels = wfx.nChannels as usize;
    let rate = wfx.nSamplesPerSec;
    if channels == 0 || rate == 0 {
        return Err("voice: loopback mix format has no channels or rate".to_string());
    }
    let tag = u32::from(wfx.wFormatTag);
    if tag == TAG_IEEE_FLOAT && bits == 32 {
        return Ok((LoopFormat::F32, channels, rate));
    }
    if tag == TAG_PCM && bits == 16 {
        return Ok((LoopFormat::I16, channels, rate));
    }
    if tag == TAG_EXTENSIBLE {
        // SAFETY: an extensible tag guarantees a WAVEFORMATEXTENSIBLE layout.
        // Copied out whole for the same packed-struct reason as above.
        let ext: WAVEFORMATEXTENSIBLE = *(mix as *const WAVEFORMATEXTENSIBLE);
        let sub = ext.SubFormat;
        let known_tail = sub.data2 == SUBTYPE_TAIL_DATA23.0
            && sub.data3 == SUBTYPE_TAIL_DATA23.1
            && sub.data4 == SUBTYPE_TAIL_DATA4;
        if known_tail && sub.data1 == 3 {
            return Ok((LoopFormat::F32, channels, rate));
        }
        if known_tail && sub.data1 == 1 && bits == 16 {
            return Ok((LoopFormat::I16, channels, rate));
        }
    }
    Err(format!(
        "voice: unsupported loopback mix format (tag {tag:#X}, {bits} bits, {channels}ch)"
    ))
}

/// Downmixes `frames` interleaved samples at `data` to mono f32.
unsafe fn push_mono_from_interleaved(
    buffer: &Arc<Mutex<Vec<f32>>>,
    data: *const u8,
    frames: usize,
    channels: usize,
    format: LoopFormat,
) {
    // SAFETY: caller guarantees `data` holds `frames * channels` samples of
    // `format`, valid for the duration of this call.
    let mut mono = Vec::with_capacity(frames);
    match format {
        LoopFormat::F32 => {
            let samples = std::slice::from_raw_parts(data as *const f32, frames * channels);
            for frame in samples.chunks(channels) {
                mono.push(frame.iter().sum::<f32>() / channels as f32);
            }
        }
        LoopFormat::I16 => {
            let samples = std::slice::from_raw_parts(data as *const i16, frames * channels);
            for frame in samples.chunks(channels) {
                let sum: f32 = frame
                    .iter()
                    .map(|&v| f32::from(v) / f32::from(i16::MAX))
                    .sum();
                mono.push(sum / channels as f32);
            }
        }
    }
    buffer.lock().unwrap().extend(mono);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mix_averages_where_both_present() {
        assert_eq!(mix_16k(&[1.0, 3.0], &[3.0, 1.0]), vec![2.0, 2.0]);
    }

    #[test]
    fn mix_passes_through_the_longer_tail() {
        assert_eq!(mix_16k(&[2.0, 4.0, 6.0], &[0.0, 0.0]), vec![1.0, 2.0, 6.0]);
        assert_eq!(mix_16k(&[0.0], &[0.0, 8.0]), vec![0.0, 8.0]);
    }

    #[test]
    fn mix_with_an_empty_side_returns_the_other() {
        let live = vec![0.5, -0.5];
        assert_eq!(mix_16k(&live, &[]), live);
        assert_eq!(mix_16k(&[], &live), live);
        assert!(mix_16k(&[], &[]).is_empty());
    }
}
