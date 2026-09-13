//! Periodic meeting-transcript structuring (T-0318, B-021 Phase 3).
//!
//! While a meeting is active, a background scheduler sends transcript
//! sections the last run has not seen yet to a headless agent
//! (`actions::tidy_agent_argv`, same argv builder the tidy routine uses) and
//! writes the returned minutes to `<meetings>/<id>.minutes.md`. Runs are
//! spaced `meeting_struct_interval_secs` apart (0 disables the periodic run;
//! the manual minutes prompt always works), never overlap, and only fire when
//! new transcript sections exist — so an idle meeting costs zero tokens. A
//! failed run records its error for the panel and is retried on the next
//! tick; it never stops the meeting or the capture session.
//!
//! The agent gets a self-contained prompt on stdin (previous minutes, if any,
//! plus the new sections) and the app writes its parsed output to the minutes
//! file itself — the agent never touches the disk. Speaker separation does
//! not exist in this pipeline, so the prompt forbids guessing owners
//! (unnamed → `owner: TBD`) and the file header says so.

use crate::actions;
use crate::storage;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// How often the scheduler wakes to check for a due run.
const TICK_SECS: u64 = 30;
/// Frontend event emitted whenever struct state changes.
const STATUS_EVENT: &str = "voice:struct-updated";

/// Live state of the structuring runner, managed by Tauri.
#[derive(Default)]
pub struct StructState {
    inner: Mutex<StructRun>,
}

#[derive(Default)]
struct StructRun {
    running: bool,
    /// Unix seconds the current (or last) run started.
    last_start: Option<u64>,
    /// Transcript entries covered by the last successful run.
    structured_entries: usize,
    /// New entries the current (or last) run took on.
    last_new_entries: usize,
    /// Unix seconds the last run succeeded.
    last_ok_at: Option<u64>,
    /// Error message from the last failed run (cleared on the next start).
    last_error: Option<String>,
}

/// What the Voice tab shows about periodic structuring. `None` (via the
/// command) when no meeting is active.
#[derive(Clone, serde::Serialize)]
pub struct StructStatus {
    pub running: bool,
    pub interval_secs: u64,
    pub structured_entries: usize,
    pub last_new_entries: usize,
    pub last_ok_at: Option<u64>,
    pub last_error: Option<String>,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|s| s.as_secs())
        .unwrap_or(0)
}

/// Starts the background scheduler thread. Sleeps first, so starting a
/// meeting never fires a run instantly at app launch.
pub fn start_scheduler(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(TICK_SECS));
        tick(&app);
    });
}

fn tick(app: &AppHandle) {
    let settings = storage::load().settings;
    if settings.meeting_struct_interval_secs == 0 {
        return;
    }
    let Some(info) = crate::voice_meeting::status(app) else {
        return;
    };
    let state = app.state::<StructState>();
    let run = state.inner.lock().unwrap();
    if run.running {
        return; // Don't stack runs.
    }
    let due = run
        .last_start
        .map(|t| now().saturating_sub(t) >= settings.meeting_struct_interval_secs)
        .unwrap_or(true);
    if !due || info.entries <= run.structured_entries {
        return; // Too soon, or nothing new — zero tokens either way.
    }
    let covered = run.structured_entries;
    drop(run);
    spawn_run(
        app.clone(),
        &info.id,
        &info.started,
        info.entries,
        covered,
        &settings.meeting_struct_assignee,
        &settings.meeting_struct_model,
    );
}

/// Manual "Structure now". Works regardless of the interval (but not when it
/// is 0/off), and reports when there is nothing new to cover.
pub fn run_now(app: AppHandle) -> Result<String, String> {
    let settings = storage::load().settings;
    if settings.meeting_struct_interval_secs == 0 {
        return Err("periodic structuring is off (interval 0)".into());
    }
    let info = crate::voice_meeting::status(&app).ok_or("no meeting is active")?;
    {
        let state = app.state::<StructState>();
        if state.inner.lock().unwrap().running {
            return Err("a structuring run is already in progress".into());
        }
    }
    let covered = app
        .state::<StructState>()
        .inner
        .lock()
        .unwrap()
        .structured_entries;
    if info.entries <= covered && minutes_file(&info.id).is_file() {
        return Ok("Nothing new to structure.".into());
    }
    spawn_run(
        app,
        &info.id,
        &info.started,
        info.entries,
        covered,
        &settings.meeting_struct_assignee,
        &settings.meeting_struct_model,
    );
    Ok("Structuring started.".into())
}

