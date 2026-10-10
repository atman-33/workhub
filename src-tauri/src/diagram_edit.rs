//! Headless agent edits of a diagram note (T-0091, T-0188, unified in T-0685).
//!
//! One runner for every kind of diagram (schedule, mindmap, matrix2x2, flow,
//! pfd, algorithm, usecase, ifdam): the run takes a path and nothing else,
//! because the `diagram-edit` skill reads the note's frontmatter `type` and
//! follows that kind's rule file.
//! A new kind therefore needs no change here.
//!
//! Same execution shape as `tidy.rs` - spawn the agent CLI with the prompt on
//! stdin, capture the output, report progress through a Tauri event - but with
//! a different safety story, because this run rewrites a file the user is
//! looking at and dragging things around in:
//!
//! - a snapshot is taken **before** the agent starts, so the UI can offer a
//!   one-generation undo (`diagram::restore_snapshot`);
//! - `running` doubles as an editing lock: the frontend goes read-only while a
//!   run is live, so an app write and an agent write cannot interleave;
//! - the file watcher reloads the note when the agent finishes
//!   (`diagrams-changed`), so nothing here has to push the new content back.
//!
//! The agent does the editing through the `diagram-edit` skill, which owns the
//! shared procedure (ids are never renumbered, `## Memo` is never touched). This
//! module only tells it which file and what to do.

use crate::actions;
use crate::diagram;
use crate::models::Config;
use crate::storage;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const STATUS_EVENT: &str = "diagram-edit:status";
/// A run still going after this long is flagged so the UI can warn instead of
/// leaving the calendar locked with no explanation.
const STALL_SECS: u64 = 5 * 60;
/// How many past runs the history keeps. The history is a "what did I just
/// ask for" aid, not an audit log — `_ai/logs/diagram-edit/` holds the full output.
const HISTORY_LIMIT: usize = 10;

pub struct DiagramEditState(pub Mutex<DiagramEditRun>);

impl Default for DiagramEditState {
    fn default() -> Self {
        DiagramEditState(Mutex::new(DiagramEditRun::idle()))
    }
}

#[derive(Clone, serde::Serialize)]
pub struct DiagramEditEntry {
    /// The natural-language instruction that was run.
    pub instruction: String,
    /// "completed" | "failed"
    pub state: String,
    /// Agent summary (completed) or error message (failed).
    pub message: String,
    /// Wall-clock seconds the run took.
    pub seconds: u64,
    /// Unix seconds the run finished.
    pub at: u64,
}

#[derive(Clone, serde::Serialize)]
pub struct DiagramEditRun {
    /// "idle" | "running" | "completed" | "failed"
    pub state: String,
    /// Absolute path of the diagram the current/last run targeted.
    pub path: Option<String>,
    pub instruction: Option<String>,
    /// Unix seconds the current run started (state == "running").
    pub since: Option<u64>,
    pub summary: Option<String>,
    pub error: Option<String>,
    /// True while a running run has exceeded the stall threshold.
    pub stalled: bool,
    /// Whether an undo target exists for `path`.
    pub can_undo: bool,
    /// Most recent first.
    pub history: Vec<DiagramEditEntry>,
    #[serde(skip)]
    child_id: Option<u32>,
}

