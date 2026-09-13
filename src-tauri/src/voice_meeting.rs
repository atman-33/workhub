//! Voice meeting mode: accumulates finalized dictation transcripts into a
//! per-meeting Markdown file while a meeting session is active.
//!
//! The audio path is untouched — `voice.rs` keeps cutting chunks and pasting
//! transcripts exactly as before. The only hook is in `record_history_entry`:
//! when a meeting is active, the same finalized text is also appended here as
//! a timestamped section. Structuring (decisions / action items / open
//! questions) is deliberately not done here: the frontend copies a prompt
//! built by `structuring_prompt` into whatever agent the user runs (Claude
//! Code / OpenCode), on demand rather than per chunk.
//!
//! Files live under `~/.workhub/meetings/<millis>.md` (see `storage.rs` for
//! the config dir); writes go through a temp file + rename so a crash
//! mid-write never leaves a truncated file behind (mirrors
//! `voice_history.rs`).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

use crate::storage;

/// Active meeting session id (start-time millis), if one is running.
#[derive(Default)]
pub struct MeetingState {
    active: Mutex<Option<String>>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct MeetingInfo {
    pub id: String,
    /// ISO 8601 timestamp (UTC) of when the meeting started.
    pub started: String,
    /// Number of transcript sections appended so far.
    pub entries: usize,
    /// Absolute path of the meeting's Markdown file.
    pub path: String,
}

fn meetings_dir() -> PathBuf {
    storage::config_dir().join("meetings")
}

fn meeting_file(id: &str) -> PathBuf {
    meetings_dir().join(format!("{id}.md"))
}

/// Formats a UNIX timestamp (seconds) as an ISO 8601 UTC string.
/// Mirrors `voice_history::iso8601_utc` — kept local so this module has no
/// dependency on that module.
fn iso8601_utc(epoch_secs: u64) -> String {
    let days = (epoch_secs / 86_400) as i64;
    let secs_of_day = epoch_secs % 86_400;
    let (y, m, d) = civil_from_days(days);
    let h = secs_of_day / 3600;
    let mi = (secs_of_day % 3600) / 60;
    let s = secs_of_day % 60;
    format!("{y:04}-{m:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z")
}

/// Howard Hinnant's `civil_from_days` (mirrors `voice_history.rs`).
fn civil_from_days(z: i64) -> (i32, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m, d)
}

fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn header_for(started: &str) -> String {
    format!("# Meeting {started}\n\nStarted: {started}\n\n## Transcript\n")
}

fn section_for(now: &str, text: &str) -> String {
    format!("\n### {now}\n\n{text}\n")
}

/// Reads back the info for one meeting file. Returns `None` when the file is
/// missing or does not look like a meeting file we wrote.
fn info_for(id: &str) -> Option<MeetingInfo> {
    let path = meeting_file(id);
    let content = std::fs::read_to_string(&path).ok()?;
    let mut lines = content.lines();
    let started = lines.next()?.strip_prefix("# Meeting ")?.to_string();
    if lines.next() != Some("") {
        return None;
    }
    if lines.next()? != format!("Started: {started}") {
        return None;
    }
    let entries = content.lines().filter(|l| l.starts_with("### ")).count();
    Some(MeetingInfo {
        id: id.to_string(),
        started,
        entries,
        path: path.to_string_lossy().into_owned(),
    })
}

fn write_file(path: &PathBuf, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp_path = path.with_extension("md.tmp");
    std::fs::write(&tmp_path, content).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp_path, path).map_err(|e| e.to_string())
}

/// Starts a meeting session. Idempotent: starting twice returns the running
/// meeting instead of opening a second one.
pub fn start(app: &AppHandle) -> Result<MeetingInfo, String> {
    let state = app.state::<MeetingState>();
    if let Some(id) = state.active.lock().unwrap().clone() {
        if let Some(info) = info_for(&id) {
            return Ok(info);
        }
    }
    let millis = now_millis();
    let id = millis.to_string();
    let started = iso8601_utc((millis / 1000) as u64);
    let path = meeting_file(&id);
    write_file(&path, &header_for(&started))?;
    *state.active.lock().unwrap() = Some(id.clone());
    crate::diag!("voice meeting started: {id}");
    let _ = app.emit("voice:meeting-updated", ());
    info_for(&id).ok_or_else(|| "failed to read back the new meeting".to_string())
}

/// Stops the active meeting session, if any. The file stays on disk.
pub fn finish(app: &AppHandle) -> Option<MeetingInfo> {
    let state = app.state::<MeetingState>();
    let id = state.active.lock().unwrap().take()?;
    crate::diag!("voice meeting finished: {id}");
    let _ = app.emit("voice:meeting-updated", ());
    info_for(&id)
}

