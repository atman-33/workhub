//! Built-in vault-tidy routine (T-0050).
//!
//! A background scheduler periodically decides — with a **cheap mechanical
//! scan, no agent/tokens** — whether the vault has housekeeping to do (stale
//! inbox notes, or a drifted `tasks/archive/_index.md`). Only when there is
//! work does it launch a headless agent to run the `kb-ingest --unattended` and
//! `kb-index` skills. The run is tracked so the UI can show progress, a stall,
//! or a failure, and offer to resume the session interactively.
//!
//! Scheduling is anchor + interval (not cron): a desktop app isn't guaranteed
//! to be open at a wall-clock time, so we phase slots from `anchor` and catch
//! up the one missed slot on the next launch instead of losing fires.

use crate::actions;
use crate::models::{Config, TidySettings};
use crate::storage;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// How often the scheduler wakes to check for a due slot.
const TICK_SECS: u64 = 30 * 60;
/// A run still going after this long is flagged as possibly stalled.
const STALL_SECS: u64 = 15 * 60;
const STATUS_EVENT: &str = "tidy:status";

/// Live state of the tidy runner, managed by Tauri. Serialized to the UI (and
/// emitted on `tidy:status`) so the settings panel can reflect progress.
pub struct TidyState(pub Mutex<TidyRun>);

impl Default for TidyState {
    fn default() -> Self {
        TidyState(Mutex::new(TidyRun::idle()))
    }
}

#[derive(Clone, serde::Serialize)]
pub struct TidyRun {
    /// "idle" | "running" | "completed" | "failed"
    pub state: String,
    /// Unix seconds the current run started (state == "running").
    pub since: Option<u64>,
    /// Unix seconds the last run finished (completed/failed).
    pub at: Option<u64>,
    /// Result summary text from the last completed run.
    pub summary: Option<String>,
    /// Error message from the last failed run.
    pub error: Option<String>,
    /// Agent session id captured from the run, for interactive resume.
    pub session_id: Option<String>,
    /// True while a "running" run has exceeded the stall threshold.
    pub stalled: bool,
    /// OS pid of the running child (not serialized; used for guarding).
    #[serde(skip)]
    pub child_id: Option<u32>,
}

impl TidyRun {
    fn idle() -> Self {
        TidyRun {
            state: "idle".into(),
            since: None,
            at: None,
            summary: None,
            error: None,
            session_id: None,
            stalled: false,
            child_id: None,
        }
    }
    fn is_running(&self) -> bool {
        self.state == "running"
    }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn emit_status(app: &AppHandle) {
    if let Some(run) = app.try_state::<TidyState>() {
        let snapshot = run.0.lock().unwrap().clone();
        let _ = app.emit(STATUS_EVENT, snapshot);
    }
}

/// Current run snapshot for the `tidy_status` command.
pub fn snapshot(app: &AppHandle) -> TidyRun {
    let st = app.state::<TidyState>();
    let mut run = st.0.lock().unwrap();
    // Derive the stall flag lazily so the UI sees it even without an event.
    if run.is_running() {
        if let Some(since) = run.since {
            run.stalled = now().saturating_sub(since) >= STALL_SECS;
        }
    }
    run.clone()
}

// ---------------------------------------------------------------------------
// Mechanical pre-check (no agent, no tokens)
// ---------------------------------------------------------------------------

/// Whether the vault has any tidy work: a stale inbox note, or archive-index
/// drift. This is the token-saving gate — the agent only launches when true.
pub fn has_work(vault: &Path, s: &TidySettings) -> bool {
    has_stale_inbox(vault, s.stale_days, &s.exclude_dirs) || archive_index_drift(vault)
}

/// Inbox files a previous unattended run deferred for human review. The
/// kb-ingest skill records them in `_ai/memory/tidy-pending.json`; such a file
/// is not "work" — relaunching the agent would just re-defer it — unless the
/// user edited it after the deferral (file mtime newer than the list's mtime).
struct Pending {
    paths: std::collections::HashSet<PathBuf>,
    /// mtime of tidy-pending.json itself = when the entries were last written.
    mtime: u64,
}

impl Pending {
    fn shields(&self, path: &Path, file_mtime: u64) -> bool {
        file_mtime <= self.mtime && self.paths.contains(path)
    }
}

fn load_pending(vault: &Path) -> Pending {
    let file = vault.join("_ai").join("memory").join("tidy-pending.json");
    let mut paths = std::collections::HashSet::new();
    let mut mtime = 0;
    if let Ok(text) = fs::read_to_string(&file) {
        mtime = mtime_secs(&file);
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
            for entry in v
                .get("files")
                .and_then(|f| f.as_array())
                .into_iter()
                .flatten()
            {
                if let Some(p) = entry.get("path").and_then(|x| x.as_str()) {
                    // Vault-relative, forward slashes; join() normalizes.
                    paths.insert(vault.join(p));
                }
            }
        }
    }
    Pending { paths, mtime }
}

