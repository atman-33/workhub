//! Task Markdown parsing/writing, vault file watching, and the
//! `_ai/index/tasks.json` machine-readable index.
//!
//! The vault is the source of truth (see `vault-template/CLAUDE.md`): every
//! task is one `tasks/<id> <title>.md` file with a YAML-ish frontmatter
//! block. Frontmatter here uses a fixed, known schema (see `Task` in
//! `models.rs`), so rather than pull in a general YAML crate we hand-roll a
//! small parser/writer for exactly that shape. This keeps the round-trip
//! guarantee simple to reason about: the body (everything after the closing
//! `---`) is captured verbatim and never touched unless the caller explicitly
//! supplies a replacement.

use crate::models::Task;
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use similar::TextDiff;
use std::collections::HashMap;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::RecvTimeoutError;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const TASKS_CHANGED_EVENT: &str = "tasks-changed";
/// Emitted when a `projects/*/schedules/*.md` file changes, so the Schedule
/// view reloads after an Obsidian or agent edit (T-0088).
const SCHEDULES_CHANGED_EVENT: &str = "schedules-changed";
const DEBOUNCE: Duration = Duration::from_millis(300);

fn tasks_dir(vault: &Path) -> PathBuf {
    vault.join("tasks")
}

/// Archived tasks are relocated here (a subfolder of `tasks/`) so the flat
/// `tasks/` listing stays uncluttered in Obsidian/Explorer. The `archived:
/// true` frontmatter flag remains the logical source of truth; the folder is
/// kept in sync with it on every write (see `relocate_for_archive_state`).
const ARCHIVE_SUBDIR: &str = "archive";

fn archive_dir(vault: &Path) -> PathBuf {
    tasks_dir(vault).join(ARCHIVE_SUBDIR)
}

fn index_file(vault: &Path) -> PathBuf {
    vault.join("_ai").join("index").join("tasks.json")
}

/// Normalizes a path to forward slashes for cross-separator comparison
/// (`Task.file` is always stored with `/`, while `Path::join` yields `\` on
/// Windows).
fn norm_path(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

// ---------------------------------------------------------------------
// frontmatter parsing / rendering
// ---------------------------------------------------------------------

/// Splits `---\n<frontmatter>\n---\n<body>` into (frontmatter text, body).
/// The body is the exact remainder of the file, byte-for-byte.
fn split_frontmatter(content: &str) -> Result<(String, String), String> {
    let mut lines = content.split_inclusive('\n');
    let first = lines.next().unwrap_or("");
    if first.trim_end_matches(['\r', '\n']) != "---" {
        return Err("file does not start with a frontmatter block".into());
    }
    let mut consumed = first.len();
    let mut front = String::new();
    let mut closed = false;
    for line in lines {
        consumed += line.len();
        if line.trim_end_matches(['\r', '\n']) == "---" {
            closed = true;
            break;
        }
        front.push_str(line);
    }
    if !closed {
        return Err("frontmatter block is not closed".into());
    }
    let body = content[consumed..].to_string();
    Ok((front, body))
}

fn unquote(s: &str) -> String {
    let s = s.trim();
    if s.len() >= 2 {
        let bytes = s.as_bytes();
        if (bytes[0] == b'"' && bytes[s.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[s.len() - 1] == b'\'')
        {
            return s[1..s.len() - 1].to_string();
        }
    }
    s.to_string()
}

struct RawFrontmatter {
    map: HashMap<String, String>,
    tags: Vec<String>,
}

fn parse_frontmatter(front: &str) -> RawFrontmatter {
    let mut map = HashMap::new();
    let mut tags = Vec::new();
    let mut in_tags_block = false;
    for raw_line in front.lines() {
        let line = raw_line.trim_end();
        if in_tags_block {
            let trimmed = line.trim_start();
            if let Some(rest) = trimmed.strip_prefix("- ") {
                tags.push(unquote(rest.trim()));
                continue;
            } else if trimmed.is_empty() {
                continue;
            } else {
                in_tags_block = false; // fall through to normal key parsing
            }
        }
        let Some(idx) = line.find(':') else { continue };
        let key = line[..idx].trim().to_string();
        let val = line[idx + 1..].trim();
        if key == "tags" {
            if val.is_empty() {
                in_tags_block = true;
                tags.clear();
            } else if let Some(inner) = val.strip_prefix('[').and_then(|v| v.strip_suffix(']')) {
                tags = inner
                    .split(',')
                    .map(|s| unquote(s.trim()))
                    .filter(|s| !s.is_empty())
                    .collect();
            } else {
                tags = vec![unquote(val)];
            }
        } else {
            map.insert(key, unquote(val));
        }
    }
    RawFrontmatter { map, tags }
}

/// Quotes a scalar only if it contains characters that would otherwise
/// confuse a YAML/Obsidian reader (colon, hash, brackets, leading/trailing
/// whitespace, or is empty).
fn yaml_scalar(s: &str) -> String {
    let needs_quote = s.is_empty()
        || s.contains(':')
        || s.contains('#')
        || s.contains('[')
        || s.contains(']')
        || s.contains(',')
        || s != s.trim();
    if needs_quote {
        format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
    } else {
        s.to_string()
    }
}

fn render_tags(tags: &[String]) -> String {
    if tags.is_empty() {
        "[]".to_string()
    } else {
        format!(
            "[{}]",
            tags.iter()
                .map(|t| yaml_scalar(t))
                .collect::<Vec<_>>()
                .join(", ")
        )
    }
}

/// Renders an `order` float without a trailing `.0` for whole numbers, so
/// hand-edited files stay tidy (`order: 3`, not `order: 3.0`).
fn render_order(order: f64) -> String {
    if order.fract() == 0.0 && order.abs() < 1e15 {
        format!("{}", order as i64)
    } else {
        format!("{order}")
    }
}

fn render_frontmatter(t: &Task) -> String {
    let order_line = t
        .order
        .map(|o| format!("order: {}\n", render_order(o)))
        .unwrap_or_default();
    // Emitted only when set, like `order`, so files never archived stay
    // byte-identical on round-trip.
    let archived_line = if t.archived { "archived: true\n" } else { "" };
    // Same policy for the per-task launch flags: only emitted when enabled, so
    // files that never opt in stay byte-identical on round-trip.
    let confirm_line = if t.confirm { "confirm: true\n" } else { "" };
    let worktree_line = if t.worktree { "worktree: true\n" } else { "" };
    // Same policy: only tasks that specify a model carry the line.
    let model_line = if t.model.is_empty() {
        String::new()
    } else {
        format!("model: {}\n", yaml_scalar(&t.model))
    };
    format!(
        "---\nid: {}\ntitle: {}\nstatus: {}\nassignee: {}\nproject: {}\npriority: {}\n{}{}due: {}\ntags: {}\n{}{}{}created: {}\nupdated: {}\n---\n",
        t.id,
        yaml_scalar(&t.title),
        t.status,
        t.assignee,
        yaml_scalar(&t.project),
        t.priority,
        model_line,
        order_line,
        t.due,
        render_tags(&t.tags),
        archived_line,
        confirm_line,
        worktree_line,
        t.created,
        t.updated,
    )
}

fn parse_task_file(path: &Path) -> Result<Task, String> {
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let (front, body) = split_frontmatter(&content)?;
    let raw = parse_frontmatter(&front);
    let get = |k: &str| raw.map.get(k).cloned().unwrap_or_default();
    Ok(Task {
        id: get("id"),
        title: get("title"),
        status: {
            let v = get("status");
            if v.is_empty() {
                "inbox".into()
            } else {
                v
            }
        },
        assignee: {
            let v = get("assignee");
            if v.is_empty() {
                "me".into()
            } else {
                v
            }
        },
        project: get("project"),
        priority: {
            let v = get("priority");
            if v.is_empty() {
                "medium".into()
            } else {
                v
            }
        },
        model: get("model"),
        order: raw.map.get("order").and_then(|v| v.parse::<f64>().ok()),
        due: get("due"),
        tags: raw.tags,
        archived: raw
            .map
            .get("archived")
            .map(|v| v == "true")
            .unwrap_or(false),
        confirm: raw.map.get("confirm").map(|v| v == "true").unwrap_or(false),
        worktree: raw
            .map
            .get("worktree")
            .map(|v| v == "true")
            .unwrap_or(false),
        created: get("created"),
        updated: get("updated"),
        file: path.to_string_lossy().replace('\\', "/"),
        body,
    })
}

/// Writes a task back to disk, rewriting only the frontmatter block. The
/// body is whatever is currently held on `task.body` — callers that did not
/// intend to change it must have preserved it from a prior parse, so the
/// file round-trips byte-for-byte outside the frontmatter block.
fn write_task_file(task: &Task) -> Result<(), String> {
    let content = format!("{}{}", render_frontmatter(task), task.body);
    fs::write(&task.file, content).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------
// scanning / id assignment
// ---------------------------------------------------------------------

pub fn scan_tasks(vault: &Path) -> Result<Vec<Task>, String> {
    let mut out = Vec::new();
    // `tasks/` holds active tasks; `tasks/archive/` holds archived ones. Both
    // are scanned so archived tasks still reserve their id (see `next_id`),
    // stay in the index, and remain findable for unarchiving. Reading `tasks/`
    // non-recursively skips the `archive/` subdirectory itself (it has no `.md`
    // extension), so the two passes never double-count.
    scan_dir_into(&tasks_dir(vault), &mut out)?;
    scan_dir_into(&archive_dir(vault), &mut out)?;
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

/// Parses every `*.md` task file directly inside `dir` (non-recursive) and
/// appends them to `out`. Missing directories and unparsable files are skipped
/// rather than failing the whole scan.
fn scan_dir_into(dir: &Path, out: &mut Vec<Task>) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        if path.file_name().and_then(|n| n.to_str()) == Some("_index.md") {
            continue;
        }
        match parse_task_file(&path) {
            Ok(task) => out.push(task),
            Err(_) => continue, // skip unparsable/non-task files rather than fail the whole scan
        }
    }
    Ok(())
}

fn next_id(existing: &[Task]) -> String {
    let max = existing
        .iter()
        .filter_map(|t| t.id.strip_prefix("T-"))
        .filter_map(|n| n.parse::<u32>().ok())
        .max()
        .unwrap_or(0);
    format!("T-{:04}", max + 1)
}

fn today() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = (secs / 86_400) as i64;
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Howard Hinnant's `civil_from_days`: days-since-epoch -> (year, month, day).
/// Avoids pulling in a full date/time crate for a single "today" stamp.
fn civil_from_days(z: i64) -> (i32, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m, d)
}

fn sanitize_filename(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() {
        "untitled".to_string()
    } else {
        trimmed.to_string()
    }
}

// ---------------------------------------------------------------------
// create / update
// ---------------------------------------------------------------------

#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskInput {
    pub title: String,
    pub status: Option<String>,
    pub assignee: Option<String>,
    pub project: Option<String>,
    pub priority: Option<String>,
    pub model: Option<String>,
    pub confirm: Option<bool>,
    pub worktree: Option<bool>,
    pub due: Option<String>,
    pub tags: Option<Vec<String>>,
    pub body: Option<String>,
}

