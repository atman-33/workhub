use crate::storage;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Launch a command line via a hidden `cmd /C`, detached from Workhub.
/// Used for terminals, VS Code, and agent launches. No `start` and no visible
/// console: launching a .cmd shim (like VS Code's code.cmd) through `start`
/// opens a console window that Code.exe then keeps alive until VS Code exits.
/// GUI targets (VS Code, Windows Terminal) create their own windows anyway.
fn launch(command_line: &str) -> Result<(), String> {
    let mut cmd = Command::new("cmd");
    cmd.arg("/C");
    cmd.raw_arg_line(command_line);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

// std has no "append raw args" helper that splits a template string, so do a
// minimal quote-aware split and pass each token as an arg.
trait RawArgLine {
    fn raw_arg_line(&mut self, line: &str) -> &mut Self;
}

impl RawArgLine for Command {
    fn raw_arg_line(&mut self, line: &str) -> &mut Self {
        for token in split_command_line(line) {
            self.arg(token);
        }
        self
    }
}

/// Quote-aware split: `a "b c" d` -> ["a", "b c", "d"].
fn split_command_line(line: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    for ch in line.chars() {
        match ch {
            '"' => in_quotes = !in_quotes,
            c if c.is_whitespace() && !in_quotes => {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
            }
            c => current.push(c),
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

fn fill_template(template: &str, path: &str) -> String {
    // Quote the path so templates work with paths containing spaces.
    let quoted = if path.contains(' ') {
        format!("\"{path}\"")
    } else {
        path.to_string()
    };
    template.replace("{path}", &quoted)
}

pub fn open_terminal(template: &str, path: &str) -> Result<(), String> {
    launch(&fill_template(template, path))
}

pub fn launch_agent(template: &str, path: &str) -> Result<(), String> {
    launch(&fill_template(template, path))
}

/// Launches the configured agent for a task with an initial prompt telling it
/// which task to work and to run the `task-start` skill first. Reuses
/// `agent_cmd`'s template mechanism rather than adding a separate setting: the
/// prompt is appended as one quoted trailing argument, which works because
/// `agent_cmd` templates end in a command that accepts a free-form argument
/// (e.g. `... -Command claude`).
///
/// The session always starts in the VAULT (the agent harness home), never in
/// the task's repository: the vault carries the plugin/rules configuration,
/// and the `task-start` skill resolves the task's `project` field to a
/// repository through the vault's `.claude/project-context.json`.
pub fn launch_agent_for_task(
    agent_cmd: &str,
    task_id: &str,
    task_file: &str,
    project: &str,
    vault_path: &str,
) -> Result<(), String> {
    if vault_path.trim().is_empty() {
        return Err("no vault is configured".into());
    }
    let vault = vault_path.replace('\\', "/");
    let project_note = if project.trim().is_empty() {
        String::new()
    } else {
        format!("対象プロジェクト: {project}。")
    };
    let prompt = format!(
        "タスク {task_id} を実施してください。まず task-start スキルを実行してください。{project_note}タスクファイル: {task_file}"
    );
    let quoted_prompt = format!("\"{}\"", prompt.replace('"', "\\\""));
    let template = format!("{agent_cmd} {quoted_prompt}");
    launch(&fill_template(&template, &vault))
}

pub fn open_explorer(path: &str) -> Result<(), String> {
    Command::new("explorer")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Open one or more projects in VS Code. A single project opens as a plain
/// folder; multiple projects are written to a generated .code-workspace file
/// (named by a stable hash of the member paths, so the same set reuses the
/// same workspace identity in VS Code).
pub fn open_in_vscode(vscode_cmd: &str, paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Err("no projects selected".into());
    }
    if paths.len() == 1 {
        return launch(&format!("{vscode_cmd} \"{}\"", paths[0]));
    }

    let mut sorted: Vec<&String> = paths.iter().collect();
    sorted.sort();
    let mut hasher = DefaultHasher::new();
    sorted.hash(&mut hasher);
    let file =
        storage::workspaces_dir().join(format!("workhub-{:016x}.code-workspace", hasher.finish()));

    std::fs::create_dir_all(storage::workspaces_dir()).map_err(|e| e.to_string())?;
    let folders: Vec<serde_json::Value> = sorted
        .iter()
        .map(|p| serde_json::json!({ "path": p }))
        .collect();
    let body = serde_json::to_string_pretty(&serde_json::json!({ "folders": folders }))
        .map_err(|e| e.to_string())?;
    std::fs::write(&file, body).map_err(|e| e.to_string())?;

    launch(&format!("{vscode_cmd} \"{}\"", file.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_quoted_arguments() {
        assert_eq!(
            split_command_line(r#"wt -d "C:/My Projects/app" pwsh"#),
            vec!["wt", "-d", "C:/My Projects/app", "pwsh"]
        );
    }

    #[test]
    fn task_agent_requires_a_vault() {
        assert!(launch_agent_for_task("echo {path}", "T-1", "tasks/T-1.md", "proj", " ").is_err());
    }

    #[test]
    fn template_quotes_paths_with_spaces() {
        assert_eq!(
            fill_template("code {path}", "C:/My Projects/app"),
            r#"code "C:/My Projects/app""#
        );
        assert_eq!(
            fill_template("code {path}", "C:/repos/app"),
            "code C:/repos/app"
        );
    }
}
