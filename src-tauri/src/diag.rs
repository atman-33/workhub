//! Diagnostic log — the one place a release build records what happened.
//!
//! `main.rs` carries `#![cfg_attr(not(debug_assertions), windows_subsystem =
//! "windows")]`, so a packaged build has no console and every `eprintln!` it
//! makes is written to a handle nobody can read. That made a bug report from
//! the only build users actually run ("the voice indicator appeared in the
//! wrong place") impossible to investigate after the fact: probes like the
//! caret position, the raw-input state or the foreground window read *another
//! process's* state at that instant, and re-running them later in a dev build
//! does not reproduce the moment.
//!
//! Every diagnostic therefore goes through [`diag!`], which fans one line out
//! to three places at once:
//!
//! 1. **stderr**, unchanged — a dev build keeps the console output it had.
//! 2. **An in-memory ring** of the most recent [`RING_CAPACITY`] lines, shown
//!    in Settings (`diagnostic-log-panel.tsx`) so a user can read and copy the
//!    log without leaving the app — the same idea as the input-listener panel.
//! 3. **`~/.workhub/logs/workhub.log`**, so the record survives the crash or
//!    the restart that follows the problem.
//!
//! ## What must never be logged
//!
//! The log is written unencrypted and users are asked to paste it into bug
//! reports, so it holds *what the app did*, never *what the user said or
//! wrote*: no transcript text, no clipboard contents, no note or task bodies,
//! no file contents. Durations, sizes, counts, error messages and window
//! geometry are fine. Paths are borderline — log them only where the path is
//! the thing that failed.
//!
//! ## Size
//!
//! The file is capped by rotation rather than by a retention setting: at
//! [`MAX_BYTES`] it is renamed to `workhub.log.1` (replacing the previous
//! one) and a fresh file starts, so the two generations together never exceed
//! ~2 MiB no matter how long the app runs.

use std::collections::VecDeque;
use std::fmt::Arguments;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use serde::Serialize;

/// Lines kept in memory for the in-app panel. Enough to cover a session's
/// worth of startup and gesture activity without holding a meaningful amount
/// of memory (a line is well under 200 bytes).
const RING_CAPACITY: usize = 500;

/// Rotate at 1 MiB, keeping one previous generation.
const MAX_BYTES: u64 = 1024 * 1024;

/// One recorded line, as the Settings panel receives it.
#[derive(Clone, Serialize)]
pub struct DiagEntry {
    /// Local wall-clock time, `HH:MM:SS.mmm` — the same stamp the file uses,
    /// minus the date, which the panel does not have room for.
    pub time: String,
    pub message: String,
}

/// Where the log file lives, and how big it currently is.
#[derive(Serialize)]
pub struct DiagLogInfo {
    pub path: String,
    pub dir: String,
    pub bytes: u64,
    /// Lines currently held in memory (what `entries` can return).
    pub buffered: usize,
}

fn ring() -> &'static Mutex<VecDeque<DiagEntry>> {
    static RING: OnceLock<Mutex<VecDeque<DiagEntry>>> = OnceLock::new();
    RING.get_or_init(|| Mutex::new(VecDeque::with_capacity(RING_CAPACITY)))
}

/// Serializes file writes across threads. Consumers call [`diag!`] from the
/// raw-input listener thread and Tauri's async runtime as well as the main
/// thread, and an interleaved half-line would be worse than no line at all.
fn file_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

pub fn log_dir() -> PathBuf {
    crate::storage::config_dir().join("logs")
}

pub fn log_path() -> PathBuf {
    log_dir().join("workhub.log")
}

fn rotated_path() -> PathBuf {
    log_dir().join("workhub.log.1")
}

/// Records one diagnostic line. Called through [`diag!`] rather than
/// directly, so call sites keep reading like the `eprintln!` they replaced.
pub fn record(args: Arguments) {
    let message = std::fmt::format(args);
    // Keep the dev console behaving exactly as before.
    eprintln!("{message}");

    let (date, time) = local_stamp();
    if let Ok(mut ring) = ring().lock() {
        if ring.len() == RING_CAPACITY {
            ring.pop_front();
        }
        ring.push_back(DiagEntry {
            time: time.clone(),
            message: message.clone(),
        });
    }
    append_to_file(&format!("{date} {time} {message}\n"));
}

/// Appends to the log file, rotating first when the file has grown past
/// [`MAX_BYTES`]. Every failure here is swallowed: a diagnostic that cannot
/// be written must not take down the operation it was describing, and there
/// is by definition nowhere better to report it.
fn append_to_file(line: &str) {
    let Ok(_guard) = file_lock().lock() else {
        return;
    };
    let path = log_path();
    if std::fs::create_dir_all(log_dir()).is_err() {
        return;
    }
    if std::fs::metadata(&path).is_ok_and(|m| m.len() >= MAX_BYTES) {
        let _ = std::fs::remove_file(rotated_path());
        let _ = std::fs::rename(&path, rotated_path());
    }
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = file.write_all(line.as_bytes());
    }
}

