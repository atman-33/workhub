//! Task Markdown parsing/writing and the `_ai/index/tasks.json`
//! machine-readable index. The vault file watcher lives in `vault_watch.rs`.
//!
//! The vault is the source of truth (see `vault-template/CLAUDE.md`): every
//! task is one `tasks/<id> <title>.md` file with a YAML-ish frontmatter
//! block. Frontmatter here uses a fixed, known schema (see `Task` in
//! `models.rs`), so rather than pull in a general YAML crate we hand-roll a
//! small parser/writer for exactly that shape. This keeps the round-trip
//! guarantee simple to reason about: the body (everything after the closing
//! `---`) is captured verbatim and never touched unless the caller explicitly
//! supplies a replacement.

use crate::frontmatter::{self, unquote};
use crate::models::Task;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

pub(crate) fn tasks_dir(vault: &Path) -> PathBuf {
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
pub(crate) fn norm_path(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

// ---------------------------------------------------------------------
// frontmatter parsing / rendering
// ---------------------------------------------------------------------

/// Splits a task file into (frontmatter text, body); see `frontmatter::split_frontmatter`.
fn split_frontmatter(content: &str) -> Result<(String, String), String> {
    frontmatter::split_frontmatter(content).map_err(|e| e.to_string())
}

struct RawFrontmatter {
    map: HashMap<String, String>,
    tags: Vec<String>,
    depends_on: Vec<String>,
}

/// Frontmatter keys whose value is a list (inline `[a, b]` or a `- a` block).
const LIST_KEYS: [&str; 2] = ["tags", "depends_on"];

fn parse_frontmatter(front: &str) -> RawFrontmatter {
    let mut map = HashMap::new();
    let mut lists: HashMap<&'static str, Vec<String>> = HashMap::new();
    let mut block_key: Option<&'static str> = None;
    for raw_line in front.lines() {
        let line = raw_line.trim_end();
        if let Some(key) = block_key {
            let trimmed = line.trim_start();
            if let Some(rest) = trimmed.strip_prefix("- ") {
                lists.entry(key).or_default().push(unquote(rest.trim()));
                continue;
            } else if trimmed.is_empty() {
                continue;
            } else {
                block_key = None; // fall through to normal key parsing
            }
        }
        let Some(idx) = line.find(':') else { continue };
        let key = line[..idx].trim().to_string();
        let val = line[idx + 1..].trim();
        if let Some(list_key) = LIST_KEYS.iter().find(|k| **k == key) {
            if val.is_empty() {
                block_key = Some(list_key);
                lists.insert(list_key, Vec::new());
            } else if let Some(inner) = val.strip_prefix('[').and_then(|v| v.strip_suffix(']')) {
                let items = inner
                    .split(',')
                    .map(|s| unquote(s.trim()))
                    .filter(|s| !s.is_empty())
                    .collect();
                lists.insert(list_key, items);
            } else {
                lists.insert(list_key, vec![unquote(val)]);
            }
        } else {
            map.insert(key, unquote(val));
        }
    }
    RawFrontmatter {
        map,
        tags: lists.remove("tags").unwrap_or_default(),
        depends_on: lists.remove("depends_on").unwrap_or_default(),
    }
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
    // Same policy for the blocked trio: a task that was never blocked carries
    // none of the three lines. The note/since lines are tied to the flag so a
    // cleared block leaves no stale leftovers behind.
    let blocked_lines = if t.blocked {
        let mut s = String::from("blocked: true\n");
        if !t.blocked_note.is_empty() {
            s.push_str(&format!("blocked_note: {}\n", yaml_scalar(&t.blocked_note)));
        }
        if !t.blocked_since.is_empty() {
            s.push_str(&format!("blocked_since: {}\n", t.blocked_since));
        }
        s
    } else {
        String::new()
    };
    // Same policy: only tasks that specify a model carry the line.
    let model_line = if t.model.is_empty() {
        String::new()
    } else {
        format!("model: {}\n", yaml_scalar(&t.model))
    };
    // Same policy again: a task that belongs to no backlog item carries no
    // `backlog:` line at all, so every task file written before T-0253 stays
    // byte-identical.
    let backlog_line = if t.backlog.is_empty() {
        String::new()
    } else {
        format!("backlog: {}\n", yaml_scalar(&t.backlog))
    };
    // Same policy once more: only tasks with a predecessor carry `depends_on:`.
    let depends_line = if t.depends_on.is_empty() {
        String::new()
    } else {
        format!("depends_on: {}\n", render_tags(&t.depends_on))
    };
    // Same policy once more: `completed` is only written while it carries a
    // time, so every task file written before T-0727 stays byte-identical on
    // round-trip. It sits right after `updated`, the stamp it was taken with.
    let completed_line = if t.completed.is_empty() {
        String::new()
    } else {
        format!("completed: {}\n", t.completed)
    };
    format!(
        "---\nid: {}\ntitle: {}\nstatus: {}\nassignee: {}\nproject: {}\n{}priority: {}\n{}{}due: {}\ntags: {}\n{}{}{}{}{}created: {}\nupdated: {}\n{}---\n",
        t.id,
        yaml_scalar(&t.title),
        t.status,
        t.assignee,
        yaml_scalar(&t.project),
        backlog_line,
        t.priority,
        model_line,
        order_line,
        t.due,
        render_tags(&t.tags),
        archived_line,
        confirm_line,
        worktree_line,
        blocked_lines,
        depends_line,
        t.created,
        t.updated,
        completed_line,
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
        backlog: get("backlog"),
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
        blocked: raw.map.get("blocked").map(|v| v == "true").unwrap_or(false),
        blocked_note: get("blocked_note"),
        blocked_since: get("blocked_since"),
        depends_on: raw.depends_on,
        created: get("created"),
        updated: get("updated"),
        completed: get("completed"),
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

/// `YYYY-MM-DD HH:MM` in local time, stamped when a task's `status` changes
/// to `done` (T-0727). Local rather than UTC because the owner reads it
/// against their own day. Windows answers this directly; elsewhere the date
/// comes from [`civil_from_days`] and the clock from the epoch's remainder —
/// the same UTC approximation [`today`] already accepts on those targets,
/// which this app does not ship to.
#[cfg(windows)]
fn now_datetime() -> String {
    // SAFETY: GetLocalTime reads the clock and returns by value; it takes no
    // pointer from us and cannot fail.
    let st = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}",
        st.wYear, st.wMonth, st.wDay, st.wHour, st.wMinute
    )
}

#[cfg(not(windows))]
fn now_datetime() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = (secs / 86_400) as i64;
    let rem = (secs % 86_400) as u32;
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}-{m:02}-{d:02} {:02}:{:02}",
        rem / 3600,
        (rem % 3600) / 60
    )
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
    pub backlog: Option<String>,
    pub priority: Option<String>,
    pub model: Option<String>,
    pub confirm: Option<bool>,
    pub worktree: Option<bool>,
    pub blocked: Option<bool>,
    pub blocked_note: Option<String>,
    pub blocked_since: Option<String>,
    pub depends_on: Option<Vec<String>>,
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
    pub backlog: Option<String>,
    pub priority: Option<String>,
    pub model: Option<String>,
    pub order: Option<f64>,
    pub due: Option<String>,
    pub tags: Option<Vec<String>>,
    pub archived: Option<bool>,
    pub confirm: Option<bool>,
    pub worktree: Option<bool>,
    pub blocked: Option<bool>,
    pub blocked_note: Option<String>,
    pub blocked_since: Option<String>,
    pub depends_on: Option<Vec<String>>,
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
    let blocked = input.blocked.unwrap_or(false);
    let task = Task {
        id,
        title: input.title,
        status,
        assignee: input.assignee.unwrap_or_else(|| "me".into()),
        project: input.project.unwrap_or_default(),
        backlog: input.backlog.unwrap_or_default(),
        priority: input.priority.unwrap_or_else(|| "medium".into()),
        model: input.model.unwrap_or_default(),
        order: Some(order),
        due: input.due.unwrap_or_default(),
        tags: input.tags.unwrap_or_default(),
        archived: false,
        confirm: input.confirm.unwrap_or(false),
        worktree: input.worktree.unwrap_or(false),
        blocked,
        blocked_note: if blocked {
            input.blocked_note.unwrap_or_default()
        } else {
            String::new()
        },
        blocked_since: if blocked {
            let since = input.blocked_since.unwrap_or_default();
            if since.is_empty() {
                now.clone()
            } else {
                since
            }
        } else {
            String::new()
        },
        depends_on: normalize_deps(input.depends_on.unwrap_or_default()),
        created: now.clone(),
        updated: now,
        // A new task starts with no completion time, even one created with
        // `status: done`: the stamp records the moment of the transition, and
        // creation is not one (see `update_task`).
        completed: String::new(),
        file: file.to_string_lossy().replace('\\', "/"),
        body: input
            .body
            .unwrap_or_else(|| "\n## Description\n\n## Plan\n\n## Results\n".to_string()),
    };
    write_task_file(&task)?;
    refresh_index(vault);
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

