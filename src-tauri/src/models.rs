use serde::{Deserialize, Serialize};

/// A registered project (one local repository / folder).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    /// Absolute path; also serves as the stable id.
    pub path: String,
    pub name: String,
    #[serde(default)]
    pub tags: String, // comma-separated
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub notes: String,
    /// Unix seconds of the last time this project was opened from Workhub.
    #[serde(default)]
    pub last_opened: Option<u64>,
}

/// A named set of projects that can be selected in one click.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Preset {
    pub name: String,
    pub paths: Vec<String>,
}

/// External command templates. `{path}` is replaced with the project path.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default = "default_vscode_cmd")]
    pub vscode_cmd: String,
    #[serde(default = "default_terminal_cmd")]
    pub terminal_cmd: String,
    #[serde(default = "default_agent_cmd")]
    pub agent_cmd: String,
    #[serde(default = "default_opencode_cmd")]
    pub opencode_cmd: String,
    /// Launch AI agents in a fresh herdr workspace instead of a plain terminal.
    #[serde(default = "default_true")]
    pub use_herdr: bool,
    /// Path or command name for the herdr CLI.
    #[serde(default = "default_herdr_cmd")]
    pub herdr_cmd: String,
    /// Check GitHub Releases for a newer version on startup.
    #[serde(default = "default_true")]
    pub check_updates: bool,
    /// Check the vault template for updates against the current vault on
    /// startup (T-0061). Mirrors `src/types.ts`'s `Settings.check_template_updates`
    /// — see the `settings_field_parity` test below, which fails the build if
    /// the two drift apart again.
    #[serde(default = "default_true")]
    pub check_template_updates: bool,
    /// Notify on startup when the long-term memory engine has not been set
    /// up on this machine yet (T-0060). The notice only points the user at
    /// the `memory-setup` agent skill; the app never installs anything.
    #[serde(default = "default_true")]
    pub check_memory_setup: bool,
    /// Long-term memory hooks in Claude Code sessions (capture + inject).
    /// Read by the plugin hooks from this config file; the app itself only
    /// stores the flag.
    #[serde(default = "default_true")]
    pub memory_claude_code: bool,
    /// Long-term memory adapter in OpenCode sessions (capture + inject).
    /// Read by the vault's OpenCode memory plugin from this config file.
    #[serde(default = "default_true")]
    pub memory_opencode: bool,
    /// Screen-annotation overlay (double-press-and-hold Alt to draw),
    /// including its low-level keyboard hook.
    #[serde(default = "default_true")]
    pub ink_enabled: bool,
    /// Absolute path to the workhub Obsidian vault (task data store). Unset
    /// until the user configures or initializes a vault.
    #[serde(default)]
    pub vault_path: Option<String>,
    /// Root directory under which task worktrees are created, laid out as
    /// `<worktree_root>/<task-id>/<repo-name>`. Used by the worktree panel to
    /// locate task worktrees; the agent's task-start also follows this layout.
    #[serde(default = "default_worktree_root")]
    pub worktree_root: String,
    /// Show the herdr client inside an embedded terminal panel (xterm.js +
    /// ConPTY) in the Tasks view instead of relying on an external Windows
    /// Terminal window. Only meaningful together with `use_herdr`.
    #[serde(default)]
    pub terminal_embed: bool,
    /// Quick capture: global hotkey opens a small always-on-top window that
    /// creates an inbox task from the clipboard.
    #[serde(default = "default_true")]
    pub quick_capture_enabled: bool,
    /// Preferred quick-capture hotkey; fallbacks are tried if taken.
    #[serde(default = "default_quick_capture_shortcut")]
    pub quick_capture_shortcut: String,
    /// Last position/size of the quick-capture window (logical pixels),
    /// carried over to the next open. Unset until first moved/closed.
    #[serde(default)]
    pub quick_capture_rect: Option<WindowRect>,
    /// Voice input: global hotkey toggles local speech-to-text dictation,
    /// pasted into whatever app has focus.
    #[serde(default = "default_true")]
    pub voice_enabled: bool,
    /// Preferred voice-input hotkey; a fallback is tried if taken.
    #[serde(default = "default_voice_hotkey")]
    pub voice_hotkey: String,
    /// Whisper ggml model used for transcription: "tiny" | "base" | "small".
    #[serde(default = "default_voice_model")]
    pub voice_model: String,
    /// Transcription language: "auto" or an ISO code (e.g. "en", "ja").
    #[serde(default = "default_voice_language")]
    pub voice_language: String,
    /// Last dragged position of the voice indicator window (physical
    /// pixels, top-left), carried over to the next show. Unset until the
    /// user first drags it.
    #[serde(default)]
    pub voice_indicator_position: Option<(i32, i32)>,
    /// Language the AI writes the task file's `## Plan` and `## Results`
    /// sections in: "en" | "ja". Content only — never affects code, comments,
    /// commit messages, or other repository artifacts.
    #[serde(default = "default_task_language")]
    pub task_language: String,
    /// Free-form instructions appended to every agent prompt, both when
    /// launching an agent and when copying the prompt (T-0078). Empty by
    /// default. Whitespace is normalized before it is embedded — see
    /// `actions::build_agent_prompt`.
    #[serde(default)]
    pub custom_prompt: String,
    /// Built-in vault-tidy routine (T-0050): periodically files stale inbox
    /// notes and refreshes the tasks/archive index via a headless agent.
    #[serde(default)]
    pub tidy: TidySettings,
}