fn mtime_secs(p: &Path) -> u64 {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        // Unreadable mtime → treat as "fresh" so we never tidy on bad data.
        .unwrap_or(u64::MAX)
}

fn has_stale_inbox(vault: &Path, stale_days: u32, exclude: &[String]) -> bool {
    let inbox = vault.join("inbox");
    if !inbox.is_dir() {
        return false;
    }
    let cutoff = now().saturating_sub(stale_days as u64 * 86_400);
    let pending = load_pending(vault);
    stale_in_dir(&inbox, true, exclude, cutoff, &pending)
}

fn stale_in_dir(
    dir: &Path,
    is_inbox_root: bool,
    exclude: &[String],
    cutoff: u64,
    pending: &Pending,
) -> bool {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return false,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            // Skip the configured hold folders, but only at the inbox root.
            if is_inbox_root && exclude.iter().any(|d| d == &name) {
                continue;
            }
            if stale_in_dir(&path, false, exclude, cutoff, pending) {
                return true;
            }
        } else if name.ends_with(".md") && name != "README.md" {
            let mtime = mtime_secs(&path);
            if mtime <= cutoff && !pending.shields(&path, mtime) {
                return true;
            }
        }
    }
    false
}

fn archive_index_drift(vault: &Path) -> bool {
    let dir = vault.join("tasks").join("archive");
    if !dir.is_dir() {
        return false;
    }
    let mut stems: Vec<String> = Vec::new();
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return false,
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".md") && name != "_index.md" {
            stems.push(name.trim_end_matches(".md").to_string());
        }
    }
    if stems.is_empty() {
        return false;
    }
    let index = dir.join("_index.md");
    let text = match fs::read_to_string(&index) {
        Ok(t) => t,
        // Files exist but no index → drift.
        Err(_) => return true,
    };
    stems.iter().any(|stem| !text.contains(stem))
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

/// Whether the current interval slot (phased from `anchor`) is still unconsumed.
fn slot_due(now_secs: u64, anchor: u64, interval_hours: u32, last_run: Option<u64>) -> bool {
    if now_secs < anchor {
        return false;
    }
    let interval = interval_hours.max(1) as u64 * 3600;
    let slot_start = anchor + ((now_secs - anchor) / interval) * interval;
    match last_run {
        Some(lr) => lr < slot_start,
        None => true,
    }
}

/// Persist `last_run` (and seed `anchor` if unset) so a fired slot isn't
/// re-fired. Whole-file load/save; the small race with a concurrent UI save is
/// acceptable for a single-user desktop app.
fn persist_last_run(ts: u64) {
    let mut cfg = storage::load();
    if cfg.settings.tidy.anchor.is_none() {
        cfg.settings.tidy.anchor = Some(ts);
    }
    cfg.settings.tidy.last_run = Some(ts);
    storage::save(&cfg);
}

/// Starts the background scheduler thread. Sleeps first, so enabling tidy never
/// fires instantly at app launch.
pub fn start_scheduler(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(TICK_SECS));
        tick(&app);
    });
}

fn tick(app: &AppHandle) {
    let cfg = storage::load();
    let t = &cfg.settings.tidy;
    if !t.enabled {
        return;
    }
    let vault = match resolve_vault(&cfg) {
        Some(v) => v,
        None => return,
    };
    // Don't stack runs.
    {
        let st = app.state::<TidyState>();
        if st.0.lock().unwrap().is_running() {
            return;
        }
    }
    let anchor = t.anchor.unwrap_or_else(now);
    if !slot_due(now(), anchor, t.interval_hours, t.last_run) {
        return;
    }
    if has_work(&vault, t) {
        // spawn_agent persists last_run itself.
        let _ = spawn_agent(app.clone(), &cfg, &vault);
    } else {
        // Consume the slot so we don't re-scan every tick — zero tokens.
        persist_last_run(now());
    }
}

// ---------------------------------------------------------------------------
// Manual trigger + run
// ---------------------------------------------------------------------------