/// The most recent lines, oldest first. `limit` caps how many are returned
/// (from the newest end); `None` returns everything buffered.
pub fn entries(limit: Option<usize>) -> Vec<DiagEntry> {
    let Ok(ring) = ring().lock() else {
        return Vec::new();
    };
    tail(&ring, limit)
}

/// The newest `limit` items of `items`, still oldest-first. Split out from
/// [`entries`] so it can be tested without the process-global ring, which
/// other tests log into concurrently.
fn tail<T: Clone>(items: &VecDeque<T>, limit: Option<usize>) -> Vec<T> {
    let skip = match limit {
        Some(n) => items.len().saturating_sub(n),
        None => 0,
    };
    items.iter().skip(skip).cloned().collect()
}

pub fn info() -> DiagLogInfo {
    DiagLogInfo {
        path: log_path().display().to_string(),
        dir: log_dir().display().to_string(),
        bytes: std::fs::metadata(log_path()).map(|m| m.len()).unwrap_or(0),
        buffered: ring().lock().map(|r| r.len()).unwrap_or(0),
    }
}

/// Starts the log for this run: writes a banner identifying the build (so a
/// pasted log says which version produced it) and installs a panic hook.
///
/// The panic hook is the reason this is worth doing at startup rather than
/// lazily. A panic in a release build previously printed to the console that
/// does not exist and then vanished; a background thread panicking that way
/// (the raw-input listener, the vault watcher, an stt worker) leaves the
/// feature silently dead with nothing to go on.
pub fn init() {
    crate::diag!(
        "workhub {} starting ({}, {})",
        crate::update::current_version(),
        std::env::consts::OS,
        if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        }
    );
    crate::diag!("diag: log file is {}", log_path().display());

    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| "unknown location".into());
        let thread = std::thread::current();
        let name = thread.name().unwrap_or("unnamed").to_string();
        crate::diag!("panic: at {location} on thread '{name}': {info}");
        previous(info);
    }));
}

/// `(YYYY-MM-DD, HH:MM:SS.mmm)` in local time.
///
/// Local rather than UTC because the user reading the log compares it against
/// when they saw the problem. Windows answers this directly; elsewhere we
/// derive UTC from the epoch rather than add a date crate for a target this
/// app does not ship to.
#[cfg(windows)]
fn local_stamp() -> (String, String) {
    // SAFETY: GetLocalTime reads the clock and returns by value; it takes no
    // pointer from us and cannot fail.
    let st = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    (
        format!("{:04}-{:02}-{:02}", st.wYear, st.wMonth, st.wDay),
        format!(
            "{:02}:{:02}:{:02}.{:03}",
            st.wHour, st.wMinute, st.wSecond, st.wMilliseconds
        ),
    )
}

#[cfg(not(windows))]
fn local_stamp() -> (String, String) {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let (date, time) = civil_from_unix(now.as_secs());
    (date, format!("{time}.{:03}", now.subsec_millis()))
}

/// Epoch seconds → `(YYYY-MM-DD, HH:MM:SS)` in UTC, by Howard Hinnant's
/// civil-from-days algorithm. Only the non-Windows fallback uses it.
#[cfg(not(windows))]
fn civil_from_unix(secs: u64) -> (String, String) {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (
        format!("{y:04}-{m:02}-{d:02}"),
        format!("{:02}:{:02}:{:02}", rem / 3600, (rem % 3600) / 60, rem % 60),
    )
}

/// Records one diagnostic line. Same shape as `eprintln!`, which is what it
/// replaced across the crate — see the module docs for where the line goes
/// and for what must never be put in one.
#[macro_export]
macro_rules! diag {
    ($($arg:tt)*) => {
        $crate::diag::record(::std::format_args!($($arg)*))
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tail_returns_the_newest_items_oldest_first() {
        let items: VecDeque<u32> = (0..5).collect();
        assert_eq!(tail(&items, Some(3)), vec![2, 3, 4]);
        assert_eq!(tail(&items, Some(99)), vec![0, 1, 2, 3, 4]);
        assert_eq!(tail(&items, None), vec![0, 1, 2, 3, 4]);
        assert!(tail(&items, Some(0)).is_empty());
    }

    #[test]
    fn recorded_lines_reach_the_ring_in_order() {
        // The ring is process-global and other tests log into it, so match on
        // this test's own prefix rather than on absolute positions.
        for i in 0..5 {
            crate::diag!("diag-test-order: line {i}");
        }
        let mine: Vec<String> = entries(None)
            .into_iter()
            .filter(|e| e.message.starts_with("diag-test-order:"))
            .map(|e| e.message)
            .collect();
        assert_eq!(mine.len(), 5);
        assert!(mine[0].ends_with("line 0"));
        assert!(mine[4].ends_with("line 4"));
    }

    #[test]
    fn stamp_is_fixed_width() {
        let (date, time) = local_stamp();
        assert_eq!(date.len(), 10, "date was {date}");
        assert_eq!(time.len(), 12, "time was {time}");
    }
}