/// Current structuring status, or `None` when no meeting is active.
pub fn status(app: &AppHandle) -> Option<StructStatus> {
    crate::voice_meeting::status(app)?;
    let settings = storage::load().settings;
    let state = app.state::<StructState>();
    let run = state.inner.lock().unwrap();
    Some(StructStatus {
        running: run.running,
        interval_secs: settings.meeting_struct_interval_secs,
        structured_entries: run.structured_entries,
        last_new_entries: run.last_new_entries,
        last_ok_at: run.last_ok_at,
        last_error: run.last_error.clone(),
    })
}

/// Full Markdown of one meeting's structured minutes, or empty when no run
/// has produced any yet.
pub fn read_minutes(id: &str) -> String {
    std::fs::read_to_string(minutes_file(id)).unwrap_or_default()
}

pub(crate) fn minutes_file(id: &str) -> PathBuf {
    crate::voice_meeting::meetings_dir().join(format!("{id}.minutes.md"))
}

/// Per-meeting struct run log (`<meetings>/<id>.struct.log`): one timestamped
/// line per run start/finish, so a stuck or failing run can be told apart
/// from a quiet one without digging through the diagnostic log (T-0333).
/// The agent never touches this file — the app appends to it.
pub(crate) fn struct_log_file(id: &str) -> PathBuf {
    crate::voice_meeting::meetings_dir().join(format!("{id}.struct.log"))
}

/// Full text of one meeting's struct run log, or empty when no run has
/// logged anything yet.
pub fn read_struct_log(id: &str) -> String {
    std::fs::read_to_string(struct_log_file(id)).unwrap_or_default()
}

/// Appends one timestamped line to the meeting's struct run log.
/// Best-effort: a log that cannot be written must never fail the run it
/// describes.
fn append_struct_log(meeting_id: &str, line: &str) {
    use std::io::Write;
    let path = struct_log_file(meeting_id);
    let mut file = match std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        Ok(f) => f,
        Err(e) => {
            crate::diag!("voice struct: cannot open run log: {e}");
            return;
        }
    };
    if let Err(e) = writeln!(file, "[{}] {line}", now()) {
        crate::diag!("voice struct: cannot write run log: {e}");
    }
}

#[allow(clippy::too_many_arguments)]
fn spawn_run(
    app: AppHandle,
    meeting_id: &str,
    meeting_started: &str,
    entries: usize,
    covered: usize,
    assignee: &str,
    model: &str,
) {
    let transcript = match crate::voice_meeting::read(meeting_id) {
        Ok(t) => t,
        Err(e) => {
            let msg = format!("cannot read transcript: {e}");
            crate::diag!("voice struct: {msg}");
            append_struct_log(meeting_id, &format!("fail: {msg}"));
            fail_run(&app, msg);
            return;
        }
    };
    let new_text = new_sections_since(&transcript, covered);
    let previous = std::fs::read_to_string(minutes_file(meeting_id)).ok();
    let previous_body = previous.as_deref().and_then(strip_minutes_header);
    let prompt = build_struct_prompt(previous_body, &new_text);
    let cfg = storage::load();
    let argv = actions::tidy_agent_argv(
        assignee,
        &cfg.settings.agent_cmd,
        &cfg.settings.opencode_cmd,
        model,
        "",
    );
    if argv.first().map(|s| s.is_empty()).unwrap_or(true) {
        let msg = "could not resolve the agent command".to_string();
        crate::diag!("voice struct: {msg}");
        append_struct_log(meeting_id, &format!("fail: {msg}"));
        fail_run(&app, msg);
        return;
    }
    // Said out loud before spending: what this run is about to consume.
    let new_count = entries.saturating_sub(covered);
    crate::diag!(
        "voice struct: run for meeting {meeting_id} ({new_count} new entries, model={model})"
    );
    append_struct_log(
        meeting_id,
        &format!("start: {new_count} new entries, model={model}"),
    );

    let mut command = build_command(&argv);
    command.current_dir(storage::config_dir());
    command.stdin(Stdio::piped());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = match command.spawn() {
        Ok(c) => c,
        Err(e) => {
            crate::diag!("voice struct: spawn failed: {e}");
            append_struct_log(meeting_id, &format!("fail: spawn failed: {e}"));
            fail_run(&app, e.to_string());
            return;
        }
    };
    if let Some(mut stdin) = child.stdin.take() {
        use std::io::Write;
        let _ = stdin.write_all(prompt.as_bytes());
    }

    {
        let state = app.state::<StructState>();
        let mut run = state.inner.lock().unwrap();
        run.running = true;
        run.last_start = Some(now());
        run.last_new_entries = new_count;
        run.last_error = None;
    }
    emit_status(&app);

    let wait_app = app.clone();
    let meeting_id = meeting_id.to_string();
    let meeting_started = meeting_started.to_string();
    let interval = storage::load().settings.meeting_struct_interval_secs;
    std::thread::spawn(move || {
        let result = child.wait_with_output();
        finish_run(
            &wait_app,
            &meeting_id,
            &meeting_started,
            entries,
            interval,
            result,
        );
    });
}