fn resolve_vault(cfg: &Config) -> Option<PathBuf> {
    let raw = cfg.settings.vault_path.as_deref()?.trim().to_string();
    if raw.is_empty() {
        return None;
    }
    let path = PathBuf::from(raw.replace('\\', "/"));
    if path.is_dir() {
        Some(path)
    } else {
        None
    }
}

/// Manual "Run now". Works regardless of `tidy.enabled`. Honors the mechanical
/// pre-check unless `force` is set (so a manual run also wastes no tokens when
/// there is nothing to do).
pub fn run_now(app: AppHandle, force: bool) -> Result<String, String> {
    let cfg = storage::load();
    let vault = resolve_vault(&cfg).ok_or("no vault is configured")?;
    {
        let st = app.state::<TidyState>();
        if st.0.lock().unwrap().is_running() {
            return Err("a vault tidy run is already in progress".into());
        }
    }
    if !force && !has_work(&vault, &cfg.settings.tidy) {
        return Ok(
            "Nothing to tidy — no stale inbox notes and the archive index is up to date.".into(),
        );
    }
    spawn_agent(app, &cfg, &vault)?;
    Ok("Vault tidy started.".into())
}

/// Resume the last (stalled/failed) tidy session in a visible terminal so the
/// user can drive it interactively.
pub fn resume(app: AppHandle) -> Result<String, String> {
    let cfg = storage::load();
    let vault = resolve_vault(&cfg).ok_or("no vault is configured")?;
    let t = &cfg.settings.tidy;
    let session_id = {
        let st = app.state::<TidyState>();
        let run = st.0.lock().unwrap();
        run.session_id.clone()
    };
    // Resume by session id is claude-specific; for opencode just reopen the
    // agent in the vault so the user can re-run the tidy prompt themselves.
    let (template, sid) = if t.assignee == "opencode" {
        (cfg.settings.opencode_cmd.as_str(), None)
    } else {
        (cfg.settings.agent_cmd.as_str(), session_id.as_deref())
    };
    actions::launch_resume(template, &vault.to_string_lossy(), sid)?;
    Ok("Opened the tidy session in a terminal.".into())
}

fn spawn_agent(app: AppHandle, cfg: &Config, vault: &Path) -> Result<(), String> {
    let t = &cfg.settings.tidy;
    let prompt = actions::build_tidy_prompt(t.stale_days, &t.exclude_dirs);
    let argv = actions::tidy_agent_argv(
        &t.assignee,
        &cfg.settings.agent_cmd,
        &cfg.settings.opencode_cmd,
        &t.model,
    );
    if argv.first().map(|s| s.is_empty()).unwrap_or(true) {
        return Err("could not resolve the agent command".into());
    }

    let mut command = build_command(&argv);
    command.current_dir(vault);
    command.stdin(Stdio::piped());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = command.spawn().map_err(|e| e.to_string())?;
    // Feed the prompt on stdin, then close it (EOF) so the agent starts.
    if let Some(mut stdin) = child.stdin.take() {
        use std::io::Write;
        let _ = stdin.write_all(prompt.as_bytes());
    }
    let pid = child.id();

    // Fired-slot bookkeeping + state → running.
    persist_last_run(now());
    {
        let st = app.state::<TidyState>();
        let mut run = st.0.lock().unwrap();
        *run = TidyRun::idle();
        run.state = "running".into();
        run.since = Some(now());
        run.child_id = Some(pid);
    }
    emit_status(&app);

    // Watchdog: flag a stall so the UI can warn the user.
    let watch_app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(STALL_SECS));
        let st = watch_app.state::<TidyState>();
        let mut mark = false;
        {
            let mut run = st.0.lock().unwrap();
            if run.is_running() && run.child_id == Some(pid) {
                run.stalled = true;
                mark = true;
            }
        }
        if mark {
            emit_status(&watch_app);
        }
    });

    // Waiter: capture output, update final state, emit.
    let wait_app = app.clone();
    let vault_owned = vault.to_path_buf();
    std::thread::spawn(move || {
        let result = child.wait_with_output();
        finish_run(&wait_app, pid, result, &vault_owned);
    });

    Ok(())
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

