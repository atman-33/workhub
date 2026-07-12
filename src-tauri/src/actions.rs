use crate::herdr;
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

/// Parameters for launching an agent for a task.
pub struct LaunchAgentForTaskParams<'a> {
    pub agent_cmd: &'a str,
    /// Task assignee: "claude-code" | "opencode". Selects the CLI's auto-run
    /// flags and how the initial prompt is passed.
    pub assignee: &'a str,
    pub task_id: &'a str,
    pub task_title: &'a str,
    pub task_file: &'a str,
    pub project: &'a str,
    /// Passed to the agent CLI as `--model <model>`; empty = agent default.
    pub model: &'a str,
    pub vault_path: &'a str,
    pub use_herdr: bool,
    pub herdr_cmd: &'a str,
}

/// Launches the configured agent for a task with an initial prompt telling it
/// which task to work, run it to completion without asking, and report the
/// result via the `task-report` skill. Reuses `agent_cmd`'s template mechanism
/// rather than adding a separate setting: the auto-run flags and prompt are
/// appended after the template, which works because `agent_cmd` templates end
/// in a command that accepts trailing arguments (e.g. `... -Command claude`).
///
/// The session always starts in the VAULT (the agent harness home), never in
/// the task's repository: the vault carries the plugin/rules configuration,
/// and the `task-start` skill resolves the task's `project` field to a
/// repository through the vault's `.claude/project-context.json`.
///
/// When `use_herdr` is true and herdr is installed, the agent is started in a
/// fresh herdr workspace labelled with the task id and title, launching the
/// herdr server first when it is not yet running. If herdr is not available,
/// this falls back to the plain terminal launch.
///
/// Returns a short human-readable message describing how the agent was
/// launched (herdr workspace vs. terminal fallback) for the UI status bar.
pub fn launch_agent_for_task(params: LaunchAgentForTaskParams<'_>) -> Result<String, String> {
    if params.vault_path.trim().is_empty() {
        return Err("no vault is configured".into());
    }
    let vault = params.vault_path.replace('\\', "/");
    let command_line = fill_template(&agent_command_template(&params), &vault);

    if params.use_herdr && herdr::is_installed(params.herdr_cmd) {
        match launch_in_herdr(&params, &vault, &command_line) {
            Ok(()) => return Ok(format!("launched {} in a herdr workspace", params.task_id)),
            Err(e) => {
                // Fall back to terminal launch so a herdr hiccup never blocks work.
                eprintln!("herdr launch failed, falling back to terminal: {e}");
                launch(&command_line)?;
                return Ok(format!(
                    "herdr unavailable ({e}) — launched {} in a terminal instead",
                    params.task_id
                ));
            }
        }
    }

    launch(&command_line)?;
    Ok(format!("launched {} in a terminal", params.task_id))
}

/// Starts the herdr server if needed, creates a workspace for the task, and
/// starts the agent inside it.
fn launch_in_herdr(
    params: &LaunchAgentForTaskParams<'_>,
    vault: &str,
    command_line: &str,
) -> Result<(), String> {
    herdr::ensure_server(params.herdr_cmd)?;
    let label = format!("{} {}", params.task_id, params.task_title);
    let workspace_id = herdr::create_workspace(params.herdr_cmd, vault, &label)?;
    let argv = agent_argv_from_command_line(command_line);
    herdr::start_agent(params.herdr_cmd, &workspace_id, params.task_id, vault, &argv)
}

/// Builds the full agent command template: agent_cmd + model + auto-run flags
/// + the initial prompt.
///
/// The prompt is wrapped as `"'…'"` — double quotes on the outside so it
/// survives `split_command_line`/`Command::arg` as ONE token, single quotes on
/// the inside so PowerShell still sees one string after `-Command` rejoins its
/// arguments with spaces (PowerShell's -Command drops the double quotes when
/// reassembling the command line, which previously truncated the prompt to its
/// first word). Inner single quotes are doubled per PowerShell escaping rules.
fn agent_command_template(params: &LaunchAgentForTaskParams<'_>) -> String {
    let project_note = if params.project.trim().is_empty() {
        String::new()
    } else {
        format!("対象プロジェクト: {}。", params.project)
    };
    let prompt = format!(
        "タスク {} を実施してください。まず task-start スキルを実行し、確認を求めずに完了まで自動で実施してください。完了したら task-report スキルを実行してステータスを更新してください。{}タスクファイル: {}",
        params.task_id, project_note, params.task_file
    );
    let quoted_prompt = format!("\"'{}'\"", prompt.replace('\'', "''"));

    // opencode's positional argument is a project path, not a prompt, so the
    // prompt must go through --prompt; claude takes it as the positional arg.
    let (auto_flag, prompt_arg) = if params.assignee == "opencode" {
        (" --auto", format!(" --prompt {quoted_prompt}"))
    } else {
        (" --permission-mode auto", format!(" {quoted_prompt}"))
    };
    format!(
        "{}{}{auto_flag}{prompt_arg}",
        params.agent_cmd,
        model_arg(params.model)
    )
}

/// Renders the ` --model <model>` fragment inserted between the agent command
/// and the trailing prompt. Both claude and opencode accept `--model`; an
/// empty model means "use the agent's own default" and adds nothing.
fn model_arg(model: &str) -> String {
    let model = model.trim();
    if model.is_empty() {
        String::new()
    } else if model.contains(char::is_whitespace) {
        format!(" --model \"{model}\"")
    } else {
        format!(" --model {model}")
    }
}

