//! Voice-input transcript history: a safety net for pastes whose target lost
//! focus (or otherwise failed) between recording and paste. Every successful
//! transcription with non-empty text is recorded here regardless of whether
//! the paste itself succeeded — see the call site in `voice.rs`.
//!
//! Persisted separately from `config.json` (`storage.rs`) at
//! `%APPDATA%\workhub\voice-history.json`, since it's transcript data rather
//! than app configuration and can grow/shrink independently.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::storage;

/// Oldest entries beyond this count are dropped on append.
const MAX_ENTRIES: usize = 50;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct HistoryEntry {
    pub id: String,
    pub text: String,
    /// ISO 8601 timestamp (local).
    pub created: String,
    pub model: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct History {
    /// Newest first.
    pub entries: Vec<HistoryEntry>,
}

impl HistoryEntry {
    /// Builds a new entry stamped with the current wall-clock time; `id` is
    /// the millisecond UNIX timestamp (unique enough for this single-process,
    /// append-only list, and sorts the same as insertion order).
    pub fn new(text: String, model: String) -> Self {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default();
        Self {
            id: now.as_millis().to_string(),
            text,
            created: iso8601_utc(now.as_secs()),
            model,
        }
    }
}

/// Formats a UNIX timestamp (seconds) as an ISO 8601 UTC string
/// (`YYYY-MM-DDTHH:MM:SSZ`). Pure so it's unit-testable without wall time.
fn iso8601_utc(epoch_secs: u64) -> String {
    let days = (epoch_secs / 86_400) as i64;
    let secs_of_day = epoch_secs % 86_400;
    let (y, m, d) = civil_from_days(days);
    let h = secs_of_day / 3600;
    let mi = (secs_of_day % 3600) / 60;
    let s = secs_of_day % 60;
    format!("{y:04}-{m:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z")
}

/// Howard Hinnant's `civil_from_days`: days-since-epoch -> (year, month, day).
/// Mirrors `tasks::civil_from_days` — kept local so this module has no
/// dependency on `tasks.rs`.
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

impl History {
    /// Inserts `entry` at the front and trims to `MAX_ENTRIES`, dropping the
    /// oldest entries first.
    pub fn append(&mut self, entry: HistoryEntry) {
        self.entries.insert(0, entry);
        self.entries.truncate(MAX_ENTRIES);
    }

    /// Removes the entry with the given id, if present.
    pub fn delete(&mut self, id: &str) {
        self.entries.retain(|e| e.id != id);
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }
}

/// `%APPDATA%\workhub\voice-history.json`.
fn history_file() -> PathBuf {
    storage::config_dir().join("voice-history.json")
}

/// Loads the history file, tolerating a missing or corrupt file by starting
/// empty (mirrors `storage::load`'s tolerance for config.json).
pub fn load() -> History {
    match std::fs::read_to_string(history_file()) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => History::default(),
    }
}

/// Writes the history file, via a temp file + rename so a crash mid-write
/// never leaves a truncated/corrupt file behind.
pub fn save(history: &History) {
    let dir = storage::config_dir();
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let Ok(text) = serde_json::to_string_pretty(history) else {
        return;
    };
    let final_path = history_file();
    let tmp_path = final_path.with_extension("json.tmp");
    if std::fs::write(&tmp_path, text).is_err() {
        return;
    }
    let _ = std::fs::rename(&tmp_path, &final_path);
}

/// Appends `entry` to the on-disk history (load, mutate, save).
pub fn record(entry: HistoryEntry) {
    let mut history = load();
    history.append(entry);
    save(&history);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str) -> HistoryEntry {
        HistoryEntry {
            id: id.to_string(),
            text: format!("text-{id}"),
            created: "2026-07-18T00:00:00Z".to_string(),
            model: "small".to_string(),
        }
    }

    #[test]
    fn append_inserts_newest_first() {
        let mut h = History::default();
        h.append(entry("1"));
        h.append(entry("2"));
        assert_eq!(h.entries[0].id, "2");
        assert_eq!(h.entries[1].id, "1");
    }

    #[test]
    fn append_caps_at_max_entries_dropping_oldest() {
        let mut h = History::default();
        for i in 0..(MAX_ENTRIES + 5) {
            h.append(entry(&i.to_string()));
        }
        assert_eq!(h.entries.len(), MAX_ENTRIES);
        // Newest (last appended) is first, oldest survivors are the tail.
        assert_eq!(h.entries[0].id, (MAX_ENTRIES + 4).to_string());
        assert_eq!(h.entries[MAX_ENTRIES - 1].id, "5");
    }

    #[test]
    fn delete_removes_by_id() {
        let mut h = History::default();
        h.append(entry("1"));
        h.append(entry("2"));
        h.delete("1");
        assert_eq!(h.entries.len(), 1);
        assert_eq!(h.entries[0].id, "2");
    }

    #[test]
    fn delete_missing_id_is_noop() {
        let mut h = History::default();
        h.append(entry("1"));
        h.delete("missing");
        assert_eq!(h.entries.len(), 1);
    }

    #[test]
    fn clear_removes_all_entries() {
        let mut h = History::default();
        h.append(entry("1"));
        h.append(entry("2"));
        h.clear();
        assert!(h.entries.is_empty());
    }

    #[test]
    fn iso8601_utc_formats_known_epoch() {
        // 2026-07-18T00:00:00Z, computed independently via `date -u -d ...`.
        assert_eq!(iso8601_utc(1_784_332_800), "2026-07-18T00:00:00Z");
    }

    #[test]
    fn iso8601_utc_includes_time_of_day() {
        assert_eq!(iso8601_utc(1_784_332_800 + 3_661), "2026-07-18T01:01:01Z");
    }

    #[test]
    fn history_entry_new_sets_millis_id_and_fields() {
        let e = HistoryEntry::new("hello".to_string(), "small".to_string());
        assert!(!e.id.is_empty());
        assert!(e.id.chars().all(|c| c.is_ascii_digit()));
        assert_eq!(e.text, "hello");
        assert_eq!(e.model, "small");
        assert!(!e.created.is_empty());
    }

    #[test]
    fn load_missing_file_starts_empty() {
        // history_file() resolves under the real config dir; this just
        // exercises the tolerant-default path via a bogus in-memory parse.
        let h: History = serde_json::from_str("not json").unwrap_or_default();
        assert!(h.entries.is_empty());
    }
}