/// Config for the built-in vault-tidy routine. The scheduler decides *whether*
/// there is work with a cheap mechanical scan (no tokens); only when there is
/// does it launch the agent. Disabled by default so existing installs — and
/// users who prefer a Claude Desktop routine — are unaffected; manual "Run now"
/// works regardless of `enabled`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TidySettings {
    /// Master on/off for the *scheduled* routine (manual runs ignore this).
    #[serde(default)]
    pub enabled: bool,
    /// Which agent CLI to launch: "claude-code" | "opencode".
    #[serde(default = "default_tidy_assignee")]
    pub assignee: String,
    /// Model passed to the agent via `--model`; empty = the agent's default.
    #[serde(default)]
    pub model: String,
    /// Anchor (unix seconds) the interval schedule is phased from. Set to the
    /// current time when the routine is first enabled if still unset.
    #[serde(default)]
    pub anchor: Option<u64>,
    /// Hours between scheduled runs, measured from `anchor`.
    #[serde(default = "default_tidy_interval_hours")]
    pub interval_hours: u32,
    /// Inbox files are only considered once their mtime is at least this many
    /// days old (still-being-edited notes are left alone).
    #[serde(default = "default_tidy_stale_days")]
    pub stale_days: u32,
    /// Inbox subfolders skipped entirely (work-in-progress hold areas).
    #[serde(default = "default_tidy_exclude_dirs")]
    pub exclude_dirs: Vec<String>,
    /// Unix seconds of the last run (scheduled or manual). Drives both the
    /// "slot already consumed" check and the UI's last-run display.
    #[serde(default)]
    pub last_run: Option<u64>,
}

fn default_tidy_assignee() -> String {
    "claude-code".into()
}
fn default_tidy_interval_hours() -> u32 {
    24
}
fn default_tidy_stale_days() -> u32 {
    7
}
fn default_tidy_exclude_dirs() -> Vec<String> {
    vec!["_wip".into()]
}

impl Default for TidySettings {
    fn default() -> Self {
        Self {
            enabled: false,
            assignee: default_tidy_assignee(),
            model: String::new(),
            anchor: None,
            interval_hours: default_tidy_interval_hours(),
            stale_days: default_tidy_stale_days(),
            exclude_dirs: default_tidy_exclude_dirs(),
            last_run: None,
        }
    }
}

/// A window position + size in logical pixels.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct WindowRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