fn fail_run(app: &AppHandle, error: String) {
    let state = app.state::<StructState>();
    {
        let mut run = state.inner.lock().unwrap();
        run.running = false;
        run.last_error = Some(error);
    }
    emit_status(app);
}

fn finish_run(
    app: &AppHandle,
    meeting_id: &str,
    meeting_started: &str,
    entries: usize,
    interval: u64,
    result: std::io::Result<std::process::Output>,
) {
    let state = app.state::<StructState>();
    // If a newer run replaced this one, don't clobber it.
    {
        if !state.inner.lock().unwrap().running {
            return;
        }
    }
    match result {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            match (out.status.success(), parse_struct_result(&stdout)) {
                (true, Some(body)) => {
                    let content =
                        header_for_minutes(meeting_started, interval) + body.trim() + "\n";
                    if let Err(e) = std::fs::write(minutes_file(meeting_id), content) {
                        crate::diag!("voice struct: cannot write minutes: {e}");
                        append_struct_log(meeting_id, &format!("fail: cannot write minutes: {e}"));
                        fail_run(app, e.to_string());
                        return;
                    }
                    append_struct_log(meeting_id, &format!("ok: covered {entries} entries"));
                    let mut run = state.inner.lock().unwrap();
                    run.running = false;
                    run.structured_entries = entries;
                    run.last_ok_at = Some(now());
                    run.last_error = None;
                }
                (true, None) => {
                    crate::diag!("voice struct: agent returned no usable output");
                    append_struct_log(meeting_id, "fail: agent returned no usable output");
                    fail_run(app, "the agent returned no usable output".into());
                    return;
                }
                (false, _) => {
                    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                    let msg = stderr.trim().lines().last().unwrap_or("").to_string();
                    let msg = if msg.is_empty() {
                        "the structuring agent exited with an error".to_string()
                    } else {
                        msg
                    };
                    append_struct_log(meeting_id, &format!("fail: {msg}"));
                    fail_run(app, msg);
                    return;
                }
            }
        }
        Err(e) => {
            append_struct_log(meeting_id, &format!("fail: could not wait on agent: {e}"));
            fail_run(app, e.to_string());
            return;
        }
    }
    emit_status(app);
}

fn emit_status(app: &AppHandle) {
    let _ = app.emit(STATUS_EVENT, ());
}

/// Builds the child command. On Windows the agent CLIs are `.cmd` shims that
/// `std::process::Command` cannot spawn directly, so route through `cmd /C`
/// (same reason `actions::launch` does). The long prompt is not an argument
/// (it goes on stdin), so only flag tokens — none with spaces — pass through.
#[cfg(windows)]
fn build_command(argv: &[String]) -> Command {
    let mut c = Command::new("cmd");
    c.arg("/C");
    for a in argv {
        c.arg(a);
    }
    c
}

#[cfg(not(windows))]
fn build_command(argv: &[String]) -> Command {
    let mut c = Command::new(&argv[0]);
    for a in &argv[1..] {
        c.arg(a);
    }
    c
}

/// Self-contained prompt for one structuring run: the previous minutes (when
/// this is an update, not the first run) plus the transcript sections no run
/// has seen yet. Pure so the wording is unit-testable.
fn build_struct_prompt(previous: Option<&str>, new_transcript: &str) -> String {
    let base = "Turn the meeting transcript below into minutes. Write in the \
        same language as the transcript. Split the result into exactly these \
        sections: ## Decisions, ## Action items (each with an owner when \
        named, else \"owner: TBD\"), ## Open questions. Keep each bullet to \
        one line and skip any section with nothing to report (write \"(none)\" \
        instead). Do not add anything not said in the transcript. There is no \
        speaker separation in this transcript: never guess who said what, and \
        never invent an owner — an owner not named in the text stays \
        \"owner: TBD\".";
    match previous {
        Some(minutes) => format!(
            "{base} These minutes already exist from earlier in the same \
            meeting — update them with the new transcript below (merge, do \
            not restart from scratch), keeping the same sections and rules.\n\
            \n--- existing minutes ---\n{minutes}\n\n--- new transcript ---\n{new_transcript}"
        ),
        None => format!("{base}\n\n--- transcript ---\n{new_transcript}"),
    }
}