/// Next `order` value for a task appended to the end of a status column.
fn next_order(existing: &[Task], status: &str) -> f64 {
    existing
        .iter()
        .filter(|t| t.status == status)
        .filter_map(|t| t.order)
        .fold(0.0_f64, f64::max)
        + 1.0
}

#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskInput {
    pub id: String,
    pub title: Option<String>,
    pub status: Option<String>,
    pub assignee: Option<String>,
    pub project: Option<String>,
    pub priority: Option<String>,
    pub model: Option<String>,
    pub order: Option<f64>,
    pub due: Option<String>,
    pub tags: Option<Vec<String>>,
    pub archived: Option<bool>,
    pub confirm: Option<bool>,
    pub worktree: Option<bool>,
    pub body: Option<String>,
}

pub fn create_task(vault: &Path, input: CreateTaskInput) -> Result<Task, String> {
    let dir = tasks_dir(vault);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let existing = scan_tasks(vault)?;
    let id = next_id(&existing);
    let filename = format!("{id} {}.md", sanitize_filename(&input.title));
    let file = dir.join(&filename);
    let now = today();
    let status = input.status.unwrap_or_else(|| "inbox".into());
    let order = next_order(&existing, &status);
    let task = Task {
        id,
        title: input.title,
        status,
        assignee: input.assignee.unwrap_or_else(|| "me".into()),
        project: input.project.unwrap_or_default(),
        priority: input.priority.unwrap_or_else(|| "medium".into()),
        model: input.model.unwrap_or_default(),
        order: Some(order),
        due: input.due.unwrap_or_default(),
        tags: input.tags.unwrap_or_default(),
        archived: false,
        confirm: input.confirm.unwrap_or(false),
        worktree: input.worktree.unwrap_or(false),
        created: now.clone(),
        updated: now,
        file: file.to_string_lossy().replace('\\', "/"),
        body: input
            .body
            .unwrap_or_else(|| "\n## Description\n\n## Plan\n\n## Results\n".to_string()),
    };
    write_task_file(&task)?;
    regenerate_index(vault)?;
    Ok(task)
}

fn find_task_by_id(vault: &Path, id: &str) -> Result<Task, String> {
    let prefix = format!("{id} ");
    // An archived task lives under `tasks/archive/`, so both directories must
    // be searched (e.g. to unarchive it or edit it while archived).
    for dir in [tasks_dir(vault), archive_dir(vault)] {
        if !dir.exists() {
            continue;
        }
        for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if name.starts_with(&prefix) && name.ends_with(".md") {
                return parse_task_file(&path);
            }
        }
    }
    Err(format!("task {id} not found"))
}

pub fn update_task(vault: &Path, input: UpdateTaskInput) -> Result<Task, String> {
    let mut task = find_task_by_id(vault, &input.id)?;
    if let Some(v) = input.title {
        task.title = v;
    }
    if let Some(v) = input.status {
        task.status = v;
    }
    if let Some(v) = input.assignee {
        task.assignee = v;
    }
    if let Some(v) = input.project {
        task.project = v;
    }
    if let Some(v) = input.priority {
        task.priority = v;
    }
    if let Some(v) = input.model {
        task.model = v;
    }
    if let Some(v) = input.order {
        task.order = Some(v);
    }
    if let Some(v) = input.due {
        task.due = v;
    }
    if let Some(v) = input.tags {
        task.tags = v;
    }
    if let Some(v) = input.archived {
        task.archived = v;
    }
    if let Some(v) = input.confirm {
        task.confirm = v;
    }
    if let Some(v) = input.worktree {
        task.worktree = v;
    }
    if let Some(v) = input.body {
        task.body = v;
    }
    task.updated = today();
    // Keep the file's folder in sync with its archived state before writing,
    // so archived tasks move into `tasks/archive/` and unarchived ones move
    // back to `tasks/`.
    relocate_for_archive_state(vault, &mut task)?;
    write_task_file(&task)?;
    regenerate_index(vault)?;
    Ok(task)
}

/// Ensures `task.file` sits in the directory matching its archived state
/// (`tasks/archive/` when archived, `tasks/` otherwise), moving the file on
/// disk and updating `task.file` when they disagree. The basename is
/// preserved. A no-op when the file is already in the right place, so it is
/// safe to call on every update.
fn relocate_for_archive_state(vault: &Path, task: &mut Task) -> Result<(), String> {
    let current = PathBuf::from(&task.file);
    let Some(file_name) = current.file_name().map(|n| n.to_owned()) else {
        return Ok(());
    };
    let target_dir = if task.archived {
        archive_dir(vault)
    } else {
        tasks_dir(vault)
    };
    let target = target_dir.join(&file_name);
    if norm_path(&target) == norm_path(&current) {
        return Ok(());
    }
    fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
    if current.exists() {
        fs::rename(&current, &target).map_err(|e| e.to_string())?;
    }
    task.file = norm_path(&target);
    Ok(())
}

/// One-shot, idempotent migration that relocates any task whose on-disk folder
/// no longer matches its archived state — archived files still sitting flat in
/// `tasks/`, or (rarely) unarchived files stranded in `tasks/archive/`. The
/// frontmatter is untouched; only the file moves. Best-effort and safe to run
/// on every vault load, so existing vaults heal without a manual step.
pub fn migrate_archived_layout(vault: &Path) -> Result<(), String> {
    let tasks = scan_tasks(vault)?;
    let mut moved = false;
    for mut task in tasks {
        let before = task.file.clone();
        relocate_for_archive_state(vault, &mut task)?;
        if task.file != before {
            moved = true;
        }
    }
    if moved {
        regenerate_index(vault)?;
    }
    Ok(())
}

/// Moves the task's file to the OS recycle bin (never a hard delete) and
/// refreshes the index. When the task can't be found the index is still
/// regenerated best-effort so a stale entry self-heals.
pub fn delete_task(vault: &Path, id: &str) -> Result<(), String> {
    let task = match find_task_by_id(vault, id) {
        Ok(t) => t,
        Err(e) => {
            let _ = regenerate_index(vault);
            return Err(e);
        }
    };
    trash::delete(&task.file).map_err(|e| e.to_string())?;
    regenerate_index(vault)
}

// ---------------------------------------------------------------------
// index
// ---------------------------------------------------------------------

