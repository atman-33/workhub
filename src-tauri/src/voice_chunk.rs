//! Pure, unit-testable chunk-boundary detection for streaming voice input.
//!
//! `voice.rs`'s recording loop feeds the not-yet-consumed tail of its native-
//! rate capture buffer through [`Chunker::find_boundary`] on every ~200ms
//! wakeup. A boundary is returned once enough trailing silence follows some
//! speech (or the chunk has grown very long); the caller resamples and hands
//! the finalized slice off to the transcriber worker, then keeps scanning the
//! remainder. At stop, [`Chunker::has_min_speech`] gates whether the final,
//! unterminated tail is worth transcribing at all.

/// Frame size used for RMS-based silence detection. Short enough to localize
/// the cut point reasonably precisely, long enough to average out sample-to-
/// sample noise.
const FRAME_MS: u32 = 32;

/// A frame is "silent" if its RMS falls below this. Chosen empirically as a
/// low threshold that catches near-silence/room noise while not tripping on
/// quiet speech; samples are normalized floats in [-1.0, 1.0].
const SILENCE_RMS_THRESHOLD: f32 = 0.010;

/// A chunk is cut once at least this much trailing silence follows speech.
const TRAILING_SILENCE_MS: u32 = 600;

/// Padding kept at the end of a silence-terminated chunk (whisper tends to
/// clip the last word without a little trailing room).
const SILENCE_PADDING_MS: u32 = 150;

/// Chunks are force-cut once they reach this much audio, even mid-speech.
const FORCE_CUT_MS: u32 = 15_000;

/// Chunks (or the final tail flush) with less total speech than this are
/// discarded — short enough that whisper reliably hallucinates boilerplate
/// ("thank you for watching", etc.) on silence-only audio.
const MIN_SPEECH_MS: u32 = 300;

/// A detected chunk boundary within the scanned slice.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ChunkCut {
    /// End index (exclusive) into the scanned slice; `samples[..end]` is the
    /// finalized chunk, `samples[end..]` should be rescanned on the next call.
    pub end: usize,
    /// Whether the finalized chunk contains at least `MIN_SPEECH_MS` of
    /// speech. Callers should discard chunks where this is `false`.
    pub has_min_speech: bool,
}

/// Frame-based silence chunker for one native-rate sample stream.
#[derive(Debug, Clone, Copy)]
pub struct Chunker {
    sample_rate: u32,
}

impl Chunker {
    pub fn new(sample_rate: u32) -> Self {
        Self { sample_rate }
    }

    fn frame_len(&self) -> usize {
        ((u64::from(self.sample_rate) * u64::from(FRAME_MS)) / 1000).max(1) as usize
    }

    fn silence_run_frames_needed(&self) -> usize {
        (u64::from(TRAILING_SILENCE_MS) / u64::from(FRAME_MS)).max(1) as usize
    }

    fn padding_frames(&self) -> usize {
        (u64::from(SILENCE_PADDING_MS) / u64::from(FRAME_MS)).max(1) as usize
    }

    fn min_speech_frames(&self) -> usize {
        (u64::from(MIN_SPEECH_MS) / u64::from(FRAME_MS)).max(1) as usize
    }

    fn force_cut_samples(&self) -> usize {
        ((u64::from(self.sample_rate) * u64::from(FORCE_CUT_MS)) / 1000) as usize
    }

    /// Scans `samples` (the not-yet-consumed tail since the last chunk
    /// boundary) for the next cut point. Returns `None` if no boundary has
    /// been reached yet — the caller should wait for more audio and rescan.
    pub fn find_boundary(&self, samples: &[f32]) -> Option<ChunkCut> {
        if self.sample_rate == 0 || samples.is_empty() {
            return None;
        }
        let frame_len = self.frame_len();
        let silence_run_needed = self.silence_run_frames_needed();
        let padding_frames = self.padding_frames();
        let min_speech_frames = self.min_speech_frames();
        let force_cut_samples = self.force_cut_samples();

        let total_frames = samples.len() / frame_len;
        let mut speech_seen = false;
        let mut speech_frames = 0usize;
        let mut silence_run = 0usize;

        for i in 0..total_frames {
            let frame = &samples[i * frame_len..(i + 1) * frame_len];
            let end_sample = (i + 1) * frame_len;
            if rms(frame) < SILENCE_RMS_THRESHOLD {
                silence_run += 1;
                if speech_seen && silence_run >= silence_run_needed {
                    let cut_start_frame = i + 1 - silence_run;
                    let cut_end_frame = (cut_start_frame + padding_frames).min(i + 1);
                    return Some(ChunkCut {
                        end: cut_end_frame * frame_len,
                        has_min_speech: speech_frames >= min_speech_frames,
                    });
                }
            } else {
                speech_seen = true;
                speech_frames += 1;
                silence_run = 0;
            }
            if force_cut_samples > 0 && end_sample >= force_cut_samples {
                return Some(ChunkCut {
                    end: end_sample,
                    has_min_speech: speech_frames >= min_speech_frames,
                });
            }
        }
        None
    }