fn default_true() -> bool {
    true
}

fn default_vscode_cmd() -> String {
    "code".into()
}
fn default_terminal_cmd() -> String {
    "wt -d {path}".into()
}
fn default_agent_cmd() -> String {
    "wt -d {path} powershell -NoExit -Command claude".into()
}
fn default_opencode_cmd() -> String {
    "wt -d {path} powershell -NoExit -Command opencode".into()
}
fn default_herdr_cmd() -> String {
    "herdr".into()
}
fn default_worktree_root() -> String {
    "C:/repos/.worktrees".into()
}
fn default_quick_capture_shortcut() -> String {
    "Ctrl+Alt+N".into()
}
fn default_voice_hotkey() -> String {
    "Ctrl+Shift+Space".into()
}
fn default_voice_model() -> String {
    "small".into()
}
fn default_voice_language() -> String {
    "auto".into()
}
fn default_task_language() -> String {
    "en".into()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            vscode_cmd: default_vscode_cmd(),
            terminal_cmd: default_terminal_cmd(),
            agent_cmd: default_agent_cmd(),
            opencode_cmd: default_opencode_cmd(),
            use_herdr: true,
            herdr_cmd: default_herdr_cmd(),
            check_updates: true,
            check_template_updates: true,
            check_memory_setup: true,
            memory_claude_code: true,
            memory_opencode: true,
            ink_enabled: true,
            vault_path: None,
            worktree_root: default_worktree_root(),
            terminal_embed: false,
            quick_capture_enabled: true,
            quick_capture_shortcut: default_quick_capture_shortcut(),
            quick_capture_rect: None,
            voice_enabled: true,
            voice_hotkey: default_voice_hotkey(),
            voice_model: default_voice_model(),
            voice_language: default_voice_language(),
            voice_indicator_position: None,
            task_language: default_task_language(),
            custom_prompt: String::new(),
            tidy: TidySettings::default(),
        }
    }
}

/// A task's frontmatter fields plus location and body — the app's view of
/// one `tasks/<id> <title>.md` file in the vault.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub title: String,
    /// inbox | todo | doing | review | done
    pub status: String,
    /// me | claude-code | opencode
    pub assignee: String,
    #[serde(default)]
    pub project: String,
    /// low | medium | high
    pub priority: String,
    /// AI model passed to the agent CLI via `--model` on task launches
    /// (e.g. "opus", "sonnet", "anthropic/claude-sonnet-4-5"); empty = the
    /// agent's own default.
    #[serde(default)]
    pub model: String,
    /// Manual sort position within a status column (kanban). Fractional so a
    /// single reorder only rewrites the moved task's file; unset on tasks
    /// that were never manually ordered (they sort after ordered ones, by id).
    #[serde(default)]
    pub order: Option<f64>,
    #[serde(default)]
    pub due: String,
    #[serde(default)]
    pub tags: Vec<String>,
    /// Hidden from the board by default; absent in frontmatter means false.
    #[serde(default)]
    pub archived: bool,
    /// Confirm/plan-first mode: when true, an agent launched for this task is
    /// told to draft a plan and get the user's approval before executing
    /// (rather than running autonomously), and the CLI is started without
    /// auto-approve flags. Absent in frontmatter means false.
    #[serde(default)]
    pub confirm: bool,
    /// git worktree mode: when true, an agent launched for this task works in a
    /// dedicated git worktree instead of the repository's main working tree, so
    /// parallel tasks don't collide. Absent in frontmatter means false.
    #[serde(default)]
    pub worktree: bool,
    pub created: String,
    pub updated: String,
    /// Absolute path to the task's Markdown file (forward slashes).
    pub file: String,
    /// Full body text after the closing frontmatter delimiter, verbatim.
    pub body: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum SortMode {
    #[default]
    Name,
    Recent,
}