impl DiagramEditRun {
    fn idle() -> Self {
        DiagramEditRun {
            state: "idle".into(),
            path: None,
            instruction: None,
            since: None,
            summary: None,
            error: None,
            stalled: false,
            can_undo: false,
            history: Vec::new(),
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
    if let Some(st) = app.try_state::<DiagramEditState>() {
        let snapshot = st.0.lock().unwrap().clone();
        let _ = app.emit(STATUS_EVENT, snapshot);
    }
}

pub fn snapshot(app: &AppHandle) -> DiagramEditRun {
    let st = app.state::<DiagramEditState>();
    let mut run = st.0.lock().unwrap();
    if run.is_running() {
        if let Some(since) = run.since {
            run.stalled = now().saturating_sub(since) >= STALL_SECS;
        }
    }
    // Derive the undo affordance from the snapshot file rather than the
    // in-memory flag: `restore_snapshot` consumes the snapshot, so this is
    // what stops a second press from "undoing" an already-undone run.
    if let (Some(path), Some(vault)) = (run.path.clone(), resolve_vault(&storage::load())) {
        run.can_undo = diagram::has_snapshot(&vault, &PathBuf::from(path));
    }
    run.clone()
}

fn resolve_vault(cfg: &Config) -> Option<PathBuf> {
    let raw = cfg.settings.vault_path.as_deref()?.trim().to_string();
    if raw.is_empty() {
        return None;
    }
    let path = PathBuf::from(raw.replace('\\', "/"));
    path.is_dir().then_some(path)
}

/// Prompt handed to the agent on stdin. It names the skill rather than
/// restating its rules: the notation, the id-preservation requirement and the
/// "never touch `## Memo`" rule live in the skill, and duplicating them here
/// would give the agent two sources to reconcile when they drift.
fn build_prompt(path: &str, instruction: &str, confirm: bool) -> String {
    let mode = mode_line(confirm);
    format!(
        "Use the `diagram-edit` skill to edit this workhub diagram note.\n\n\
Diagram file: {path}\n\n\
Instruction:\n{instruction}\n\n\
{mode}\n\n\
Report a one-paragraph summary of what changed (or would change), naming the \
element ids you touched. Do not modify any other file.\n"
    )
}

fn mode_line(confirm: bool) -> &'static str {
    if confirm {
        "Do NOT write the file. Report the exact lines you would change, as a diff, and stop."
    } else {
        "Apply the change to the file."
    }
}

/// The same prompt for pasting into an interactive session (Claude Desktop and
/// the like) by hand. `instruction` is whatever the panel holds: when it is
/// empty the owner will give instructions in the following messages, so the
/// prompt says to wait instead of editing on its own.
pub fn build_copy_prompt(path: &str, instruction: &str, confirm: bool) -> String {
    let instruction = instruction.trim();
    let request = if instruction.is_empty() {
        "I will give you the instructions in the following messages. \
Do not edit anything until I do."
            .to_string()
    } else {
        format!("Instruction:\n{instruction}")
    };
    format!(
        "Use the `diagram-edit` skill to edit this workhub diagram note.\n\n\
Diagram file: {path}\n\n\
{request}\n\n\
{mode}\n\n\
After each change, summarize in a sentence what changed (or would change), \
naming the element ids you touched. Do not modify any other file.\n",
        mode = mode_line(confirm)
    )
}

/// Starts a run. Fails fast when another run is live — the UI keeps the
/// calendar locked for the duration, so overlapping runs would be both
/// confusing and a write race.
pub fn run(
    app: AppHandle,
    path: String,
    instruction: String,
    confirm: bool,
) -> Result<String, String> {
    let instruction = instruction.trim().to_string();
    if instruction.is_empty() {
        return Err("an instruction is required".into());
    }
    let cfg = storage::load();
    let vault = resolve_vault(&cfg).ok_or("no vault is configured")?;
    let target = PathBuf::from(path.replace('\\', "/"));
    if !target.is_file() {
        return Err("the diagram file does not exist".into());
    }
    // Refuse a note that is not a diagram before a snapshot or an agent is
    // spent on it. Which kind it is does not matter here: the skill reads it.
    diagram::kind_of(&target)?;
    {
        let st = app.state::<DiagramEditState>();
        if st.0.lock().unwrap().is_running() {
            return Err("a diagram edit is already running".into());
        }
    }

    // Before anything can touch the file — a failed spawn after this point
    // still leaves a valid undo target, which is the harmless direction.
    diagram::save_snapshot(&vault, &target)?;

    let assignee = cfg.settings.diagram_assignee.clone();
    let argv = actions::tidy_agent_argv(
        &assignee,
        &cfg.settings.agent_cmd,
        &cfg.settings.opencode_cmd,
        &cfg.settings.diagram_model,
        "",
    );
    if argv.first().map(|s| s.is_empty()).unwrap_or(true) {
        return Err("could not resolve the agent command".into());
    }

    let prompt = build_prompt(&target.to_string_lossy(), &instruction, confirm);
    let mut command = build_command(&argv);
    command.current_dir(&vault);
    command.stdin(Stdio::piped());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = command.spawn().map_err(|e| e.to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        use std::io::Write;
        let _ = stdin.write_all(prompt.as_bytes());
    }
    let pid = child.id();
    let started = now();

    {
        let st = app.state::<DiagramEditState>();
        let mut run = st.0.lock().unwrap();
        let history = run.history.clone();
        *run = DiagramEditRun::idle();
        run.history = history;
        run.state = "running".into();
        run.path = Some(diagram::read_diagram(&target)?.path);
        run.instruction = Some(instruction.clone());
        run.since = Some(started);
        run.can_undo = true;
        run.child_id = Some(pid);
    }
    emit_status(&app);

    let watch_app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(STALL_SECS));
        let st = watch_app.state::<DiagramEditState>();
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

    let wait_app = app.clone();
    let vault_owned = vault.clone();
    std::thread::spawn(move || {
        let result = child.wait_with_output();
        finish(&wait_app, pid, result, &vault_owned, &instruction, started);
    });

    Ok("Diagram edit started.".into())
}

/// Same `cmd /C` rationale as `tidy::build_command`: the agent CLIs are `.cmd`
/// shims on Windows and the prompt travels on stdin, not as an argument.
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