/// Trims, drops blanks and duplicates, keeping the caller's order.
fn normalize_deps(deps: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for d in deps {
        let d = d.trim().to_string();
        if !d.is_empty() && !out.contains(&d) {
            out.push(d);
        }
    }
    out
}

/// Whether giving `id` the predecessors `deps` would close a loop: true when
/// `id` is one of `deps`, or is reachable by following `depends_on` from them.
pub fn would_create_cycle(id: &str, deps: &[String], all: &[Task]) -> bool {
    let mut stack: Vec<&str> = deps.iter().map(|d| d.as_str()).collect();
    let mut seen: Vec<&str> = Vec::new();
    while let Some(cur) = stack.pop() {
        if cur == id {
            return true;
        }
        if seen.contains(&cur) {
            continue;
        }
        seen.push(cur);
        if let Some(t) = all.iter().find(|t| t.id == cur) {
            stack.extend(t.depends_on.iter().map(|d| d.as_str()));
        }
    }
    false
}

fn check_no_cycle(id: &str, deps: &[String], all: &[Task]) -> Result<(), String> {
    if would_create_cycle(id, deps, all) {
        Err(format!(
            "{id} cannot depend on {}: that would make a dependency cycle",
            deps.join(", ")
        ))
    } else {
        Ok(())
    }
}