fn finish_run(
    app: &AppHandle,
    pid: u32,
    result: std::io::Result<std::process::Output>,
    vault: &Path,
) {
    let (state, summary, error, session_id) = match result {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            save_run_log(vault, &stdout, &stderr);
            let (parsed_summary, sid) = parse_result(&stdout);
            if out.status.success() {
                (
                    "completed".to_string(),
                    parsed_summary.or_else(|| Some("Vault tidy finished.".into())),
                    None,
                    sid,
                )
            } else {
                let msg = if !stderr.trim().is_empty() {
                    stderr.trim().lines().last().unwrap_or("").to_string()
                } else {
                    parsed_summary.unwrap_or_else(|| "the tidy agent exited with an error".into())
                };
                ("failed".to_string(), None, Some(msg), sid)
            }
        }
        Err(e) => ("failed".to_string(), None, Some(e.to_string()), None),
    };

    let st = app.state::<TidyState>();
    {
        let mut run = st.0.lock().unwrap();
        // If a newer run replaced this one, don't clobber it.
        if run.child_id != Some(pid) {
            return;
        }
        run.state = state;
        run.since = None;
        run.at = Some(now());
        run.summary = summary;
        run.error = error;
        run.session_id = session_id;
        run.stalled = false;
        run.child_id = None;
    }
    emit_status(app);
}

/// Parses a claude `--output-format json` result object for the summary text
/// and session id. Falls back to the last non-empty stdout line for other CLIs
/// or non-JSON output.
fn parse_result(stdout: &str) -> (Option<String>, Option<String>) {
    let trimmed = stdout.trim();
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
        let summary = v
            .get("result")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string());
        let sid = v
            .get("session_id")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string());
        if summary.is_some() || sid.is_some() {
            return (summary, sid);
        }
    }
    let last = stdout
        .lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .map(|s| s.trim().to_string());
    (last, None)
}

/// Persists the raw run output under `_ai/logs/tidy/` for later inspection.
fn save_run_log(vault: &Path, stdout: &str, stderr: &str) {
    let dir = vault.join("_ai").join("logs").join("tidy");
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let file = dir.join(format!("tidy-{}.log", now()));
    let body = format!("=== stdout ===\n{stdout}\n\n=== stderr ===\n{stderr}\n");
    let _ = fs::write(file, body);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slot_due_fires_once_per_interval() {
        let anchor = 1_000_000;
        let interval = 24;
        // Never run before → due.
        assert!(slot_due(anchor, anchor, interval, None));
        // Ran at anchor, still same slot → not due.
        assert!(!slot_due(anchor + 3600, anchor, interval, Some(anchor)));
        // A full interval later, last run was the previous slot → due.
        let next = anchor + 24 * 3600;
        assert!(slot_due(next, anchor, interval, Some(anchor)));
        // Ran in the new slot → not due again within it.
        assert!(!slot_due(next + 3600, anchor, interval, Some(next)));
    }

    #[test]
    fn slot_not_due_before_anchor() {
        assert!(!slot_due(500, 1000, 24, None));
    }

    #[test]
    fn parse_result_reads_claude_json() {
        let json = r#"{"result":"auto-filed 2, pending-review 1","session_id":"abc-123","is_error":false}"#;
        let (summary, sid) = parse_result(json);
        assert_eq!(summary.as_deref(), Some("auto-filed 2, pending-review 1"));
        assert_eq!(sid.as_deref(), Some("abc-123"));
    }

    #[test]
    fn load_pending_reads_paths_and_mtime() {
        let vault = std::env::temp_dir().join(format!("tidy-pending-test-{}", now()));
        fs::create_dir_all(vault.join("_ai").join("memory")).unwrap();
        fs::write(
            vault.join("_ai").join("memory").join("tidy-pending.json"),
            r#"{"task":"T-0061","files":[{"path":"inbox/random idea.md","reason":"low confidence"}]}"#,
        )
        .unwrap();
        let pending = load_pending(&vault);
        assert!(pending.mtime > 0);
        assert_eq!(pending.paths.len(), 1);
        // Same file arrived at via a component-wise identical path matches.
        let seen = vault.join("inbox").join("random idea.md");
        assert!(pending.shields(&seen, pending.mtime));
        // Edited after the deferral → no longer shielded.
        assert!(!pending.shields(&seen, pending.mtime + 1));
        // A different file is never shielded.
        assert!(!pending.shields(&vault.join("inbox").join("other.md"), 0));
        let _ = fs::remove_dir_all(&vault);
    }

    #[test]
    fn load_pending_missing_file_is_empty() {
        let vault = std::env::temp_dir().join("tidy-pending-missing");
        let pending = load_pending(&vault);
        assert!(pending.paths.is_empty());
        assert!(!pending.shields(&vault.join("inbox").join("a.md"), 0));
    }

    #[test]
    fn parse_result_falls_back_to_last_line() {
        let (summary, sid) = parse_result("working...\ndone: nothing to do\n");
        assert_eq!(summary.as_deref(), Some("done: nothing to do"));
        assert_eq!(sid, None);
    }
}
