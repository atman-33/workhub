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
}

#[derive(Debug, Deserialize)]
struct WorkspaceInfo {
    workspace_id: String,
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

/// Creates a herdr workspace and returns its workspace id.
///
/// `label` is sanitized to avoid shell/meta-character issues.
pub fn create_workspace(cmd: &str, cwd: &str, label: &str) -> Result<String, String> {
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

    Ok(parsed.result.workspace.workspace_id)
}

/// Starts an agent in the given herdr workspace.
pub fn start_agent(
    cmd: &str,
    workspace_id: &str,
    name: &str,
    cwd: &str,
    argv: &[String],
) -> Result<(), String> {
    let safe_name = sanitize_label(name);
    let mut args: Vec<String> = vec![
        "agent".into(),
        "start".into(),
        safe_name,
        "--workspace".into(),
        workspace_id.into(),
        "--cwd".into(),
        cwd.into(),
        "--focus".into(),
        "--".into(),
    ];
    args.extend(argv.iter().cloned());

    let output = run_herdr(cmd, &args.iter().map(|s| s.as_str()).collect::<Vec<_>>())?;

    if !output.status.success() {
        return Err(format!(
            "herdr agent start failed: {}",
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
