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
    /// Absolute path to the workhub Obsidian vault (task data store). Unset
    /// until the user configures or initializes a vault.
    #[serde(default)]
    pub vault_path: Option<String>,
    /// Root directory under which task worktrees are created, laid out as
    /// `<worktree_root>/<task-id>/<repo-name>`. Used by the worktree panel to
    /// locate task worktrees; the agent's task-start also follows this layout.
    #[serde(default = "default_worktree_root")]
    pub worktree_root: String,
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
            vault_path: None,
            worktree_root: default_worktree_root(),
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