#[derive(Serialize)]
struct IndexEntry<'a> {
    id: &'a str,
    title: &'a str,
    status: &'a str,
    assignee: &'a str,
    project: &'a str,
    priority: &'a str,
    model: &'a str,
    order: Option<f64>,
    due: &'a str,
    tags: &'a [String],
    archived: bool,
    confirm: bool,
    worktree: bool,
    created: &'a str,
    updated: &'a str,
    file: String,
}

pub fn regenerate_index(vault: &Path) -> Result<(), String> {
    let tasks = scan_tasks(vault)?;
    let vault_prefix = vault.to_string_lossy().replace('\\', "/");
    let entries: Vec<IndexEntry> = tasks
        .iter()
        .map(|t| IndexEntry {
            id: &t.id,
            title: &t.title,
            status: &t.status,
            assignee: &t.assignee,
            project: &t.project,
            priority: &t.priority,
            model: &t.model,
            order: t.order,
            due: &t.due,
            tags: &t.tags,
            archived: t.archived,
            confirm: t.confirm,
            worktree: t.worktree,
            created: &t.created,
            updated: &t.updated,
            file: t
                .file
                .strip_prefix(&vault_prefix)
                .unwrap_or(&t.file)
                .trim_start_matches('/')
                .to_string(),
        })
        .collect();
    let path = index_file(vault);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let body = serde_json::to_string_pretty(&entries).map_err(|e| e.to_string())?;
    fs::write(&path, body).map_err(|e| e.to_string())
}

/// Convenience for the `list_tasks` command: scan and keep the index fresh
/// in the same call, since a scan already has everything the index needs.
pub fn scan_and_index(vault: &Path) -> Result<Vec<Task>, String> {
    let tasks = scan_tasks(vault)?;
    let _ = regenerate_index(vault);
    Ok(tasks)
}

// ---------------------------------------------------------------------
// vault init + template sync (vault-template/, embedded in the binary)
// ---------------------------------------------------------------------
//
// The template used to be copied from a filesystem path and kept in sync via
// an HTML-comment marker in each managed file (`workhub-template: version=N`).
// That broke down in practice: the marker version never advanced past the
// files that first shipped it, JSON files can't carry an HTML comment, and a
// packaged single-exe build has no filesystem copy of `vault-template/` to
// diff against.
//
// The replacement: `vault-template/` is embedded into the binary at compile
// time (`include_dir!`), and a `_ai/template-manifest.json` file records, per
// relative path, the sha256 of the template content that was last applied to
// this vault (the "baseline"). `check_vault_template` does a 3-way compare of
// (current vault content, baseline, new template content) to classify each
// file; `apply_vault_template` applies a caller-chosen subset and updates the
// baseline to match.

use include_dir::{include_dir, Dir};
use sha2::{Digest, Sha256};

static VAULT_TEMPLATE: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../vault-template");

/// Name of the data-driven classification file living at the template root.
/// Never copied into a vault (see `walk_template_files`).
const TEMPLATE_POLICY_FILE: &str = ".template-policy.json";

/// Bumped whenever the manifest's meaning changes in a way that makes
/// previously written `files` baselines untrustworthy. See `load_manifest`.
const MANIFEST_SCHEMA_VERSION: u32 = 1;

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

/// Recursively collects every embedded template file, skipping `node_modules`
/// directories and files that are never actually part of a vault's copy of
/// the template: the per-vault `.claude-plugin-sync-manifest.json` and the
/// template's own classification file (`.template-policy.json`).
fn walk_template_files<'a>(dir: &'a Dir<'a>, out: &mut Vec<&'a include_dir::File<'a>>) {
    for file in dir.files() {
        let name = file.path().file_name().and_then(|n| n.to_str());
        if name == Some(".claude-plugin-sync-manifest.json") || name == Some(TEMPLATE_POLICY_FILE) {
            continue;
        }
        out.push(file);
    }
    for sub in dir.dirs() {
        if sub.path().file_name().and_then(|n| n.to_str()) == Some("node_modules") {
            continue;
        }
        walk_template_files(sub, out);
    }
}

/// Data-driven replacement for the old `INITIAL_ONLY_PATHS` const: paths
/// (repo-relative to the template root) that are seeded into a vault only
/// when missing and are otherwise excluded from the manifest and every
/// `TemplateDiff` — there is nothing to "update" about them, so they can
/// never be silently overwritten by a template sync.
#[derive(Debug, Default, serde::Deserialize)]
struct TemplatePolicy {
    #[serde(default)]
    seed_only: Vec<String>,
}

/// Collects every path `walk_template_files` would embed, used as the safe
/// fallback when the policy file is missing or unparseable: treating every
/// file as seed-only means a template sync can only ever add missing files,
/// never overwrite one that already exists.
fn all_template_paths(template: &Dir) -> HashSet<String> {
    let mut files = Vec::new();
    walk_template_files(template, &mut files);
    files.into_iter().map(|f| norm_path(f.path())).collect()
}

/// Loads the `seed_only` path set from `.template-policy.json` at the
/// template root. Missing or unparseable policy data falls back to treating
/// every template file as seed-only (the safe direction — never overwrite)
/// and logs the reason to stderr.
fn load_template_policy(template: &Dir) -> HashSet<String> {
    let Some(file) = template.get_file(TEMPLATE_POLICY_FILE) else {
        eprintln!(
            "workhub: {TEMPLATE_POLICY_FILE} not found in template; treating every \
             template file as seed-only (safe default)"
        );
        return all_template_paths(template);
    };

    let parsed = std::str::from_utf8(file.contents())
        .ok()
        .and_then(|s| serde_json::from_str::<TemplatePolicy>(s).ok());

    match parsed {
        Some(policy) => policy.seed_only.into_iter().collect(),
        None => {
            eprintln!(
                "workhub: {TEMPLATE_POLICY_FILE} is unparseable; treating every \
                 template file as seed-only (safe default)"
            );
            all_template_paths(template)
        }
    }
}

fn manifest_path(vault: &Path) -> PathBuf {
    vault.join("_ai").join("template-manifest.json")
}

#[derive(Debug, Default, Serialize, serde::Deserialize)]
struct TemplateManifest {
    #[serde(default)]
    schema_version: u32,
    app_version: String,
    files: HashMap<String, String>,
}

/// Loads the manifest, discarding recorded baselines from schema versions
/// older than [`MANIFEST_SCHEMA_VERSION`] (including the implicit version 0
/// of a manifest with no `schema_version` field at all, written by <= 0.49.0
/// — see the `init_from` doc comment for why those baselines cannot be
/// trusted). Dropping `files` makes `diff_against` fall into its "no
/// baseline" branch, which is the safe outcome: a file that actually
/// diverged from the template reports `Conflict` instead of a clean
/// `Updatable` overwrite.
fn load_manifest(vault: &Path) -> TemplateManifest {
    let manifest: TemplateManifest = fs::read_to_string(manifest_path(vault))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    if manifest.schema_version < MANIFEST_SCHEMA_VERSION {
        TemplateManifest {
            schema_version: MANIFEST_SCHEMA_VERSION,
            app_version: manifest.app_version,
            files: HashMap::new(),
        }
    } else {
        manifest
    }
}

fn write_manifest(vault: &Path, manifest: &TemplateManifest) -> Result<(), String> {
    let path = manifest_path(vault);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let body = serde_json::to_string_pretty(manifest).map_err(|e| e.to_string())?;
    fs::write(&path, body).map_err(|e| e.to_string())
}