    /// Whether `samples` contains at least `MIN_SPEECH_MS` of non-silent
    /// audio. Used to gate the final tail flush at stop, which (unlike
    /// `find_boundary`) has no trailing silence to wait for.
    pub fn has_min_speech(&self, samples: &[f32]) -> bool {
        let frame_len = self.frame_len();
        if self.sample_rate == 0 || samples.is_empty() {
            return false;
        }
        let total_frames = samples.len() / frame_len;
        let speech_frames = (0..total_frames)
            .filter(|&i| rms(&samples[i * frame_len..(i + 1) * frame_len]) >= SILENCE_RMS_THRESHOLD)
            .count();
        speech_frames >= self.min_speech_frames()
    }
}

fn rms(frame: &[f32]) -> f32 {
    if frame.is_empty() {
        return 0.0;
    }
    let sum_sq: f32 = frame.iter().map(|&s| s * s).sum();
    (sum_sq / frame.len() as f32).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 16_000;

    fn silence(ms: u32) -> Vec<f32> {
        vec![0.0f32; (RATE as u64 * u64::from(ms) / 1000) as usize]
    }

    fn speech(ms: u32) -> Vec<f32> {
        // A steady tone well above the silence threshold.
        let n = (RATE as u64 * u64::from(ms) / 1000) as usize;
        (0..n).map(|i| 0.2 * ((i as f32) * 0.3).sin()).collect()
    }

    #[test]
    fn no_boundary_while_still_speaking() {
        let chunker = Chunker::new(RATE);
        let samples = speech(500);
        assert_eq!(chunker.find_boundary(&samples), None);
    }

    #[test]
    fn cuts_after_trailing_silence_following_speech() {
        let chunker = Chunker::new(RATE);
        let mut samples = speech(500);
        samples.extend(silence(700)); // >= 600ms trailing silence
        let cut = chunker.find_boundary(&samples).expect("should cut");
        assert!(cut.has_min_speech);
        // Cut point should land inside the silence run, leaving ~150ms of
        // padding before the end of the scanned audio, i.e. well before the
        // full 700ms of silence has been consumed.
        assert!(cut.end > samples.len() - (700 * RATE as usize / 1000));
        assert!(cut.end < samples.len());
    }

    #[test]
    fn short_speech_before_silence_is_discarded_as_below_min_speech() {
        let chunker = Chunker::new(RATE);
        let mut samples = speech(100); // < 300ms of speech
        samples.extend(silence(700));
        let cut = chunker.find_boundary(&samples).expect("should still cut");
        assert!(!cut.has_min_speech);
    }

    #[test]
    fn force_cuts_at_fifteen_seconds_of_continuous_speech() {
        let chunker = Chunker::new(RATE);
        let samples = speech(16_000); // 16s, no silence at all
        let cut = chunker.find_boundary(&samples).expect("should force-cut");
        let expected = (RATE as u64 * 15) as usize;
        // Cut lands at (or just after, frame-aligned) the 15s mark.
        assert!(cut.end >= expected);
        assert!(cut.end < expected + RATE as usize / 10);
        assert!(cut.has_min_speech);
    }

    #[test]
    fn has_min_speech_true_for_enough_speech() {
        let chunker = Chunker::new(RATE);
        assert!(chunker.has_min_speech(&speech(400)));
    }

    #[test]
    fn has_min_speech_false_for_silence_only_tail() {
        let chunker = Chunker::new(RATE);
        assert!(!chunker.has_min_speech(&silence(500)));
    }

    #[test]
    fn has_min_speech_false_for_short_speech_tail() {
        let chunker = Chunker::new(RATE);
        assert!(!chunker.has_min_speech(&speech(100)));
    }

    #[test]
    fn empty_input_has_no_boundary_and_no_speech() {
        let chunker = Chunker::new(RATE);
        assert_eq!(chunker.find_boundary(&[]), None);
        assert!(!chunker.has_min_speech(&[]));
    }
}