/// Transcript sections no run has covered yet: drops the first `skip`
/// `### `-headed sections (plus the file header before the first one) and
/// keeps the rest. Pure so it is unit-testable.
fn new_sections_since(full_md: &str, skip: usize) -> String {
    let mut out = String::new();
    let mut seen = 0usize;
    for line in full_md.lines() {
        if line.starts_with("### ") {
            seen += 1;
        }
        if seen > skip {
            out.push_str(line);
            out.push('\n');
        }
    }
    out
}

/// Minutes-file header, written by the app (never the agent) so the
/// no-speaker-separation caveat is always on the record.
fn header_for_minutes(meeting_started: &str, interval: u64) -> String {
    format!(
        "# Minutes (auto) — {meeting_started}\n\n\
        > Auto-structured about every {interval}s. There is no speaker \
        separation: owners not named in the transcript are \"owner: TBD\".\n\n"
    )
}

/// Drops the app-written header from previously generated minutes, leaving
/// the body the next prompt merges into.
fn strip_minutes_header(minutes: &str) -> Option<&str> {
    minutes.find("## Decisions").map(|i| minutes[i..].trim())
}

/// Reads a headless agent's stdout: a claude `--output-format json` object
/// carries the text in `result`; anything else (opencode's plain print) is
/// taken whole. `None` when there is nothing usable.
fn parse_struct_result(stdout: &str) -> Option<String> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if v.is_object() {
            return v
                .get("result")
                .and_then(|x| x.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string);
        }
    }
    Some(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn struct_prompt_carries_both_halves_and_the_tbd_rule() {
        let prompt = build_struct_prompt(Some("old minutes"), "fresh talk");
        assert!(prompt.contains("old minutes"));
        assert!(prompt.contains("fresh talk"));
        assert!(prompt.contains("owner: TBD"));
        assert!(prompt.contains("never guess"));
        assert!(prompt.contains("## Decisions"));
        assert!(prompt.contains("## Action items"));
        assert!(prompt.contains("## Open questions"));
    }

    #[test]
    fn struct_prompt_without_previous_is_transcript_only() {
        let prompt = build_struct_prompt(None, "fresh talk");
        assert!(prompt.contains("fresh talk"));
        assert!(!prompt.contains("existing minutes"));
    }

    #[test]
    fn new_sections_since_skips_covered_utterances() {
        let md = "# Meeting T\n\nStarted: T\n\n## Transcript\n\n### 1\n\nhello\n\n### 2\n\nworld\n";
        assert!(new_sections_since(md, 0).contains("hello"));
        assert!(new_sections_since(md, 0).contains("world"));
        let rest = new_sections_since(md, 1);
        assert!(!rest.contains("hello"));
        assert!(rest.contains("world"));
        assert!(new_sections_since(md, 9).trim().is_empty());
    }

    #[test]
    fn minutes_header_carries_the_caveat() {
        let h = header_for_minutes("2026-09-13T00:00:00Z", 120);
        assert!(h.contains("2026-09-13T00:00:00Z"));
        assert!(h.contains("owner: TBD"));
    }

    #[test]
    fn strip_minutes_header_keeps_the_body() {
        let md = "# Minutes (auto) — T\n\n> caveat\n\n## Decisions\n\n- x\n";
        assert_eq!(strip_minutes_header(md), Some("## Decisions\n\n- x"));
        assert_eq!(strip_minutes_header("no sections here"), None);
    }

    #[test]
    fn parse_struct_result_reads_claude_json() {
        let out = "{\"result\":\"## Decisions\\n\\n- x\",\"session_id\":\"abc\"}";
        assert_eq!(parse_struct_result(out), Some("## Decisions\n\n- x".into()));
    }

    #[test]
    fn parse_struct_result_takes_plain_output_whole() {
        let out = "## Decisions\n\n- x\n\n## Action items\n\n(none)\n";
        assert_eq!(parse_struct_result(out), Some(out.trim().into()));
    }

    #[test]
    fn parse_struct_result_rejects_empty_output() {
        assert_eq!(parse_struct_result("  \n "), None);
        assert_eq!(parse_struct_result("{\"result\":\"  \"}"), None);
    }
}