/// Everything persisted to disk.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Config {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub projects: Vec<Project>,
    #[serde(default)]
    pub presets: Vec<Preset>,
    /// Paths selected when the app was last closed (restored on startup).
    #[serde(default)]
    pub selected: Vec<String>,
    #[serde(default)]
    pub settings: Settings,
    #[serde(default)]
    pub sort: SortMode,
}

/// Live git information for one project (not persisted).
#[derive(Debug, Clone, Default, Serialize)]
pub struct GitInfo {
    pub is_repo: bool,
    pub branch: String,
    pub detached: bool,
    pub has_upstream: bool,
    pub ahead: u32,
    pub behind: u32,
    /// Number of uncommitted changed entries (staged + unstaged + untracked).
    pub changes: u32,
    pub branches: Vec<String>,
    pub error: Option<String>,
}

/// One git worktree of a registered repo (not persisted). Task worktrees are
/// created by agents on a `task/<id>` branch; `task_id` is derived from that
/// branch name.
#[derive(Debug, Clone, Serialize)]
pub struct Worktree {
    /// Absolute path of the worktree (forward slashes).
    pub path: String,
    /// Absolute path of the owning repo (the registered project path).
    pub repo_path: String,
    /// Display name of the owning repo.
    pub repo_name: String,
    /// Checked-out branch (short name); empty when detached or bare.
    pub branch: String,
    pub head: String,
    /// True for the repo's primary working tree (not a task worktree).
    pub is_main: bool,
    pub bare: bool,
    pub locked: bool,
    pub detached: bool,
    /// Has uncommitted or untracked changes (only computed for linked worktrees).
    pub dirty: bool,
    /// Task id parsed from a `task/<id>` branch, if any.
    pub task_id: Option<String>,
}

/// A branch/remote/tag/HEAD decoration attached to a commit.
#[derive(Debug, Clone, Serialize)]
pub struct CommitRef {
    pub name: String,
    /// "branch" | "remote" | "tag" | "head"
    pub kind: String,
    pub is_head: bool,
}

/// One row of `git log` output.
#[derive(Debug, Clone, Serialize)]
pub struct CommitEntry {
    pub hash: String,
    pub parents: Vec<String>,
    pub author: String,
    pub date: i64,
    pub refs: Vec<CommitRef>,
    pub subject: String,
}

/// One changed file within a commit, for the graph view's diff panel.
#[derive(Debug, Clone, Serialize)]
pub struct CommitFileChange {
    pub path: String,
    /// Original path for renames/copies.
    pub old_path: Option<String>,
    /// Single-letter status: "A" | "M" | "D" | "R" | "C" | "T" | "U" (untracked).
    pub status: String,
    /// Added/removed line counts; `None` for binary files.
    pub additions: Option<u32>,
    pub deletions: Option<u32>,
}

/// A page of commit history plus repo-level context for the graph view.
#[derive(Debug, Clone, Default, Serialize)]
pub struct GitLog {
    pub commits: Vec<CommitEntry>,
    pub head: String,
    pub current_branch: String,
    pub uncommitted: u32,
    pub has_more: bool,
}

/// Local and remote branch names for the graph-view branch switcher.
#[derive(Debug, Clone, Default, Serialize)]
pub struct BranchList {
    pub local: Vec<String>,
    pub remote: Vec<String>,
    pub current: String,
}

/// A graph-view git operation. Parameters vary per kind, so this is dispatched
/// via a tagged enum rather than a free-form op string (see `git_op`).
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum GraphOp {
    Checkout {
        branch: String,
    },
    CheckoutCommit {
        hash: String,
    },
    DiscardChanges {
        include_untracked: bool,
    },
    CreateBranch {
        name: String,
        hash: String,
        checkout: bool,
    },
    DeleteBranch {
        name: String,
        force: bool,
    },
    Merge {
        branch: String,
    },
    Rebase {
        branch: String,
    },
    Push,
    Pull,
    Fetch,
    Reset {
        hash: String,
        mode: String,
    },
    CherryPick {
        hash: String,
    },
    CreateTag {
        name: String,
        hash: String,
    },
    DeleteTag {
        name: String,
    },
}

