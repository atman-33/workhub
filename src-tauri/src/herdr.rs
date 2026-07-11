use serde::Deserialize;
use std::process::Command;

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