/// Per-file classification produced by [`check_vault_template`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TemplateFileState {
    /// Not present in the vault; safe to add.
    Added,
    /// Vault content matches the recorded baseline and the template changed;
    /// safe to overwrite.
    Updatable,
    /// Vault content diverged from the baseline (hand-edited) and the
    /// template also changed; do not auto-apply.
    Conflict,
    /// No effective change to apply.
    UpToDate,
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct TemplateFileDiff {
    pub path: String,
    pub state: TemplateFileState,
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct TemplateDiff {
    pub files: Vec<TemplateFileDiff>,
}

/// Copies the embedded `vault-template/` into `vault`, creating directories as
/// needed, then writes `_ai/template-manifest.json` recording a baseline for
/// every non-seed-only file whose on-disk content is confirmed to match the
/// template.
///
/// Existing files are never overwritten by this call — re-running it against
/// an already-initialized vault only fills in files that are still missing.
/// A pre-existing file whose content differs from the just-embedded template
/// (e.g. a user-customized `.claude/project-context.json`) intentionally gets
/// **no** baseline recorded: recording the on-disk content as the baseline
/// would make `diff_against` see `current == baseline` on the next check and
/// misclassify the next upstream template change as a clean `Updatable`
/// overwrite, silently destroying the user's edits (see `CHANGELOG.md`, the
/// data-loss incident this guarded against). Leaving the baseline absent
/// instead falls into `diff_against`'s "no baseline" branch, which correctly
/// reports `Conflict` for a file that differs from the template.
pub fn init_vault(vault: &Path) -> Result<(), String> {
    init_from(vault, &VAULT_TEMPLATE)
}

fn init_from(vault: &Path, template: &Dir) -> Result<(), String> {
    fs::create_dir_all(vault).map_err(|e| e.to_string())?;

    let mut files = Vec::new();
    walk_template_files(template, &mut files);
    let seed_only = load_template_policy(template);

    let mut manifest = TemplateManifest {
        schema_version: MANIFEST_SCHEMA_VERSION,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        files: HashMap::new(),
    };

    for file in files {
        let rel = norm_path(file.path());
        let dst_path = vault.join(file.path());
        if let Some(parent) = dst_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let existed_before = dst_path.exists();
        if !existed_before {
            fs::write(&dst_path, file.contents()).map_err(|e| e.to_string())?;
        }

        if seed_only.contains(&rel) {
            continue;
        }

        if existed_before {
            // Only record a baseline when the pre-existing file actually
            // matches the template — never when it merely happens to be
            // whatever was already on disk (see the doc comment above).
            let on_disk = fs::read(&dst_path).map_err(|e| e.to_string())?;
            if on_disk == file.contents() {
                manifest.files.insert(rel, sha256_hex(&on_disk));
            }
        } else {
            // Freshly created: on-disk content is exactly the template's, so
            // recording it as the baseline is always safe.
            manifest.files.insert(rel, sha256_hex(file.contents()));
        }
    }

    write_manifest(vault, &manifest)
}

/// 3-way compares every non-seed-only template file against the vault's
/// current content and the last-applied baseline recorded in the manifest.
///
/// - `Added`: the vault does not have this file at all.
/// - Otherwise, compare `current` (on disk), `baseline` (manifest), `new`
///   (embedded template):
///   - no baseline recorded: `UpToDate` if `current == new`, else `Conflict`
///     (safer default for a vault that predates the manifest).
///   - `new == baseline`: nothing changed upstream — `UpToDate`.
///   - `current == baseline`: only the template changed — `Updatable`.
///   - otherwise: both diverged — `Conflict`.
pub fn check_vault_template(vault: &Path) -> Result<TemplateDiff, String> {
    diff_against(vault, &VAULT_TEMPLATE)
}

fn diff_against(vault: &Path, template: &Dir) -> Result<TemplateDiff, String> {
    let manifest = load_manifest(vault);

    let mut files = Vec::new();
    walk_template_files(template, &mut files);
    let seed_only = load_template_policy(template);

    let mut entries = Vec::new();
    for file in files {
        let rel = norm_path(file.path());
        if seed_only.contains(&rel) {
            continue;
        }

        let new_hash = sha256_hex(file.contents());
        let dst_path = vault.join(file.path());

        let state = if !dst_path.exists() {
            TemplateFileState::Added
        } else {
            let current = fs::read(&dst_path).map_err(|e| e.to_string())?;
            let current_hash = sha256_hex(&current);
            match manifest.files.get(&rel) {
                None => {
                    if current_hash == new_hash {
                        TemplateFileState::UpToDate
                    } else {
                        TemplateFileState::Conflict
                    }
                }
                Some(baseline_hash) => {
                    if new_hash == *baseline_hash {
                        TemplateFileState::UpToDate
                    } else if current_hash == *baseline_hash {
                        TemplateFileState::Updatable
                    } else {
                        TemplateFileState::Conflict
                    }
                }
            }
        };

        entries.push(TemplateFileDiff { path: rel, state });
    }

    Ok(TemplateDiff { files: entries })
}

/// Applies the embedded template content for exactly the given relative
/// paths. A path currently in `Conflict` is written beside the original as
/// `<name>.new` instead, leaving the vault's file untouched — unless the
/// caller listed it in `overwrite`, in which case the user explicitly chose
/// to discard their local edits and the template content is written in place
/// like any other path. Every other requested path is overwritten/created in
/// place. The manifest baseline is then updated for every path that was
/// actually written in place (a `.new`-resolved Conflict keeps its previous
/// baseline, since the vault's file did not change). Unknown paths (not part
/// of the template, or seed-only) are silently skipped.
pub fn apply_vault_template(
    vault: &Path,
    paths: &[String],
    overwrite: &[String],
) -> Result<(), String> {
    apply_from(vault, &VAULT_TEMPLATE, paths, overwrite)
}

fn apply_from(
    vault: &Path,
    template: &Dir,
    paths: &[String],
    overwrite: &[String],
) -> Result<(), String> {
    let diff = diff_against(vault, template)?;
    let states: HashMap<&str, TemplateFileState> = diff
        .files
        .iter()
        .map(|f| (f.path.as_str(), f.state))
        .collect();

    let mut manifest = load_manifest(vault);
    manifest.schema_version = MANIFEST_SCHEMA_VERSION;
    manifest.app_version = env!("CARGO_PKG_VERSION").to_string();

    for rel in paths {
        let Some(state) = states.get(rel.as_str()).copied() else {
            continue;
        };
        let Some(file) = template.get_file(rel) else {
            continue;
        };

        let dst_path = vault.join(rel);
        if let Some(parent) = dst_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        if state == TemplateFileState::Conflict && !overwrite.iter().any(|p| p == rel) {
            let side_name = format!(
                "{}.new",
                dst_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("template")
            );
            let side_path = dst_path.with_file_name(side_name);
            fs::write(&side_path, file.contents()).map_err(|e| e.to_string())?;
            continue;
        }

        fs::write(&dst_path, file.contents()).map_err(|e| e.to_string())?;
        manifest
            .files
            .insert(rel.clone(), sha256_hex(file.contents()));
    }

    write_manifest(vault, &manifest)
}

/// Renders a unified diff between the vault's current copy of `path` and the
/// embedded template's version of it, so the update dialog can show what an
/// overwrite would actually change before the user discards local edits.
///
/// The vault side is empty when the file does not exist yet (an `Added`
/// path), which renders as a pure addition. Returns an error for a path that
/// is not part of the template, or whose vault copy is not valid UTF-8.
pub fn template_file_diff(vault: &Path, path: &str) -> Result<String, String> {
    template_file_diff_from(vault, &VAULT_TEMPLATE, path)
}

fn template_file_diff_from(vault: &Path, template: &Dir, path: &str) -> Result<String, String> {
    let file = template
        .get_file(path)
        .ok_or_else(|| format!("{path} is not part of the vault template"))?;
    let new =
        std::str::from_utf8(file.contents()).map_err(|_| format!("{path} is not a text file"))?;

    let dst_path = vault.join(path);
    let current = if dst_path.exists() {
        fs::read_to_string(&dst_path).map_err(|_| format!("{path} is not a text file"))?
    } else {
        String::new()
    };

    let mut out = format!("--- {path} (vault)\n+++ {path} (template)\n");
    for hunk in TextDiff::from_lines(current.as_str(), new)
        .unified_diff()
        .iter_hunks()
    {
        out.push_str(&hunk.to_string());
    }
    Ok(out)
}

// ---------------------------------------------------------------------
// file watching
// ---------------------------------------------------------------------

/// Holds the live watcher so it isn't dropped (which would stop watching).
/// Managed as Tauri app state; replacing the contents drops the previous
/// watcher, which closes its event channel and lets the old debounce thread
/// exit cleanly.
pub struct WatcherState(pub Mutex<Option<RecommendedWatcher>>);

impl Default for WatcherState {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

/// True for a path under `projects/<slug>/schedules/` ending in `.md`.
///
/// `projects/` as a whole is a human writing area with far more churn than
/// `tasks/`, so the watcher subscribes to the tree but only *reports* schedule
/// notes — otherwise every note edit in Obsidian would round-trip a reload
/// through the Schedule view (design note §10.4).
fn is_schedule_path(p: &Path) -> bool {
    if p.extension().and_then(|e| e.to_str()) != Some("md") {
        return false;
    }
    p.parent()
        .and_then(|d| d.file_name())
        .and_then(|n| n.to_str())
        == Some("schedules")
}

/// Starts (or restarts) watching `<vault>/tasks` and `<vault>/projects` for
/// changes, debouncing bursts of events (e.g. an editor's
/// save-as-temp-then-rename) into a single emit per affected area:
/// `tasks-changed` for the task tree, `schedules-changed` for schedule notes.
/// Any per-event error from `notify` (a transient OS/FS hiccup) is treated as
/// "the tasks changed" rather than killing the loop, so the watcher stays
/// alive for the app's lifetime.
pub fn start_watcher(
    app: AppHandle,
    state: &Mutex<Option<RecommendedWatcher>>,
    vault: PathBuf,
) -> Result<(), String> {
    let dir = tasks_dir(&vault);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // Heal the archived-task layout once per vault load, before the index is
    // (re)generated below, so existing vaults migrate without a manual step.
    let _ = migrate_archived_layout(&vault);

    let (tx, rx) = std::sync::mpsc::channel::<Result<Event, notify::Error>>();
    let mut watcher = notify::recommended_watcher(tx).map_err(|e| e.to_string())?;
    // Recursive so moves into/out of `tasks/archive/` (and edits inside it)
    // are picked up, including the subfolder being created after this point.
    watcher
        .watch(&dir, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    // Schedule notes live under `projects/<slug>/schedules/`. A vault that has
    // no `projects/` yet is not an error — the folder appears when the user
    // creates their first project, and the watcher is restarted on vault load.
    let projects = vault.join("projects");
    if projects.is_dir() {
        let _ = watcher.watch(&projects, RecursiveMode::Recursive);
    }

    let vault_for_thread = vault.clone();
    std::thread::spawn(move || loop {
        // Block for the first event of a new burst.
        let mut tasks_touched = false;
        let mut schedules_touched = false;
        let mut classify = |ev: &Result<Event, notify::Error>| match ev {
            Ok(event) => {
                for path in &event.paths {
                    if is_schedule_path(path) {
                        schedules_touched = true;
                    } else if !path.starts_with(&projects) {
                        tasks_touched = true;
                    }
                }
            }
            // An unreadable event could have been anything; assume the tasks
            // moved (the cheaper, self-healing direction).
            Err(_) => tasks_touched = true,
        };

        match rx.recv() {
            Ok(ev) => classify(&ev),
            Err(_) => break, // watcher dropped: channel closed, thread exits
        }
        // Drain further events within the debounce window.
        loop {
            match rx.recv_timeout(DEBOUNCE) {
                Ok(ev) => classify(&ev),
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
        if tasks_touched {
            let _ = regenerate_index(&vault_for_thread);
            let _ = app.emit(TASKS_CHANGED_EVENT, ());
        }
        if schedules_touched {
            let _ = app.emit(SCHEDULES_CHANGED_EVENT, ());
        }
    });

    let mut guard = state
        .lock()
        .map_err(|_| "watcher state poisoned".to_string())?;
    *guard = Some(watcher);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_vault(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("workhub-test-{name}-{nanos}"));
        fs::create_dir_all(dir.join("tasks")).unwrap();
        dir
    }

    #[test]
    fn frontmatter_round_trip_preserves_body_bytes() {
        let vault = temp_vault("roundtrip");
        let task = create_task(
            &vault,
            CreateTaskInput {
                title: "sample task".into(),
                ..Default::default()
            },
        )
        .unwrap();

        // Simulate a human/AI hand-editing the body after creation.
        let hand_written_body =
            "\n## Description\n\nSome hand-written prose.\nLine two.\n\n## Results\n\n- [[some note]]\n";
        let content_before = format!("{}{}", render_frontmatter(&task), hand_written_body);
        fs::write(&task.file, &content_before).unwrap();

        // A frontmatter-only update must not touch the body bytes.
        let updated = update_task(
            &vault,
            UpdateTaskInput {
                id: task.id.clone(),
                status: Some("doing".into()),
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(updated.status, "doing");
        assert_eq!(updated.body, hand_written_body);

        // Re-parse from disk to confirm the write path preserved the body too.
        let reparsed = parse_task_file(&PathBuf::from(&task.file)).unwrap();
        assert_eq!(reparsed.body, hand_written_body);

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn frontmatter_round_trip_preserves_three_section_body_bytes() {
        // Same as frontmatter_round_trip_preserves_body_bytes, but with an
        // approved "## Plan" section present (T-0057) — a frontmatter-only
        // update must preserve it byte-for-byte, same as Description/Results.
        let vault = temp_vault("roundtrip-plan");
        let task = create_task(
            &vault,
            CreateTaskInput {
                title: "sample task with plan".into(),
                ..Default::default()
            },
        )
        .unwrap();

        let hand_written_body = "\n## Description\n\nDo the thing.\n\n## Plan\n\n\
1. Step one.\n2. Step two.\n\n## Results\n\n- [[some note]]\n";
        let content_before = format!("{}{}", render_frontmatter(&task), hand_written_body);
        fs::write(&task.file, &content_before).unwrap();

        let updated = update_task(
            &vault,
            UpdateTaskInput {
                id: task.id.clone(),
                status: Some("doing".into()),
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(updated.status, "doing");
        assert_eq!(updated.body, hand_written_body);

        let reparsed = parse_task_file(&PathBuf::from(&task.file)).unwrap();
        assert_eq!(reparsed.body, hand_written_body);

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn ids_are_assigned_sequentially() {
        let vault = temp_vault("ids");
        let t1 = create_task(
            &vault,
            CreateTaskInput {
                title: "first".into(),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(t1.id, "T-0001");

        let t2 = create_task(
            &vault,
            CreateTaskInput {
                title: "second".into(),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(t2.id, "T-0002");

        // A gap or out-of-order existing id still yields max + 1.
        let t3_path = tasks_dir(&vault).join("T-0099 injected.md");
        fs::write(
            &t3_path,
            format!(
                "{}\n## Description\n\n## Results\n",
                render_frontmatter(&Task {
                    id: "T-0099".into(),
                    title: "injected".into(),
                    status: "inbox".into(),
                    assignee: "me".into(),
                    project: String::new(),
                    priority: "medium".into(),
                    model: String::new(),
                    order: None,
                    due: String::new(),
                    tags: vec![],
                    archived: false,
                    confirm: false,
                    worktree: false,
                    created: today(),
                    updated: today(),
                    file: t3_path.to_string_lossy().replace('\\', "/"),
                    body: String::new(),
                })
            ),
        )
        .unwrap();

        let t4 = create_task(
            &vault,
            CreateTaskInput {
                title: "fourth".into(),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(t4.id, "T-0100");

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn order_is_assigned_per_status_and_updatable() {
        let vault = temp_vault("order");
        let t1 = create_task(
            &vault,
            CreateTaskInput {
                title: "first todo".into(),
                status: Some("todo".into()),
                ..Default::default()
            },
        )
        .unwrap();
        let t2 = create_task(
            &vault,
            CreateTaskInput {
                title: "second todo".into(),
                status: Some("todo".into()),
                ..Default::default()
            },
        )
        .unwrap();
        let other = create_task(
            &vault,
            CreateTaskInput {
                title: "a doing task".into(),
                status: Some("doing".into()),
                ..Default::default()
            },
        )
        .unwrap();
        // Appended per status column, independent across statuses.
        assert_eq!(t1.order, Some(1.0));
        assert_eq!(t2.order, Some(2.0));
        assert_eq!(other.order, Some(1.0));

        // A fractional midpoint (drop between neighbors) round-trips.
        let moved = update_task(
            &vault,
            UpdateTaskInput {
                id: t2.id.clone(),
                order: Some(0.5),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(moved.order, Some(0.5));
        let reparsed = parse_task_file(&PathBuf::from(&moved.file)).unwrap();
        assert_eq!(reparsed.order, Some(0.5));

        // Whole numbers render without a trailing .0.
        let raw = fs::read_to_string(&t1.file).unwrap();
        assert!(raw.contains("order: 1\n"), "raw frontmatter: {raw}");

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn index_regenerates_with_relative_paths() {
        let vault = temp_vault("index");
        create_task(
            &vault,
            CreateTaskInput {
                title: "indexed task".into(),
                tags: Some(vec!["feature".into(), "urgent".into()]),
                ..Default::default()
            },
        )
        .unwrap();

        let index_path = index_file(&vault);
        assert!(index_path.exists());
        let text = fs::read_to_string(&index_path).unwrap();
        let value: serde_json::Value = serde_json::from_str(&text).unwrap();
        let arr = value.as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["id"], "T-0001");
        assert_eq!(arr[0]["file"], "tasks/T-0001 indexed task.md");
        assert_eq!(arr[0]["tags"][0], "feature");

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn archived_flag_round_trips_and_is_omitted_when_false() {
        let vault = temp_vault("archived");
        let task = create_task(
            &vault,
            CreateTaskInput {
                title: "archivable".into(),
                ..Default::default()
            },
        )
        .unwrap();

        // Never-archived files carry no `archived:` line at all.
        let raw = fs::read_to_string(&task.file).unwrap();
        assert!(!raw.contains("archived:"), "raw frontmatter: {raw}");

        let archived = update_task(
            &vault,
            UpdateTaskInput {
                id: task.id.clone(),
                archived: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(archived.archived);
        // Archiving relocates the file under tasks/archive/, so read the new path.
        let raw = fs::read_to_string(&archived.file).unwrap();
        assert!(raw.contains("archived: true\n"), "raw frontmatter: {raw}");

        // Re-scan sees the flag; index carries it too.
        let scanned = scan_tasks(&vault).unwrap();
        assert!(scanned[0].archived);
        let index: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(index_file(&vault)).unwrap()).unwrap();
        assert_eq!(index[0]["archived"], true);

        // Unarchiving removes the line again.
        let unarchived = update_task(
            &vault,
            UpdateTaskInput {
                id: task.id.clone(),
                archived: Some(false),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(!unarchived.archived);
        // Unarchiving moves it back to tasks/.
        let raw = fs::read_to_string(&unarchived.file).unwrap();
        assert!(!raw.contains("archived:"), "raw frontmatter: {raw}");

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn confirm_and_worktree_flags_round_trip_and_are_omitted_when_false() {
        let vault = temp_vault("flags");
        let task = create_task(
            &vault,
            CreateTaskInput {
                title: "flagged".into(),
                ..Default::default()
            },
        )
        .unwrap();

        // Absent by default: no lines emitted.
        let raw = fs::read_to_string(&task.file).unwrap();
        assert!(!raw.contains("confirm:"), "raw frontmatter: {raw}");
        assert!(!raw.contains("worktree:"), "raw frontmatter: {raw}");

        let updated = update_task(
            &vault,
            UpdateTaskInput {
                id: task.id.clone(),
                confirm: Some(true),
                worktree: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(updated.confirm && updated.worktree);
        let raw = fs::read_to_string(&task.file).unwrap();
        assert!(raw.contains("confirm: true\n"), "raw frontmatter: {raw}");
        assert!(raw.contains("worktree: true\n"), "raw frontmatter: {raw}");

        // Re-scan and index carry the flags.
        let scanned = scan_tasks(&vault).unwrap();
        assert!(scanned[0].confirm && scanned[0].worktree);
        let index: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(index_file(&vault)).unwrap()).unwrap();
        assert_eq!(index[0]["confirm"], true);
        assert_eq!(index[0]["worktree"], true);

        // Turning them off removes the lines again.
        update_task(
            &vault,
            UpdateTaskInput {
                id: task.id.clone(),
                confirm: Some(false),
                worktree: Some(false),
                ..Default::default()
            },
        )
        .unwrap();
        let raw = fs::read_to_string(&task.file).unwrap();
        assert!(!raw.contains("confirm:"), "raw frontmatter: {raw}");
        assert!(!raw.contains("worktree:"), "raw frontmatter: {raw}");

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn model_round_trips_and_is_omitted_when_empty() {
        let vault = temp_vault("model");
        let task = create_task(
            &vault,
            CreateTaskInput {
                title: "model task".into(),
                ..Default::default()
            },
        )
        .unwrap();

        // Tasks without a model carry no `model:` line at all.
        let raw = fs::read_to_string(&task.file).unwrap();
        assert!(!raw.contains("model:"), "raw frontmatter: {raw}");

        let with_model = update_task(
            &vault,
            UpdateTaskInput {
                id: task.id.clone(),
                model: Some("anthropic/claude-sonnet-4-5".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(with_model.model, "anthropic/claude-sonnet-4-5");
        let raw = fs::read_to_string(&task.file).unwrap();
        assert!(
            raw.contains("model: anthropic/claude-sonnet-4-5\n"),
            "raw frontmatter: {raw}"
        );

        // Re-scan sees the field; index carries it too.
        let scanned = scan_tasks(&vault).unwrap();
        assert_eq!(scanned[0].model, "anthropic/claude-sonnet-4-5");
        let index: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(index_file(&vault)).unwrap()).unwrap();
        assert_eq!(index[0]["model"], "anthropic/claude-sonnet-4-5");

        // Clearing the model removes the line again.
        let cleared = update_task(
            &vault,
            UpdateTaskInput {
                id: task.id.clone(),
                model: Some(String::new()),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(cleared.model.is_empty());
        let raw = fs::read_to_string(&task.file).unwrap();
        assert!(!raw.contains("model:"), "raw frontmatter: {raw}");

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn delete_task_removes_file_and_index_entry() {
        let vault = temp_vault("delete");
        let keep = create_task(
            &vault,
            CreateTaskInput {
                title: "keep me".into(),
                ..Default::default()
            },
        )
        .unwrap();
        let doomed = create_task(
            &vault,
            CreateTaskInput {
                title: "delete me".into(),
                ..Default::default()
            },
        )
        .unwrap();

        delete_task(&vault, &doomed.id).unwrap();
        assert!(!PathBuf::from(&doomed.file).exists());

        let index: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(index_file(&vault)).unwrap()).unwrap();
        let arr = index.as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["id"], keep.id);

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn delete_task_missing_file_errors_without_touching_others() {
        let vault = temp_vault("delete-missing");
        let task = create_task(
            &vault,
            CreateTaskInput {
                title: "vanishes".into(),
                ..Default::default()
            },
        )
        .unwrap();
        fs::remove_file(&task.file).unwrap();

        let err = delete_task(&vault, &task.id).unwrap_err();
        assert!(err.contains("not found"), "error: {err}");

        // Best-effort index regen ran and no longer lists the ghost task.
        let index: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(index_file(&vault)).unwrap()).unwrap();
        assert_eq!(index.as_array().unwrap().len(), 0);

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn archiving_moves_file_into_archive_subfolder_and_back() {
        let vault = temp_vault("archive-move");
        let task = create_task(
            &vault,
            CreateTaskInput {
                title: "movable".into(),
                ..Default::default()
            },
        )
        .unwrap();
        // Created active: the file lives flat in tasks/.
        assert_eq!(
            norm_path(PathBuf::from(&task.file).parent().unwrap()),
            norm_path(&tasks_dir(&vault))
        );

        let archived = update_task(
            &vault,
            UpdateTaskInput {
                id: task.id.clone(),
                archived: Some(true),
                ..Default::default()
            },
        )
        .unwrap();

        // Moved under tasks/archive/: new path present with the flag, old gone.
        let new_path = PathBuf::from(&archived.file);
        assert_eq!(
            norm_path(new_path.parent().unwrap()),
            norm_path(&archive_dir(&vault))
        );
        assert!(new_path.exists());
        assert!(!PathBuf::from(&task.file).exists());
        assert!(fs::read_to_string(&new_path)
            .unwrap()
            .contains("archived: true"));

        // Still scanned/indexed while archived.
        let scanned = scan_tasks(&vault).unwrap();
        assert_eq!(scanned.len(), 1);
        assert!(scanned[0].archived);

        // Unarchiving moves it back to tasks/.
        let restored = update_task(
            &vault,
            UpdateTaskInput {
                id: task.id.clone(),
                archived: Some(false),
                ..Default::default()
            },
        )
        .unwrap();
        let restored_path = PathBuf::from(&restored.file);
        assert_eq!(
            norm_path(restored_path.parent().unwrap()),
            norm_path(&tasks_dir(&vault))
        );
        assert!(restored_path.exists());
        assert!(!new_path.exists());

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn next_id_reserves_ids_of_archived_tasks() {
        let vault = temp_vault("archive-id");
        let t1 = create_task(
            &vault,
            CreateTaskInput {
                title: "first".into(),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(t1.id, "T-0001");

        update_task(
            &vault,
            UpdateTaskInput {
                id: t1.id.clone(),
                archived: Some(true),
                ..Default::default()
            },
        )
        .unwrap();

        // T-0001 now lives under tasks/archive/; the next id must not reuse it.
        let t2 = create_task(
            &vault,
            CreateTaskInput {
                title: "second".into(),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(t2.id, "T-0002");

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn migrate_relocates_flagged_files_left_flat() {
        let vault = temp_vault("archive-migrate");
        let task = create_task(
            &vault,
            CreateTaskInput {
                title: "legacy archived".into(),
                ..Default::default()
            },
        )
        .unwrap();

        // Simulate a pre-migration vault: the archived flag was written without
        // moving the file (the old app behavior), so it still sits flat.
        let mut t = parse_task_file(&PathBuf::from(&task.file)).unwrap();
        t.archived = true;
        write_task_file(&t).unwrap();
        assert_eq!(
            norm_path(PathBuf::from(&task.file).parent().unwrap()),
            norm_path(&tasks_dir(&vault))
        );

        migrate_archived_layout(&vault).unwrap();

        // Relocated under tasks/archive/; the flat file is gone.
        assert!(!PathBuf::from(&task.file).exists());
        let moved = archive_dir(&vault).join(PathBuf::from(&task.file).file_name().unwrap());
        assert!(moved.exists());

        // Idempotent: a second run is a no-op and doesn't error.
        migrate_archived_layout(&vault).unwrap();
        assert!(moved.exists());

        fs::remove_dir_all(&vault).ok();
    }

    // -------------------------------------------------------------------
    // template sync (init_vault / check_vault_template / apply_vault_template)
    // -------------------------------------------------------------------
    //
    // `include_dir::Dir` and `File` are `const fn`-constructible, so tests
    // build a small synthetic template tree instead of exercising the real
    // (large, fast-moving) `vault-template/`. The `*_from`/`*_against`
    // internals take the template `Dir` as a parameter for exactly this
    // reason — the public `init_vault`/`check_vault_template`/
    // `apply_vault_template` just plug in the real embedded `VAULT_TEMPLATE`.

    use include_dir::{Dir, DirEntry, File};

    static TEST_TEMPLATE: Dir<'_> = Dir::new(
        "",
        &[
            DirEntry::File(File::new("added.md", b"added-content")),
            DirEntry::File(File::new("stable.md", b"stable-content")),
            DirEntry::File(File::new("changed.md", b"changed-content-v2")),
            DirEntry::File(File::new("home.md", b"home-content")),
            DirEntry::File(File::new(
                ".template-policy.json",
                br#"{"seed_only": ["home.md"]}"#,
            )),
        ],
    );

    fn temp_test_vault(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("workhub-template-test-{name}-{nanos}"))
    }

    fn diff_state(diff: &TemplateDiff, path: &str) -> Option<TemplateFileState> {
        diff.files.iter().find(|f| f.path == path).map(|f| f.state)
    }

    #[test]
    fn init_writes_files_and_baseline_manifest() {
        let vault = temp_test_vault("init");

        init_from(&vault, &TEST_TEMPLATE).unwrap();

        assert!(vault.join("added.md").exists());
        assert!(vault.join("home.md").exists());
        let manifest = load_manifest(&vault);
        assert_eq!(
            manifest.files.get("stable.md").unwrap(),
            &sha256_hex(b"stable-content")
        );
        // Initial-only files are copied but excluded from the manifest.
        assert!(!manifest.files.contains_key("home.md"));

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn init_never_overwrites_existing_files() {
        let vault = temp_test_vault("init-preserve");
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("home.md"), "hand-written home").unwrap();

        init_from(&vault, &TEST_TEMPLATE).unwrap();

        assert_eq!(
            fs::read_to_string(vault.join("home.md")).unwrap(),
            "hand-written home"
        );

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn diff_reports_added_for_missing_file() {
        let vault = temp_test_vault("diff-added");
        fs::create_dir_all(&vault).unwrap();

        let diff = diff_against(&vault, &TEST_TEMPLATE).unwrap();

        assert_eq!(
            diff_state(&diff, "added.md"),
            Some(TemplateFileState::Added)
        );
    }

    #[test]
    fn diff_reports_updatable_when_vault_matches_baseline_but_template_changed() {
        let vault = temp_test_vault("diff-updatable");
        fs::create_dir_all(&vault).unwrap();
        // Vault has the *old* content, matching the recorded baseline.
        fs::write(vault.join("changed.md"), "changed-content-v1").unwrap();
        let mut manifest = TemplateManifest {
            schema_version: MANIFEST_SCHEMA_VERSION,
            ..Default::default()
        };
        manifest
            .files
            .insert("changed.md".into(), sha256_hex(b"changed-content-v1"));
        write_manifest(&vault, &manifest).unwrap();

        let diff = diff_against(&vault, &TEST_TEMPLATE).unwrap();

        assert_eq!(
            diff_state(&diff, "changed.md"),
            Some(TemplateFileState::Updatable)
        );
    }

    #[test]
    fn diff_reports_conflict_when_vault_and_template_both_diverged_from_baseline() {
        let vault = temp_test_vault("diff-conflict");
        fs::create_dir_all(&vault).unwrap();
        // Vault was hand-edited away from the old baseline.
        fs::write(vault.join("changed.md"), "hand-edited content").unwrap();
        let mut manifest = TemplateManifest {
            schema_version: MANIFEST_SCHEMA_VERSION,
            ..Default::default()
        };
        manifest
            .files
            .insert("changed.md".into(), sha256_hex(b"changed-content-v1"));
        write_manifest(&vault, &manifest).unwrap();

        let diff = diff_against(&vault, &TEST_TEMPLATE).unwrap();

        assert_eq!(
            diff_state(&diff, "changed.md"),
            Some(TemplateFileState::Conflict)
        );
    }

    #[test]
    fn diff_reports_up_to_date_when_nothing_changed() {
        let vault = temp_test_vault("diff-uptodate");
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("stable.md"), "stable-content").unwrap();
        let mut manifest = TemplateManifest {
            schema_version: MANIFEST_SCHEMA_VERSION,
            ..Default::default()
        };
        manifest
            .files
            .insert("stable.md".into(), sha256_hex(b"stable-content"));
        write_manifest(&vault, &manifest).unwrap();

        let diff = diff_against(&vault, &TEST_TEMPLATE).unwrap();

        assert_eq!(
            diff_state(&diff, "stable.md"),
            Some(TemplateFileState::UpToDate)
        );
    }

    #[test]
    fn diff_with_no_baseline_falls_back_to_content_comparison() {
        let vault = temp_test_vault("diff-no-baseline");
        fs::create_dir_all(&vault).unwrap();
        // No manifest at all (a vault that predates the manifest mechanism).
        fs::write(vault.join("stable.md"), "stable-content").unwrap();
        fs::write(
            vault.join("changed.md"),
            "hand-edited, no baseline on record",
        )
        .unwrap();

        let diff = diff_against(&vault, &TEST_TEMPLATE).unwrap();

        assert_eq!(
            diff_state(&diff, "stable.md"),
            Some(TemplateFileState::UpToDate),
            "content-equal with no baseline is UpToDate"
        );
        assert_eq!(
            diff_state(&diff, "changed.md"),
            Some(TemplateFileState::Conflict),
            "content-divergent with no baseline defaults to Conflict, not silently overwritten"
        );
    }

    #[test]
    fn initial_only_files_are_excluded_from_the_diff() {
        let vault = temp_test_vault("diff-initial-only");
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("home.md"), "hand-written home").unwrap();

        let diff = diff_against(&vault, &TEST_TEMPLATE).unwrap();

        assert!(diff_state(&diff, "home.md").is_none());
    }

    #[test]
    fn apply_conflict_writes_side_by_side_file_and_preserves_original() {
        let vault = temp_test_vault("apply-conflict");
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("changed.md"), "hand-edited content").unwrap();
        let mut manifest = TemplateManifest {
            schema_version: MANIFEST_SCHEMA_VERSION,
            ..Default::default()
        };
        manifest
            .files
            .insert("changed.md".into(), sha256_hex(b"changed-content-v1"));
        write_manifest(&vault, &manifest).unwrap();

        apply_from(&vault, &TEST_TEMPLATE, &["changed.md".to_string()], &[]).unwrap();

        assert_eq!(
            fs::read_to_string(vault.join("changed.md")).unwrap(),
            "hand-edited content",
            "the conflicting original must be left untouched"
        );
        assert_eq!(
            fs::read_to_string(vault.join("changed.md.new")).unwrap(),
            "changed-content-v2"
        );
        // Baseline is left as-is for a conflict — the vault file didn't change.
        let reloaded = load_manifest(&vault);
        assert_eq!(
            reloaded.files.get("changed.md").unwrap(),
            &sha256_hex(b"changed-content-v1")
        );
    }

    #[test]
    fn apply_updatable_overwrites_and_advances_the_baseline() {
        let vault = temp_test_vault("apply-updatable");
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("changed.md"), "changed-content-v1").unwrap();
        let mut manifest = TemplateManifest {
            schema_version: MANIFEST_SCHEMA_VERSION,
            ..Default::default()
        };
        manifest
            .files
            .insert("changed.md".into(), sha256_hex(b"changed-content-v1"));
        write_manifest(&vault, &manifest).unwrap();

        apply_from(&vault, &TEST_TEMPLATE, &["changed.md".to_string()], &[]).unwrap();

        assert_eq!(
            fs::read_to_string(vault.join("changed.md")).unwrap(),
            "changed-content-v2"
        );
        assert!(!vault.join("changed.md.new").exists());
        let reloaded = load_manifest(&vault);
        assert_eq!(
            reloaded.files.get("changed.md").unwrap(),
            &sha256_hex(b"changed-content-v2")
        );
    }

    #[test]
    fn apply_conflict_listed_as_overwrite_replaces_in_place_and_advances_the_baseline() {
        let vault = temp_test_vault("apply-conflict-overwrite");
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("changed.md"), "hand-edited content").unwrap();
        let mut manifest = TemplateManifest {
            schema_version: MANIFEST_SCHEMA_VERSION,
            ..Default::default()
        };
        manifest
            .files
            .insert("changed.md".into(), sha256_hex(b"changed-content-v1"));
        write_manifest(&vault, &manifest).unwrap();

        apply_from(
            &vault,
            &TEST_TEMPLATE,
            &["changed.md".to_string()],
            &["changed.md".to_string()],
        )
        .unwrap();

        assert_eq!(
            fs::read_to_string(vault.join("changed.md")).unwrap(),
            "changed-content-v2",
            "an explicitly chosen overwrite must replace the conflicting file"
        );
        assert!(
            !vault.join("changed.md.new").exists(),
            "no side-by-side file when the user chose to overwrite"
        );
        // The baseline must advance, or the file would report Conflict forever.
        assert_eq!(
            diff_state(&diff_against(&vault, &TEST_TEMPLATE).unwrap(), "changed.md"),
            Some(TemplateFileState::UpToDate)
        );
    }

    #[test]
    fn overwrite_list_does_not_affect_conflicts_that_were_not_listed() {
        let vault = temp_test_vault("apply-conflict-overwrite-other");
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("changed.md"), "hand-edited content").unwrap();
        let mut manifest = TemplateManifest {
            schema_version: MANIFEST_SCHEMA_VERSION,
            ..Default::default()
        };
        manifest
            .files
            .insert("changed.md".into(), sha256_hex(b"changed-content-v1"));
        write_manifest(&vault, &manifest).unwrap();

        apply_from(
            &vault,
            &TEST_TEMPLATE,
            &["changed.md".to_string()],
            &["some/other/path.md".to_string()],
        )
        .unwrap();

        assert_eq!(
            fs::read_to_string(vault.join("changed.md")).unwrap(),
            "hand-edited content"
        );
        assert!(vault.join("changed.md.new").exists());
    }

    #[test]
    fn template_file_diff_reports_both_sides_of_a_conflict() {
        let vault = temp_test_vault("template-file-diff");
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("changed.md"), "hand-edited content\n").unwrap();

        let diff = template_file_diff_from(&vault, &TEST_TEMPLATE, "changed.md").unwrap();

        assert!(diff.contains("-hand-edited content"), "{diff}");
        assert!(diff.contains("+changed-content-v2"), "{diff}");
    }

    #[test]
    fn template_file_diff_of_a_missing_file_is_a_pure_addition() {
        let vault = temp_test_vault("template-file-diff-added");
        fs::create_dir_all(&vault).unwrap();

        let diff = template_file_diff_from(&vault, &TEST_TEMPLATE, "added.md").unwrap();

        assert!(diff.contains("+added-content"), "{diff}");
        assert!(!diff.contains("\n-"), "nothing to remove: {diff}");
    }

    #[test]
    fn template_file_diff_rejects_a_path_outside_the_template() {
        let vault = temp_test_vault("template-file-diff-unknown");
        fs::create_dir_all(&vault).unwrap();

        assert!(template_file_diff_from(&vault, &TEST_TEMPLATE, "nope.md").is_err());
    }

    #[test]
    fn apply_added_creates_the_missing_file() {
        let vault = temp_test_vault("apply-added");
        fs::create_dir_all(&vault).unwrap();

        apply_from(&vault, &TEST_TEMPLATE, &["added.md".to_string()], &[]).unwrap();

        assert_eq!(
            fs::read_to_string(vault.join("added.md")).unwrap(),
            "added-content"
        );
    }

    #[test]
    fn init_records_no_baseline_for_a_preexisting_file_that_differs_from_the_template() {
        let vault = temp_test_vault("init-preexisting-conflict");
        fs::create_dir_all(&vault).unwrap();
        // The user already has their own content in this file before the
        // template is ever applied (e.g. a hand-customized project-context
        // equivalent). Recording *this* content as the baseline would make
        // the next `diff_against` see `current == baseline` and misreport a
        // future upstream change as a safe `Updatable` overwrite.
        fs::write(vault.join("stable.md"), "user-customized-content").unwrap();

        init_from(&vault, &TEST_TEMPLATE).unwrap();

        let manifest = load_manifest(&vault);
        assert!(
            !manifest.files.contains_key("stable.md"),
            "a pre-existing, template-diverging file must not get a baseline recorded"
        );

        let diff = diff_against(&vault, &TEST_TEMPLATE).unwrap();
        assert_eq!(
            diff_state(&diff, "stable.md"),
            Some(TemplateFileState::Conflict),
            "with no baseline recorded, diverging content must report Conflict, not Updatable"
        );

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn init_records_a_baseline_for_a_preexisting_file_that_matches_the_template() {
        let vault = temp_test_vault("init-preexisting-match");
        fs::create_dir_all(&vault).unwrap();
        // The file already on disk happens to be byte-identical to the
        // template — nothing was customized, so recording a baseline is safe.
        fs::write(vault.join("stable.md"), "stable-content").unwrap();

        init_from(&vault, &TEST_TEMPLATE).unwrap();

        let manifest = load_manifest(&vault);
        assert_eq!(
            manifest.files.get("stable.md").unwrap(),
            &sha256_hex(b"stable-content")
        );

        let diff = diff_against(&vault, &TEST_TEMPLATE).unwrap();
        assert_eq!(
            diff_state(&diff, "stable.md"),
            Some(TemplateFileState::UpToDate)
        );

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn init_records_a_baseline_for_a_newly_created_file() {
        let vault = temp_test_vault("init-newly-created");
        fs::create_dir_all(&vault).unwrap();
        // "stable.md" does not exist yet; init_from creates it, and since the
        // on-disk content is then exactly the embedded template, recording a
        // baseline is always safe.
        assert!(!vault.join("stable.md").exists());

        init_from(&vault, &TEST_TEMPLATE).unwrap();

        let manifest = load_manifest(&vault);
        assert_eq!(
            manifest.files.get("stable.md").unwrap(),
            &sha256_hex(b"stable-content")
        );

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn manifest_without_schema_version_has_its_baselines_discarded() {
        let vault = temp_test_vault("manifest-schema-migration");
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("changed.md"), "hand-edited content").unwrap();
        // Simulate a manifest written by <= 0.49.0: no `schema_version`
        // field at all, but a baseline recorded for the hand-edited file
        // (the very bug this fix addresses).
        let legacy_json = serde_json::json!({
            "app_version": "0.49.0",
            "files": { "changed.md": sha256_hex(b"changed-content-v1") },
        });
        write_manifest(
            &vault,
            &serde_json::from_value(legacy_json).unwrap_or_default(),
        )
        .unwrap();

        let diff = diff_against(&vault, &TEST_TEMPLATE).unwrap();

        assert_eq!(
            diff_state(&diff, "changed.md"),
            Some(TemplateFileState::Conflict),
            "a pre-schema-version manifest's baselines must be discarded, \
             so a diverging file safely reports Conflict instead of Updatable"
        );

        fs::remove_dir_all(&vault).ok();
    }
}

#[cfg(test)]
mod regression_t0065 {
    use super::*;

    /// Reproduces the T-0065 data loss against the REAL embedded template:
    /// a vault whose `.claude/project-context.json` holds the user's own
    /// registered repos must never be reported as a clean `Updatable`.
    #[test]
    fn user_edited_files_are_never_silently_updatable() {
        let vault = std::env::temp_dir().join(format!(
            "wh-t0065-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(vault.join(".claude")).unwrap();
        // The user's real data, as it was before the wipe.
        let user_data = br#"{"projects":[{"name":"workhub","path":"C:/repos/workhub"}],"roleBasedDelegation":true}"#;
        fs::write(vault.join(".claude/project-context.json"), user_data).unwrap();
        // A managed file the user also customised.
        fs::write(vault.join("CLAUDE.md"), b"# my own edited harness notes\n").unwrap();

        init_from(&vault, &VAULT_TEMPLATE).unwrap();

        // Seed-only: must not appear in the diff at all, and must be untouched.
        let diff = diff_against(&vault, &VAULT_TEMPLATE).unwrap();
        assert!(
            !diff
                .files
                .iter()
                .any(|f| f.path == ".claude/project-context.json"),
            "seed-only file must be excluded from the diff entirely"
        );
        assert_eq!(
            fs::read(vault.join(".claude/project-context.json")).unwrap(),
            user_data,
            "seed-only file must be left byte-identical"
        );

        // Managed but user-edited: must be Conflict, never Updatable.
        let claude_md = diff
            .files
            .iter()
            .find(|f| f.path == "CLAUDE.md")
            .expect("CLAUDE.md should be in the diff");
        assert_eq!(
            claude_md.state,
            TemplateFileState::Conflict,
            "a user-edited managed file must be Conflict, not {:?}",
            claude_md.state
        );

        // Applying the conflict must not clobber the user's file.
        apply_from(&vault, &VAULT_TEMPLATE, &["CLAUDE.md".to_string()], &[]).unwrap();
        assert_eq!(
            fs::read(vault.join("CLAUDE.md")).unwrap(),
            b"# my own edited harness notes\n",
            "applying a Conflict must leave the original untouched"
        );
        assert!(
            vault.join("CLAUDE.md.new").exists(),
            ".new must be written beside it"
        );

        fs::remove_dir_all(&vault).ok();
    }
}