/// Predecessors of `task` that are not finished yet. A predecessor counts as
/// resolved once its `status` is `done`; an id that matches no task is treated
/// as resolved too, so a deleted predecessor never pins a task forever.
pub fn unresolved_deps<'a>(task: &Task, all: &'a [Task]) -> Vec<&'a Task> {
    task.depends_on
        .iter()
        .filter_map(|d| all.iter().find(|t| &t.id == d))
        .filter(|t| t.status != "done")
        .collect()
}

/// Refuses to start `id` while a predecessor is still open. The message lists
/// each one so the caller can show it as-is; the UI asks for confirmation
/// first and passes `force` to skip this check.
pub fn check_startable(vault: &Path, id: &str) -> Result<(), String> {
    let all = scan_tasks(vault)?;
    let Some(task) = all.iter().find(|t| t.id == id) else {
        return Ok(());
    };
    let open = unresolved_deps(task, &all);
    if open.is_empty() {
        return Ok(());
    }
    let list = open
        .iter()
        .map(|t| format!("{} {} [{}]", t.id, t.title, t.status))
        .collect::<Vec<_>>()
        .join(", ");
    Err(format!("{id} depends on unfinished tasks: {list}"))
}

pub fn update_task(vault: &Path, input: UpdateTaskInput) -> Result<Task, String> {
    let mut task = find_task_by_id(vault, &input.id)?;
    if let Some(v) = input.title {
        task.title = v;
    }
    if let Some(v) = input.status {
        let was_done = task.status == "done";
        let now_done = v == "done";
        task.status = v;
        // The completion stamp belongs to the transition, not the state: it
        // is taken when `done` is entered, cleared when it is left, and never
        // touched otherwise — so saving a task that is already `done` keeps
        // its existing value, and an old `done` task without one keeps none.
        if now_done && !was_done {
            if task.completed.is_empty() {
                task.completed = now_datetime();
            }
        } else if !now_done && was_done {
            task.completed.clear();
        }
    }
    if let Some(v) = input.assignee {
        task.assignee = v;
    }
    if let Some(v) = input.project {
        task.project = v;
    }
    if let Some(v) = input.backlog {
        task.backlog = v;
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
    if let Some(v) = input.blocked_note {
        task.blocked_note = v;
    }
    if let Some(v) = input.blocked_since {
        task.blocked_since = v;
    }
    // Applied after the two detail fields so toggling the flag always wins:
    // unblocking clears the details, and blocking stamps today when the caller
    // didn't supply a date (the common case — a badge click or a bare toggle).
    if let Some(v) = input.blocked {
        task.blocked = v;
        if v {
            if task.blocked_since.is_empty() {
                task.blocked_since = today();
            }
        } else {
            task.blocked_note.clear();
            task.blocked_since.clear();
        }
    }
    if let Some(v) = input.depends_on {
        let deps = normalize_deps(v);
        if !deps.is_empty() {
            let all = scan_tasks(vault)?;
            check_no_cycle(&task.id, &deps, &all)?;
        }
        task.depends_on = deps;
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
    refresh_index(vault);
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
    backlog: &'a str,
    priority: &'a str,
    model: &'a str,
    order: Option<f64>,
    due: &'a str,
    tags: &'a [String],
    archived: bool,
    confirm: bool,
    worktree: bool,
    blocked: bool,
    blocked_note: &'a str,
    blocked_since: &'a str,
    depends_on: &'a [String],
    created: &'a str,
    updated: &'a str,
    completed: &'a str,
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
            backlog: &t.backlog,
            priority: &t.priority,
            model: &t.model,
            order: t.order,
            due: &t.due,
            tags: &t.tags,
            archived: t.archived,
            confirm: t.confirm,
            worktree: t.worktree,
            blocked: t.blocked,
            blocked_note: &t.blocked_note,
            blocked_since: &t.blocked_since,
            depends_on: &t.depends_on,
            created: &t.created,
            updated: &t.updated,
            completed: &t.completed,
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

/// Rewrites the index after a task file has already been written. The index is
/// derived data, so a failure here (typically Windows refusing to truncate
/// `tasks.json` while another process has it memory-mapped, os error 1224) is
/// logged and swallowed: the update itself succeeded, and returning the error
/// made a bulk archive stop after its first task (T-0917).
fn refresh_index(vault: &Path) {
    if let Err(e) = regenerate_index(vault) {
        crate::diag!("tasks: index rewrite failed after a task update: {e}");
    }
}

/// Convenience for the `list_tasks` command: scan and keep the index fresh
/// in the same call, since a scan already has everything the index needs.
pub fn scan_and_index(vault: &Path) -> Result<Vec<Task>, String> {
    let tasks = scan_tasks(vault)?;
    let _ = regenerate_index(vault);
    Ok(tasks)
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

    /// A task that belongs to no backlog item writes no `backlog:` line at
    /// all, so every task file written before T-0253 stays byte-identical; one
    /// that does belong to an item round-trips through the frontmatter.
    #[test]
    fn the_backlog_link_round_trips_and_is_absent_when_unset() {
        let vault = temp_vault("task-backlog");

        let plain = create_task(
            &vault,
            CreateTaskInput {
                title: "no item".into(),
                ..Default::default()
            },
        )
        .unwrap();
        let text = fs::read_to_string(&plain.file).unwrap();
        assert!(!text.contains("backlog:"), "frontmatter: {text}");

        let linked = create_task(
            &vault,
            CreateTaskInput {
                title: "an item".into(),
                project: Some("demo".into()),
                backlog: Some("B-007".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(linked.backlog, "B-007");
        let text = fs::read_to_string(&linked.file).unwrap();
        assert!(
            text.contains("project: demo\nbacklog: B-007\n"),
            "frontmatter: {text}"
        );
        assert_eq!(
            find_task_by_id(&vault, &linked.id).unwrap().backlog,
            "B-007"
        );

        // Clearing it drops the line again rather than writing an empty key.
        update_task(
            &vault,
            UpdateTaskInput {
                id: linked.id.clone(),
                backlog: Some(String::new()),
                ..Default::default()
            },
        )
        .unwrap();
        let text = fs::read_to_string(&linked.file).unwrap();
        assert!(!text.contains("backlog:"), "frontmatter: {text}");

        fs::remove_dir_all(&vault).ok();
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
                    backlog: String::new(),
                    priority: "medium".into(),
                    model: String::new(),
                    order: None,
                    due: String::new(),
                    tags: vec![],
                    archived: false,
                    confirm: false,
                    worktree: false,
                    blocked: false,
                    blocked_note: String::new(),
                    blocked_since: String::new(),
                    depends_on: vec![],
                    created: today(),
                    updated: today(),
                    completed: String::new(),
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
    fn update_survives_an_unwritable_index() {
        let vault = temp_vault("index-unwritable");
        let mut ids = Vec::new();
        for title in ["one", "two", "three"] {
            let t = create_task(
                &vault,
                CreateTaskInput {
                    title: title.into(),
                    ..Default::default()
                },
            )
            .unwrap();
            ids.push(t.id);
        }
        // A directory where the index file belongs makes every index write fail,
        // like Windows refusing to truncate a memory-mapped `tasks.json`.
        fs::remove_file(index_file(&vault)).unwrap();
        fs::create_dir(index_file(&vault)).unwrap();
        assert!(regenerate_index(&vault).is_err());

        // A bulk archive must not stop at the first task (T-0917).
        for id in &ids {
            let t = update_task(
                &vault,
                UpdateTaskInput {
                    id: id.clone(),
                    archived: Some(true),
                    ..Default::default()
                },
            )
            .unwrap();
            assert!(t.archived);
            assert!(PathBuf::from(&t.file).exists());
        }
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
    fn depends_on_round_trips_and_is_omitted_when_unset() {
        let vault = temp_vault("depends-on");
        let a = create_task(
            &vault,
            CreateTaskInput {
                title: "first".into(),
                ..Default::default()
            },
        )
        .unwrap();
        let raw = fs::read_to_string(&a.file).unwrap();
        assert!(!raw.contains("depends_on"), "raw frontmatter: {raw}");

        let b = create_task(
            &vault,
            CreateTaskInput {
                title: "second".into(),
                depends_on: Some(vec![a.id.clone(), " ".into(), a.id.clone()]),
                ..Default::default()
            },
        )
        .unwrap();
        // Blanks and duplicates are dropped.
        assert_eq!(b.depends_on, vec![a.id.clone()]);
        let raw = fs::read_to_string(&b.file).unwrap();
        assert!(
            raw.contains(&format!("depends_on: [{}]\n", a.id)),
            "raw frontmatter: {raw}"
        );

        let scanned = scan_tasks(&vault).unwrap();
        let reread = scanned.iter().find(|t| t.id == b.id).unwrap();
        assert_eq!(reread.depends_on, vec![a.id.clone()]);
        let index: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(index_file(&vault)).unwrap()).unwrap();
        assert!(index
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["id"] == b.id.as_str() && e["depends_on"][0] == a.id.as_str()));

        // An empty list clears the key from the file.
        let cleared = update_task(
            &vault,
            UpdateTaskInput {
                id: b.id.clone(),
                depends_on: Some(vec![]),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(cleared.depends_on.is_empty());
        let raw = fs::read_to_string(&b.file).unwrap();
        assert!(!raw.contains("depends_on"), "raw frontmatter: {raw}");

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn depends_on_block_list_is_read() {
        let raw =
            parse_frontmatter("id: T-0002\ntags: []\ndepends_on:\n  - T-0001\n  - \"T-0003\"\n");
        assert_eq!(raw.depends_on, vec!["T-0001", "T-0003"]);
        assert!(raw.tags.is_empty());
    }

    #[test]
    fn update_rejects_dependency_cycles() {
        let vault = temp_vault("dep-cycle");
        let mk = |title: &str, deps: Option<Vec<String>>| {
            create_task(
                &vault,
                CreateTaskInput {
                    title: title.into(),
                    depends_on: deps,
                    ..Default::default()
                },
            )
            .unwrap()
        };
        let a = mk("a", None);
        let b = mk("b", Some(vec![a.id.clone()]));
        let c = mk("c", Some(vec![b.id.clone()]));

        let set = |id: &str, deps: Vec<String>| {
            update_task(
                &vault,
                UpdateTaskInput {
                    id: id.into(),
                    depends_on: Some(deps),
                    ..Default::default()
                },
            )
        };
        // Self reference, a two-step loop and a three-step loop are all refused.
        assert!(set(&a.id, vec![a.id.clone()]).is_err());
        assert!(set(&a.id, vec![b.id.clone()]).is_err());
        let err = set(&a.id, vec![c.id.clone()]).unwrap_err();
        assert!(err.contains("cycle"), "error: {err}");
        // Nothing was written by the refused updates.
        assert!(find_task_by_id(&vault, &a.id)
            .unwrap()
            .depends_on
            .is_empty());
        // A non-loop is fine.
        assert!(set(&c.id, vec![a.id.clone(), b.id.clone()]).is_ok());

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn unresolved_deps_ignores_done_and_unknown_ids() {
        let vault = temp_vault("dep-unresolved");
        let mk = |title: &str, status: &str| {
            create_task(
                &vault,
                CreateTaskInput {
                    title: title.into(),
                    status: Some(status.into()),
                    ..Default::default()
                },
            )
            .unwrap()
        };
        let open = mk("open", "doing");
        let done = mk("done", "done");
        let waiting = create_task(
            &vault,
            CreateTaskInput {
                title: "waiting".into(),
                depends_on: Some(vec![open.id.clone(), done.id.clone(), "T-9999".into()]),
                ..Default::default()
            },
        )
        .unwrap();

        let all = scan_tasks(&vault).unwrap();
        let waiting = all.iter().find(|t| t.id == waiting.id).unwrap();
        let ids: Vec<&str> = unresolved_deps(waiting, &all)
            .iter()
            .map(|t| t.id.as_str())
            .collect();
        assert_eq!(ids, vec![open.id.as_str()]);

        // The start check reports the open predecessor and clears once it is done.
        let err = check_startable(&vault, &waiting.id).unwrap_err();
        assert!(err.contains(&open.id), "error: {err}");
        update_task(
            &vault,
            UpdateTaskInput {
                id: open.id.clone(),
                status: Some("done".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(check_startable(&vault, &waiting.id).is_ok());

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn blocked_round_trips_and_is_omitted_when_unset() {
        let vault = temp_vault("blocked");
        let task = create_task(
            &vault,
            CreateTaskInput {
                title: "waiting task".into(),
                ..Default::default()
            },
        )
        .unwrap();

        // A task that was never blocked carries none of the three lines.
        let raw = fs::read_to_string(&task.file).unwrap();
        assert!(!raw.contains("blocked"), "raw frontmatter: {raw}");

        let blocked = update_task(
            &vault,
            UpdateTaskInput {
                id: task.id.clone(),
                blocked: Some(true),
                blocked_note: Some("waiting for the vendor quote".into()),
                blocked_since: Some("2026-08-01".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(blocked.blocked);
        assert_eq!(blocked.blocked_note, "waiting for the vendor quote");
        assert_eq!(blocked.blocked_since, "2026-08-01");
        let raw = fs::read_to_string(&task.file).unwrap();
        assert!(raw.contains("blocked: true\n"), "raw frontmatter: {raw}");
        assert!(
            raw.contains("blocked_note: waiting for the vendor quote\n"),
            "raw frontmatter: {raw}"
        );
        assert!(
            raw.contains("blocked_since: 2026-08-01\n"),
            "raw frontmatter: {raw}"
        );

        // Re-scan and index carry the fields.
        let scanned = scan_tasks(&vault).unwrap();
        assert!(scanned[0].blocked);
        assert_eq!(scanned[0].blocked_note, "waiting for the vendor quote");
        let index: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(index_file(&vault)).unwrap()).unwrap();
        assert_eq!(index[0]["blocked"], true);
        assert_eq!(index[0]["blocked_since"], "2026-08-01");

        // Unblocking clears the details along with the flag, so no stale note
        // or date is left behind in the file.
        let cleared = update_task(
            &vault,
            UpdateTaskInput {
                id: task.id.clone(),
                blocked: Some(false),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(!cleared.blocked);
        assert!(cleared.blocked_note.is_empty() && cleared.blocked_since.is_empty());
        let raw = fs::read_to_string(&task.file).unwrap();
        assert!(!raw.contains("blocked"), "raw frontmatter: {raw}");

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn blocking_without_a_date_stamps_today() {
        let vault = temp_vault("blocked-today");
        let task = create_task(
            &vault,
            CreateTaskInput {
                title: "badge click".into(),
                ..Default::default()
            },
        )
        .unwrap();

        let blocked = update_task(
            &vault,
            UpdateTaskInput {
                id: task.id.clone(),
                blocked: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(blocked.blocked_since, today());

        // A later edit that only touches the note keeps the original date.
        let renoted = update_task(
            &vault,
            UpdateTaskInput {
                id: task.id.clone(),
                blocked_note: Some("still waiting".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(renoted.blocked_since, today());
        assert_eq!(renoted.blocked_note, "still waiting");

        fs::remove_dir_all(&vault).ok();
    }

    /// `completed: YYYY-MM-DD HH:MM` is stamped when `done` is entered and
    /// cleared when it is left (T-0727).
    #[test]
    fn completed_is_stamped_on_done_and_cleared_after() {
        let vault = temp_vault("completed");
        let task = create_task(
            &vault,
            CreateTaskInput {
                title: "finish me".into(),
                status: Some("todo".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(task.completed.is_empty());
        assert!(
            !fs::read_to_string(&task.file)
                .unwrap()
                .contains("completed:"),
            "a task that was never done carries no line"
        );

        let done = update_task(
            &vault,
            UpdateTaskInput {
                id: task.id.clone(),
                status: Some("done".into()),
                ..Default::default()
            },
        )
        .unwrap();
        // `YYYY-MM-DD HH:MM`: 16 chars, with the separators where they belong.
        assert_eq!(done.completed.len(), 16, "completed was {}", done.completed);
        assert_eq!(&done.completed[4..5], "-");
        assert_eq!(&done.completed[10..11], " ");
        assert_eq!(&done.completed[13..14], ":");
        let raw = fs::read_to_string(&done.file).unwrap();
        assert!(
            raw.contains(&format!(
                "updated: {}\ncompleted: {}\n",
                done.updated, done.completed
            )),
            "the stamp sits right after `updated`: {raw}"
        );

        // Saving a task that is already `done` keeps its existing value.
        let redone = update_task(
            &vault,
            UpdateTaskInput {
                id: task.id.clone(),
                status: Some("done".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(redone.completed, done.completed);

        // Leaving `done` clears the stamp and drops the line.
        let reopened = update_task(
            &vault,
            UpdateTaskInput {
                id: task.id.clone(),
                status: Some("doing".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(reopened.completed.is_empty());
        let raw = fs::read_to_string(&reopened.file).unwrap();
        assert!(!raw.contains("completed:"), "raw frontmatter: {raw}");

        // The index carries the stamp while done and empties with it.
        let index: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(index_file(&vault)).unwrap()).unwrap();
        assert_eq!(index[0]["completed"], "");

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn done_without_a_stamp_keeps_none_until_it_moves() {
        let vault = temp_vault("completed-legacy");
        let mut task = create_task(
            &vault,
            CreateTaskInput {
                title: "old done".into(),
                status: Some("todo".into()),
                ..Default::default()
            },
        )
        .unwrap();
        // Simulate a task finished before T-0727: `done` with no `completed:`.
        task.status = "done".into();
        write_task_file(&task).unwrap();

        // A save that stays `done` must not invent a time.
        let kept = update_task(
            &vault,
            UpdateTaskInput {
                id: task.id.clone(),
                status: Some("done".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(kept.completed.is_empty());
        assert!(
            !fs::read_to_string(&kept.file)
                .unwrap()
                .contains("completed:"),
            "no value was invented"
        );

        // Re-entering `done` after leaving stamps the moment, as usual.
        update_task(
            &vault,
            UpdateTaskInput {
                id: task.id.clone(),
                status: Some("doing".into()),
                ..Default::default()
            },
        )
        .unwrap();
        let redone = update_task(
            &vault,
            UpdateTaskInput {
                id: task.id.clone(),
                status: Some("done".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(redone.completed.len(), 16);

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn completed_round_trips_and_a_no_op_save_changes_nothing() {
        let vault = temp_vault("completed-roundtrip");
        let task = create_task(
            &vault,
            CreateTaskInput {
                title: "stamped".into(),
                status: Some("todo".into()),
                ..Default::default()
            },
        )
        .unwrap();

        // A file carrying the field round-trips through parse and write.
        let mut stamped = parse_task_file(&PathBuf::from(&task.file)).unwrap();
        stamped.status = "done".into();
        stamped.completed = "2026-02-03 04:05".into();
        write_task_file(&stamped).unwrap();
        let reparsed = parse_task_file(&PathBuf::from(&task.file)).unwrap();
        assert_eq!(reparsed.status, "done");
        assert_eq!(reparsed.completed, "2026-02-03 04:05");

        // A no-op save of that file (its `updated` already is today) leaves
        // every byte untouched, field included.
        let before = fs::read(&task.file).unwrap();
        update_task(
            &vault,
            UpdateTaskInput {
                id: task.id.clone(),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(fs::read(&task.file).unwrap(), before);

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn file_without_completed_is_untouched_by_a_no_op_save() {
        let vault = temp_vault("completed-absent");
        let task = create_task(
            &vault,
            CreateTaskInput {
                title: "plain".into(),
                ..Default::default()
            },
        )
        .unwrap();
        // Pre-T-0727 shape: no `completed:` line, `updated` already today.
        let before = fs::read(&task.file).unwrap();
        assert!(!String::from_utf8_lossy(&before).contains("completed:"));

        update_task(
            &vault,
            UpdateTaskInput {
                id: task.id.clone(),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(fs::read(&task.file).unwrap(), before);

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
}