#[cfg(test)]
mod settings_parity_tests {
    use super::Settings;
    use std::collections::BTreeSet;

    /// Extracts the matching `{ ... }` body for `interface Settings` out of a
    /// TypeScript source string via simple brace counting from the first
    /// occurrence of `interface Settings {`. Returns `None` if the interface
    /// isn't found or the braces never balance.
    fn extract_interface_body(source: &str, interface_name: &str) -> Option<String> {
        let needle = format!("interface {interface_name} {{");
        let start = source.find(&needle)? + needle.len();
        let mut depth = 1i32;
        let mut end = start;
        for (i, ch) in source[start..].char_indices() {
            match ch {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        end = start + i;
                        break;
                    }
                }
                _ => {}
            }
        }
        if depth != 0 {
            return None;
        }
        Some(source[start..end].to_string())
    }

    /// Strips `/* ... */` block comments (including `/** ... */` JSDoc), then
    /// `// ...` line comments, then reads one field name per remaining
    /// non-empty line (text before `:` or `?:`). Deliberately simple — this
    /// only needs to handle the flat `Settings` interface, which has no
    /// nested braces or inline object types.
    fn field_names(body: &str) -> BTreeSet<String> {
        let mut no_block_comments = String::with_capacity(body.len());
        let mut rest = body;
        while let Some(start) = rest.find("/*") {
            no_block_comments.push_str(&rest[..start]);
            rest = match rest[start..].find("*/") {
                Some(end) => &rest[start + end + 2..],
                None => "",
            };
        }
        no_block_comments.push_str(rest);

        no_block_comments
            .lines()
            .filter_map(|line| {
                let line = match line.find("//") {
                    Some(idx) => &line[..idx],
                    None => line,
                };
                let line = line.trim();
                if line.is_empty() {
                    return None;
                }
                let name = line.split(':').next().unwrap_or("").trim();
                let name = name.trim_end_matches('?');
                if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
                    return None;
                }
                Some(name.to_string())
            })
            .collect()
    }

    /// Guards against the exact regression in T-0064: a field added to the TS
    /// `Settings` type (`src/types.ts`) without a matching field in the Rust
    /// `Settings` struct is silently dropped by serde on every save, with no
    /// compiler or `cargo test`/`npm run build` error otherwise. Skips (does
    /// not fail) when `src/types.ts` can't be found, e.g. in a packaging
    /// context where the frontend source isn't checked out alongside
    /// `src-tauri/`.
    #[test]
    fn settings_field_parity_with_types_ts() {
        let ts_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/types.ts");
        let Ok(source) = std::fs::read_to_string(&ts_path) else {
            eprintln!(
                "skipping settings_field_parity_with_types_ts: could not read {}",
                ts_path.display()
            );
            return;
        };
        let Some(body) = extract_interface_body(&source, "Settings") else {
            eprintln!(
                "skipping settings_field_parity_with_types_ts: no `interface Settings {{ ... }}` found in {}",
                ts_path.display()
            );
            return;
        };
        let ts_fields = field_names(&body);

        let rust_value = serde_json::to_value(Settings::default()).expect("serialize Settings");
        let rust_fields: BTreeSet<String> = rust_value
            .as_object()
            .expect("Settings serializes to an object")
            .keys()
            .cloned()
            .collect();

        let missing_in_rust: Vec<_> = ts_fields.difference(&rust_fields).collect();
        let missing_in_ts: Vec<_> = rust_fields.difference(&ts_fields).collect();

        assert!(
            missing_in_rust.is_empty() && missing_in_ts.is_empty(),
            "Settings field mismatch between src-tauri/src/models.rs and src/types.ts:\n\
             fields in src/types.ts but missing from Rust Settings: {missing_in_rust:?}\n\
             fields in Rust Settings but missing from src/types.ts: {missing_in_ts:?}"
        );
    }
}