fn finish(
    app: &AppHandle,
    pid: u32,
    result: std::io::Result<std::process::Output>,
    vault: &Path,
    instruction: &str,
    started: u64,
) {
    let (state, summary, error) = match result {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            save_run_log(vault, instruction, &stdout, &stderr);
            let parsed = parse_result(&stdout);
            if out.status.success() {
                (
                    "completed".to_string(),
                    parsed.or_else(|| Some("Diagram edit finished.".into())),
                    None,
                )
            } else {
                let msg = if stderr.trim().is_empty() {
                    parsed.unwrap_or_else(|| "the agent exited with an error".into())
                } else {
                    stderr.trim().lines().last().unwrap_or("").to_string()
                };
                ("failed".to_string(), None, Some(msg))
            }
        }
        Err(e) => ("failed".to_string(), None, Some(e.to_string())),
    };

    let st = app.state::<DiagramEditState>();
    {
        let mut run = st.0.lock().unwrap();
        if run.child_id != Some(pid) {
            return; // a newer run replaced this one
        }
        run.history.insert(
            0,
            DiagramEditEntry {
                instruction: instruction.to_string(),
                state: state.clone(),
                message: summary
                    .clone()
                    .or_else(|| error.clone())
                    .unwrap_or_default(),
                seconds: now().saturating_sub(started),
                at: now(),
            },
        );
        run.history.truncate(HISTORY_LIMIT);
        run.state = state;
        run.since = None;
        run.summary = summary;
        run.error = error;
        run.stalled = false;
        run.child_id = None;
    }
    emit_status(app);
}

/// Same shape as `tidy::parse_result`, minus the session id: diagram edits are
/// one-shot and never resumed, so only the summary is of use here.
fn parse_result(stdout: &str) -> Option<String> {
    let trimmed = stdout.trim();
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(s) = v.get("result").and_then(|x| x.as_str()) {
            return Some(s.to_string());
        }
    }
    stdout
        .lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .map(|s| s.trim().to_string())
}

fn save_run_log(vault: &Path, instruction: &str, stdout: &str, stderr: &str) {
    let dir = vault.join("_ai").join("logs").join("diagram-edit");
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let file = dir.join(format!("diagram-edit-{}.log", now()));
    let body = format!(
        "instruction: {instruction}\n\n=== stdout ===\n{stdout}\n\n=== stderr ===\n{stderr}\n"
    );
    let _ = std::fs::write(file, body);
}

/// Restores the pre-run snapshot and clears the undo affordance, so the button
/// cannot be pressed twice against a snapshot that has already been consumed.
pub fn undo(app: AppHandle, path: String) -> Result<diagram::DiagramDoc, String> {
    let cfg = storage::load();
    let vault = resolve_vault(&cfg).ok_or("no vault is configured")?;
    let target = PathBuf::from(path.replace('\\', "/"));
    {
        let st = app.state::<DiagramEditState>();
        if st.0.lock().unwrap().is_running() {
            return Err("wait for the running diagram edit to finish".into());
        }
    }
    let doc = diagram::restore_snapshot(&vault, &target)?;
    {
        let st = app.state::<DiagramEditState>();
        let mut run = st.0.lock().unwrap();
        run.can_undo = false;
    }
    emit_status(&app);
    Ok(doc)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_names_the_skill_and_the_mode() {
        let apply = build_prompt("C:/v/projects/p/diagrams/a.md", "shift the boxes", false);
        assert!(apply.contains("`diagram-edit` skill"));
        assert!(apply.contains("C:/v/projects/p/diagrams/a.md"));
        assert!(apply.contains("shift the boxes"));
        assert!(apply.contains("Apply the change"));
        // The old per-kind skills are gone; the prompt must not point at them.
        assert!(!apply.contains("schedule-edit"));
        assert!(!apply.contains("mindmap-edit"));

        let dry = build_prompt("x.md", "shift", true);
        assert!(dry.contains("Do NOT write the file"));
        assert!(!dry.contains("Apply the change"));
    }

    #[test]
    fn prompt_does_not_depend_on_the_kind() {
        // The same text for every kind: the skill reads `type` from the file.
        let a = build_prompt("a.md", "do it", false);
        for kind in diagram::KINDS {
            let path = format!("C:/v/projects/p/{kind}/a.md");
            let p = build_prompt(&path, "do it", false);
            assert_eq!(p.replace(&path, "a.md"), a);
        }
    }

    #[test]
    fn copy_prompt_carries_the_instruction_or_waits_for_one() {
        let with = build_copy_prompt(
            "C:/v/a.md",
            "  shift by a week 
",
            false,
        );
        assert!(with.contains("`diagram-edit` skill"));
        assert!(with.contains("C:/v/a.md"));
        assert!(with.contains(
            "Instruction:
shift by a week"
        ));
        assert!(with.contains("Apply the change"));

        let without = build_copy_prompt("C:/v/a.md", "   ", true);
        assert!(!without.contains("Instruction:"));
        assert!(without.contains("Do not edit anything until I do"));
        assert!(without.contains("Do NOT write the file"));
    }

    #[test]
    fn parse_result_prefers_the_json_result_field() {
        let json = r#"{"result":"moved I-001 forward 7 days","is_error":false}"#;
        assert_eq!(
            parse_result(json).as_deref(),
            Some("moved I-001 forward 7 days")
        );
        assert_eq!(
            parse_result(
                "thinking...
done
"
            )
            .as_deref(),
            Some("done")
        );
        assert_eq!(
            parse_result(
                "   
"
            ),
            None
        );
    }
}