/// The currently active meeting, if any.
pub fn status(app: &AppHandle) -> Option<MeetingInfo> {
    let id = app.state::<MeetingState>().active.lock().unwrap().clone()?;
    info_for(&id)
}

/// Appends one finalized transcript to the active meeting, if any. Called
/// from `voice.rs` next to the history record, so a meeting captures exactly
/// what dictation produced — including sessions whose paste failed.
pub fn append_transcript(app: &AppHandle, text: &str) {
    let Some(id) = app
        .try_state::<MeetingState>()
        .and_then(|s| s.active.lock().unwrap().clone())
    else {
        return;
    };
    let path = meeting_file(&id);
    let Ok(mut content) = std::fs::read_to_string(&path) else {
        return;
    };
    let now = iso8601_utc(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
    );
    content.push_str(&section_for(&now, text));
    if write_file(&path, &content).is_err() {
        return;
    }
    let _ = app.emit("voice:meeting-updated", ());
}

/// All meetings on disk, newest first.
pub fn list() -> Vec<MeetingInfo> {
    let dir = meetings_dir();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut ids: Vec<String> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "md"))
        .filter_map(|p| {
            p.file_stem()
                .and_then(|s| s.to_str())
                .filter(|s| s.chars().all(|c| c.is_ascii_digit()))
                .map(str::to_string)
        })
        .collect();
    // Millis ids sort the same chronologically and lexicographically.
    ids.sort();
    ids.reverse();
    ids.into_iter().filter_map(|id| info_for(&id)).collect()
}

/// Full Markdown of one meeting.
pub fn read(id: &str) -> Result<String, String> {
    std::fs::read_to_string(meeting_file(id)).map_err(|e| e.to_string())
}

/// Deletes one meeting file. Stopping an active meeting first is the
/// caller's job (`finish`); deleting the active one just strands its id,
/// which `start`/`status` already tolerate by reading back from disk.
pub fn delete(id: &str) -> Result<(), String> {
    std::fs::remove_file(meeting_file(id)).map_err(|e| e.to_string())
}

/// Builds the copy-paste prompt that turns a meeting transcript into minutes:
/// the transcript plus instructions to split out decisions, action items and
/// open questions. Run it in whatever agent is at hand (Claude Code /
/// OpenCode) — the app stays out of the LLM path.
pub fn structuring_prompt(id: &str) -> Result<String, String> {
    Ok(build_prompt(&read(id)?))
}

/// Pure half of `structuring_prompt`, so the wording is unit-testable
/// without touching the disk.
fn build_prompt(transcript: &str) -> String {
    format!(
        "Turn the meeting transcript below into minutes. Write in the same \
language as the transcript. Split the result into exactly these sections: \
## Decisions, ## Action items (each with an owner when named, else \
\"owner: TBD\"), ## Open questions. Keep each bullet to one line and skip \
any section with nothing to report (write \"(none)\" instead). Do not add \
anything not said in the transcript.\n\n--- transcript ---\n{transcript}"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn header_starts_a_transcript_section() {
        let h = header_for("2026-09-13T00:00:00Z");
        assert!(h.starts_with("# Meeting 2026-09-13T00:00:00Z\n"));
        assert!(h.contains("Started: 2026-09-13T00:00:00Z"));
        assert!(h.ends_with("## Transcript\n"));
    }

    #[test]
    fn sections_append_after_the_header() {
        let mut content = header_for("2026-09-13T00:00:00Z");
        content.push_str(&section_for("2026-09-13T00:01:00Z", "hello"));
        content.push_str(&section_for("2026-09-13T00:02:00Z", "world"));
        assert_eq!(content.lines().filter(|l| l.starts_with("### ")).count(), 2);
        assert!(content.contains("hello"));
        assert!(content.contains("world"));
    }

    #[test]
    fn structuring_prompt_carries_the_transcript_and_the_three_sections() {
        let prompt = build_prompt("notes");
        assert!(prompt.contains("notes"));
        assert!(prompt.contains("## Decisions"));
        assert!(prompt.contains("## Action items"));
        assert!(prompt.contains("## Open questions"));
    }

    #[test]
    fn iso8601_utc_formats_known_epoch() {
        assert_eq!(iso8601_utc(1_784_332_800), "2026-07-18T00:00:00Z");
    }

    #[test]
    fn meeting_file_lives_under_the_meetings_dir() {
        assert_eq!(meeting_file("123").file_name().unwrap(), "123.md");
        assert!(meeting_file("123").parent().unwrap().ends_with("meetings"));
    }
}
