use serde::Deserialize;
use std::process::Command;
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Result returned by `herdr workspace create`.
#[derive(Debug, Deserialize)]
struct WorkspaceCreateResult {
    result: WorkspaceCreatePayload,
}

#[derive(Debug, Deserialize)]
struct WorkspaceCreatePayload {
    workspace: WorkspaceInfo,
    root_pane: PaneInfo,
}

#[derive(Debug, Deserialize)]
struct WorkspaceInfo {
    workspace_id: String,
}

#[derive(Debug, Deserialize)]
struct PaneInfo {
    pane_id: String,
}

/// A freshly created herdr workspace: its id plus the id of the root shell pane
/// that `workspace create` opens. The agent is launched directly in this root
/// pane (via `run_in_pane`) so the workspace stays a single pane instead of
/// splitting off a second one with `agent start`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreatedWorkspace {
    pub workspace_id: String,
    pub root_pane_id: String,
}

/// Returns true when the configured herdr CLI is on PATH.
pub fn is_installed(cmd: &str) -> bool {
    Command::new(cmd)
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Returns true when a herdr server is running (the socket API is reachable).
/// `herdr --version` alone is not enough: the CLI works without a running
/// server, but every workspace/agent command needs one.
///
/// `herdr status server` always exits 0 whether or not a server is up — it
/// reports the state in its output text (`status: running` vs
/// `status: not running`), so the exit code cannot be used and the output must
/// be parsed instead.
pub fn is_server_running(cmd: &str) -> bool {
    match run_herdr(cmd, &["status", "server"]) {
        Ok(o) => {
            let text = format!(
                "{}{}",
                String::from_utf8_lossy(&o.stdout),
                String::from_utf8_lossy(&o.stderr)
            );
            parse_server_running(&text)
        }
        Err(_) => false,
    }
}

/// Parses `herdr status server` output. `status: running` marks a live server;
/// `status: not running` (which also contains the substring "running") does
/// not, so match the full `status: running` line.
fn parse_server_running(status_output: &str) -> bool {
    status_output.contains("status: running")
}

/// Makes sure a herdr server is running, launching the herdr client in a new
/// Windows Terminal window when it is not (the client starts the server).
/// Polls the server status until it comes up or the timeout expires.
pub fn ensure_server(cmd: &str) -> Result<(), String> {
    if is_server_running(cmd) {
        return Ok(());
    }

    let mut launcher = Command::new("cmd");
    launcher.arg("/C").arg("wt").arg(cmd);
    #[cfg(windows)]
    launcher.creation_flags(CREATE_NO_WINDOW);
    launcher
        .spawn()
        .map_err(|e| format!("failed to launch herdr via Windows Terminal: {e}"))?;

    let deadline = Instant::now() + Duration::from_secs(15);
    while Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(500));
        if is_server_running(cmd) {
            return Ok(());
        }
    }
    Err("herdr server did not start within 15 seconds".into())
}

/// Creates a herdr workspace and returns its id together with the id of the
/// root shell pane that was opened.
///
/// `label` is sanitized to avoid shell/meta-character issues.
pub fn create_workspace(cmd: &str, cwd: &str, label: &str) -> Result<CreatedWorkspace, String> {
    let safe_label = sanitize_label(label);
    let output = run_herdr(
        cmd,
        &[
            "workspace",
            "create",
            "--cwd",
            cwd,
            "--label",
            &safe_label,
            "--focus",
        ],
    )?;

    if !output.status.success() {
        return Err(format!(
            "herdr workspace create failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let parsed: WorkspaceCreateResult = serde_json::from_slice(&output.stdout).map_err(|e| {
        format!(
            "failed to parse herdr workspace create response: {e} (raw: {})",
            String::from_utf8_lossy(&output.stdout)
        )
    })?;

    Ok(CreatedWorkspace {
        workspace_id: parsed.result.workspace.workspace_id,
        root_pane_id: parsed.result.root_pane.pane_id,
    })
}

/// Runs a command in an existing herdr pane. Used to launch the agent directly
/// in a workspace's root pane (keeping it a single pane) instead of splitting a
/// new one with `agent start`. herdr still auto-detects the started agent, so
/// its working/done status tracking keeps working.
///
/// `command` is passed as one argument; the herdr CLI forwards it to the pane's
/// shell. No manual escaping is needed here — `std::process::Command` quotes the
/// argument for us.
pub fn run_in_pane(cmd: &str, pane_id: &str, command: &str) -> Result<(), String> {
    let output = run_herdr(cmd, &["pane", "run", pane_id, command])?;

    if !output.status.success() {
        return Err(format!(
            "herdr pane run failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(())
}

/// Run herdr and capture output, hiding the console window on Windows.
fn run_herdr(cmd: &str, args: &[&str]) -> Result<std::process::Output, String> {
    let mut command = Command::new(cmd);
    command.args(args);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
        .output()
        .map_err(|e| format!("failed to run herdr: {e}"))
}

/// Keeps alphanumeric, dash, underscore and space; collapses repeated spaces.
fn sanitize_label(label: &str) -> String {
    let mut out = String::with_capacity(label.len());
    let mut prev_space = false;
    for ch in label.chars() {
        let keep = if ch.is_alphanumeric() || ch == '-' || ch == '_' || ch == ' ' {
            ch
        } else {
            ' '
        };
        if keep == ' ' {
            if !prev_space {
                out.push(keep);
            }
            prev_space = true;
        } else {
            out.push(keep);
            prev_space = false;
        }
    }
    out.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_running_server_from_status_output() {
        // `herdr status server` exits 0 in both states; only the text differs.
        assert!(parse_server_running(
            "status: running\nversion: 0.7.2\nprotocol: 16\n"
        ));
        assert!(!parse_server_running(
            "status: not running\nsocket: C:/x/herdr.sock\n"
        ));
        assert!(!parse_server_running(""));
    }

    #[test]
    fn parses_workspace_create_root_pane() {
        // Real `herdr workspace create` shape: result.workspace + result.root_pane.
        let json = r#"{
            "result": {
                "workspace": { "workspace_id": "wV", "label": "T-1 title" },
                "root_pane": { "pane_id": "wV:p1" }
            }
        }"#;
        let parsed: WorkspaceCreateResult = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.result.workspace.workspace_id, "wV");
        assert_eq!(parsed.result.root_pane.pane_id, "wV:p1");
    }

    #[test]
    fn sanitizes_labels() {
        assert_eq!(
            sanitize_label("T-0042 Fix login bug!"),
            "T-0042 Fix login bug"
        );
        assert_eq!(
            sanitize_label("T-0042   Multiple   spaces"),
            "T-0042 Multiple spaces"
        );
        assert_eq!(
            sanitize_label("<script>alert(1)</script>"),
            "script alert 1 script"
        );
    }
}