/// Extracts the agent argv from a filled command line, stripping a leading
/// Windows Terminal wrapper (`wt -d <path>`) so the agent can run directly
/// inside a herdr pane.
fn agent_argv_from_command_line(command_line: &str) -> Vec<String> {
    let tokens = split_command_line(command_line);
    if tokens.len() >= 3 && tokens[0].eq_ignore_ascii_case("wt") && tokens[1] == "-d" {
        tokens.into_iter().skip(3).collect()
    } else {
        tokens
    }
}

/// List models available to the opencode CLI via `opencode models` — one
/// `provider/model` id per line. Used to populate the task dialog's model
/// suggestions for opencode-assigned tasks.
pub fn opencode_models() -> Result<Vec<String>, String> {
    // Go through `cmd /C` on Windows: a Node-installed opencode is a .cmd
    // shim that std::process::Command cannot spawn directly (same reason
    // `launch()` above wraps command lines in cmd /C).
    #[cfg(windows)]
    let mut cmd = {
        let mut c = Command::new("cmd");
        c.arg("/C").arg("opencode models");
        c.creation_flags(CREATE_NO_WINDOW);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = Command::new("opencode");
        c.arg("models");
        c
    };
    let out = cmd
        .output()
        .map_err(|e| format!("failed to run opencode: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let err = err.trim();
        return Err(if err.is_empty() {
            "opencode models failed".into()
        } else {
            err.to_string()
        });
    }
    Ok(parse_opencode_models(&String::from_utf8_lossy(&out.stdout)))
}

/// Keep only lines that look like `provider/model` ids, dropping blank lines
/// and any log/progress noise the CLI may print.
fn parse_opencode_models(stdout: &str) -> Vec<String> {
    stdout
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && l.contains('/') && !l.contains(char::is_whitespace))
        .map(str::to_string)
        .collect()
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

    fn test_params<'a>(assignee: &'a str, model: &'a str) -> LaunchAgentForTaskParams<'a> {
        LaunchAgentForTaskParams {
            agent_cmd: "wt -d {path} powershell -NoExit -Command claude",
            assignee,
            task_id: "T-1",
            task_title: "title",
            task_file: "tasks/T-1.md",
            project: "proj",
            model,
            vault_path: "C:/vault",
            use_herdr: false,
            herdr_cmd: "herdr",
        }
    }

    #[test]
    fn task_agent_requires_a_vault() {
        let mut params = test_params("claude-code", "");
        params.vault_path = " ";
        assert!(launch_agent_for_task(params).is_err());
    }

    #[test]
    fn claude_template_uses_auto_permission_mode_and_positional_prompt() {
        let template = agent_command_template(&test_params("claude-code", "opus"));
        assert!(template.starts_with(
            "wt -d {path} powershell -NoExit -Command claude --model opus --permission-mode auto \"'タスク T-1 を実施してください。"
        ));
        assert!(template.contains("task-start"));
        assert!(template.contains("task-report"));
        assert!(template.contains("対象プロジェクト: proj。"));
        assert!(template.ends_with("タスクファイル: tasks/T-1.md'\""));
        assert!(!template.contains("--prompt"));
    }

    #[test]
    fn opencode_template_uses_auto_flag_and_prompt_option() {
        let mut params = test_params("opencode", "");
        params.agent_cmd = "wt -d {path} powershell -NoExit -Command opencode";
        let template = agent_command_template(&params);
        assert!(template.contains(" opencode --auto --prompt \"'タスク T-1 "));
        assert!(!template.contains("--model"));
        assert!(!template.contains("--permission-mode"));
    }

    #[test]
    fn prompt_survives_split_as_one_single_quoted_token() {
        let params = test_params("claude-code", "");
        let command_line = fill_template(&agent_command_template(&params), "C:/vault");
        let argv = agent_argv_from_command_line(&command_line);
        // wt -d <path> stripped; prompt is the last token, one single-quoted string.
        assert_eq!(argv[0], "powershell");
        let prompt = argv.last().unwrap();
        assert!(prompt.starts_with("'タスク T-1 "));
        assert!(prompt.ends_with("tasks/T-1.md'"));
    }

    #[test]
    fn prompt_escapes_single_quotes_for_powershell() {
        let mut params = test_params("claude-code", "");
        params.project = "o'brien";
        let template = agent_command_template(&params);
        assert!(template.contains("o''brien"));
    }

    #[test]
    fn strips_wt_wrapper_for_herdr() {
        assert_eq!(
            agent_argv_from_command_line(
                r#"wt -d "C:/My Vault" powershell -NoExit -Command claude "prompt""#
            ),
            vec!["powershell", "-NoExit", "-Command", "claude", "prompt"]
        );
        assert_eq!(
            agent_argv_from_command_line("wt -d C:/vault powershell -NoExit -Command opencode"),
            vec!["powershell", "-NoExit", "-Command", "opencode"]
        );
        assert_eq!(
            agent_argv_from_command_line("claude {path}"),
            vec!["claude", "{path}"]
        );
    }

    #[test]
    fn parses_opencode_models_output() {
        let stdout = "\
anthropic/claude-sonnet-4-5
opencode-go/glm-5.2

checking models...
opencode-go/kimi-k2.7-code
";
        assert_eq!(
            parse_opencode_models(stdout),
            vec![
                "anthropic/claude-sonnet-4-5",
                "opencode-go/glm-5.2",
                "opencode-go/kimi-k2.7-code"
            ]
        );
        assert!(parse_opencode_models("").is_empty());
    }

    #[test]
    fn model_arg_is_inserted_only_when_set() {
        assert_eq!(model_arg(""), "");
        assert_eq!(model_arg("   "), "");
        assert_eq!(model_arg("opus"), " --model opus");
        assert_eq!(
            model_arg("anthropic/claude-sonnet-4-5"),
            " --model anthropic/claude-sonnet-4-5"
        );
        assert_eq!(model_arg("my model"), " --model \"my model\"");
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
