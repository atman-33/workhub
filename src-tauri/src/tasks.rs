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
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::RecvTimeoutError;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const TASKS_CHANGED_EVENT: &str = "tasks-changed";
const DEBOUNCE: Duration = Duration::from_millis(300);

fn tasks_dir(vault: &Path) -> PathBuf {
    vault.join("tasks")
}

fn index_file(vault: &Path) -> PathBuf {
    vault.join("_ai").join("index").join("tasks.json")
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
    format!(
        "---\nid: {}\ntitle: {}\nstatus: {}\nassignee: {}\nproject: {}\npriority: {}\n{}due: {}\ntags: {}\ncreated: {}\nupdated: {}\n---\n",
        t.id,
        yaml_scalar(&t.title),
        t.status,
        t.assignee,
        yaml_scalar(&t.project),
        t.priority,
        order_line,
        t.due,
        render_tags(&t.tags),
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
        order: raw.map.get("order").and_then(|v| v.parse::<f64>().ok()),
        due: get("due"),
        tags: raw.tags,
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
    let dir = tasks_dir(vault);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
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
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
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
    pub order: Option<f64>,
    pub due: Option<String>,
    pub tags: Option<Vec<String>>,
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
        order: Some(order),
        due: input.due.unwrap_or_default(),
        tags: input.tags.unwrap_or_default(),
        created: now.clone(),
        updated: now,
        file: file.to_string_lossy().replace('\\', "/"),
        body: input
            .body
            .unwrap_or_else(|| "\n## Description\n\n## Results\n".to_string()),
    };
    write_task_file(&task)?;
    regenerate_index(vault)?;
    Ok(task)
}

fn find_task_by_id(vault: &Path, id: &str) -> Result<Task, String> {
    let dir = tasks_dir(vault);
    let prefix = format!("{id} ");
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
    if let Some(v) = input.order {
        task.order = Some(v);
    }
    if let Some(v) = input.due {
        task.due = v;
    }
    if let Some(v) = input.tags {
        task.tags = v;
    }
    if let Some(v) = input.body {
        task.body = v;
    }
    task.updated = today();
    write_task_file(&task)?;
    regenerate_index(vault)?;
    Ok(task)
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
    order: Option<f64>,
    due: &'a str,
    tags: &'a [String],
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
            order: t.order,
            due: &t.due,
            tags: &t.tags,
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
// vault init (copy vault-template/)
// ---------------------------------------------------------------------

const TEMPLATE_MARKER: &str = "workhub-template:";
const TEMPLATE_VERSION: &str = "version=1";

/// Returns true for files that should be overwritten on init when they still
/// carry the official template marker. These files define AI behavior or task
/// schemas and must stay in sync with the app version.
fn is_template_managed(src_path: &Path, template_root: &Path) -> bool {
    let Ok(rel) = src_path.strip_prefix(template_root) else {
        return false;
    };
    rel == Path::new("CLAUDE.md") || rel == Path::new("templates/task.md")
}

/// Returns true for files that should be copied only on first init. User edits
/// are preserved across re-runs.
fn is_initial_only(src_path: &Path, template_root: &Path) -> bool {
    let Ok(rel) = src_path.strip_prefix(template_root) else {
        return false;
    };
    rel == Path::new("home.md")
        || rel == Path::new("tasks/_index.md")
        || rel == Path::new("knowledge/_index.md")
}

/// Checks whether a file still contains the official template marker, meaning
/// it has not been hand-edited and is safe to overwrite with a newer template.
fn has_template_marker(content: &str) -> bool {
    content.lines().any(|line| {
        let trimmed = line.trim();
        trimmed.starts_with("<!--")
            && trimmed.contains(TEMPLATE_MARKER)
            && trimmed.contains(TEMPLATE_VERSION)
            && trimmed.ends_with("-->")
    })
}

/// Copies `template_source` into `vault_path`, creating directories as needed.
///
/// Policy by file type:
/// - `CLAUDE.md` and `templates/task.md`: overwrite only when the destination
///   does not exist or still contains the official `workhub-template` marker.
/// - `home.md`, `tasks/_index.md`, and `knowledge/_index.md`: copy only when the
///   destination does not exist (first init only).
/// - `.gitkeep`: create only if missing; content is irrelevant.
/// - Other files: copy only when the destination does not exist.
pub fn init_vault(vault: &Path, template_source: &Path) -> Result<(), String> {
    if !template_source.exists() {
        return Err(format!(
            "template source not found: {}",
            template_source.display()
        ));
    }
    fs::create_dir_all(vault).map_err(|e| e.to_string())?;
    copy_template_dir(template_source, vault, template_source)
}

fn copy_template_dir(src: &Path, dst: &Path, template_root: &Path) -> Result<(), String> {
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        let file_type = entry.file_type().map_err(|e| e.to_string())?;

        if file_type.is_dir() {
            fs::create_dir_all(&dst_path).map_err(|e| e.to_string())?;
            copy_template_dir(&src_path, &dst_path, template_root)?;
            continue;
        }

        let name = src_path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if name == ".gitkeep" {
            // Ensure the directory exists; the keepfile itself is only a placeholder.
            if !dst_path.exists() {
                fs::copy(&src_path, &dst_path).map_err(|e| e.to_string())?;
            }
            continue;
        }

        if is_template_managed(&src_path, template_root) {
            let should_copy = if !dst_path.exists() {
                true
            } else {
                match fs::read_to_string(&dst_path) {
                    Ok(content) => has_template_marker(&content),
                    Err(_) => false, // unreadable or binary: leave untouched to be safe
                }
            };
            if should_copy {
                fs::copy(&src_path, &dst_path).map_err(|e| e.to_string())?;
            }
        } else if is_initial_only(&src_path, template_root) {
            if !dst_path.exists() {
                fs::copy(&src_path, &dst_path).map_err(|e| e.to_string())?;
            }
        } else if !dst_path.exists() {
            fs::copy(&src_path, &dst_path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
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

/// Starts (or restarts) watching `<vault>/tasks` for changes, debouncing
/// bursts of events (e.g. an editor's save-as-temp-then-rename) into a
/// single `tasks-changed` emit. Any per-event error from `notify` (a
/// transient OS/FS hiccup) is treated as "something changed" rather than
/// killing the loop, so the watcher stays alive for the app's lifetime.
pub fn start_watcher(
    app: AppHandle,
    state: &Mutex<Option<RecommendedWatcher>>,
    vault: PathBuf,
) -> Result<(), String> {
    let dir = tasks_dir(&vault);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let (tx, rx) = std::sync::mpsc::channel::<Result<Event, notify::Error>>();
    let mut watcher = notify::recommended_watcher(tx).map_err(|e| e.to_string())?;
    watcher
        .watch(&dir, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    let vault_for_thread = vault.clone();
    std::thread::spawn(move || loop {
        // Block for the first event of a new burst.
        if rx.recv().is_err() {
            break; // watcher dropped: channel closed, thread exits
        }
        // Drain further events within the debounce window.
        loop {
            match rx.recv_timeout(DEBOUNCE) {
                Ok(_) => continue,
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
        let _ = regenerate_index(&vault_for_thread);
        let _ = app.emit(TASKS_CHANGED_EVENT, ());
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
                    order: None,
                    due: String::new(),
                    tags: vec![],
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

    fn temp_template_dir() -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("workhub-template-{nanos}"))
    }

    fn write_template(template: &Path) {
        fs::create_dir_all(template.join("tasks")).unwrap();
        fs::create_dir_all(template.join("knowledge")).unwrap();
        fs::create_dir_all(template.join("templates")).unwrap();
        fs::create_dir_all(template.join("projects")).unwrap();
        fs::create_dir_all(template.join("_ai/index")).unwrap();
        fs::create_dir_all(template.join("attachments")).unwrap();

        fs::write(
            template.join("CLAUDE.md"),
            "<!-- workhub-template: version=1 -->\n# workhub vault\n",
        )
        .unwrap();
        fs::write(
            template.join("templates/task.md"),
            "---\nid:\ntitle:\n---\n\n<!-- workhub-template: version=1 -->\n\n## Description\n",
        )
        .unwrap();
        fs::write(template.join("home.md"), "# Home\n").unwrap();
        fs::write(template.join("tasks/_index.md"), "# Tasks index\n").unwrap();
        fs::write(template.join("knowledge/_index.md"), "# Knowledge index\n").unwrap();
        fs::write(template.join("projects/.gitkeep"), "").unwrap();
        fs::write(template.join("_ai/index/.gitkeep"), "").unwrap();
    }

    #[test]
    fn init_vault_copies_all_template_files() {
        let template = temp_template_dir();
        write_template(&template);

        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let vault = std::env::temp_dir().join(format!("workhub-init-{nanos}"));

        init_vault(&vault, &template).unwrap();

        assert!(vault.join("CLAUDE.md").exists());
        assert!(vault.join("templates/task.md").exists());
        assert!(vault.join("home.md").exists());
        assert!(vault.join("tasks/_index.md").exists());
        assert!(vault.join("knowledge/_index.md").exists());
        assert!(vault.join("projects/.gitkeep").exists());

        fs::remove_dir_all(&vault).ok();
        fs::remove_dir_all(&template).ok();
    }

    #[test]
    fn init_vault_overwrites_managed_files_only_when_unedited() {
        let template = temp_template_dir();
        write_template(&template);

        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let vault = std::env::temp_dir().join(format!("workhub-init-overwrite-{nanos}"));

        init_vault(&vault, &template).unwrap();

        // User edits a managed file.
        fs::write(vault.join("CLAUDE.md"), "# Custom rules\n").unwrap();

        // The template is updated (marker stays intact, content changes).
        fs::write(
            template.join("CLAUDE.md"),
            "<!-- workhub-template: version=1 -->\n# Updated rules\n",
        )
        .unwrap();

        init_vault(&vault, &template).unwrap();
        let claude = fs::read_to_string(vault.join("CLAUDE.md")).unwrap();
        assert!(
            claude.contains("# Custom rules"),
            "user-edited CLAUDE.md should be preserved"
        );

        // Unedited managed file is overwritten with the latest template.
        fs::write(
            template.join("templates/task.md"),
            "---\nid:\ntitle:\nnew-field: x\n---\n\n<!-- workhub-template: version=1 -->\n\n## Description\n",
        )
        .unwrap();
        init_vault(&vault, &template).unwrap();
        let task = fs::read_to_string(vault.join("templates/task.md")).unwrap();
        assert!(
            task.contains("new-field: x"),
            "unedited managed template should be updated"
        );

        // Initial-only files are never overwritten.
        fs::write(vault.join("home.md"), "# Custom home\n").unwrap();
        fs::write(vault.join("tasks/_index.md"), "# Custom tasks\n").unwrap();
        fs::write(vault.join("knowledge/_index.md"), "# Custom knowledge\n").unwrap();
        init_vault(&vault, &template).unwrap();
        assert!(fs::read_to_string(vault.join("home.md"))
            .unwrap()
            .contains("# Custom home"));
        assert!(fs::read_to_string(vault.join("tasks/_index.md"))
            .unwrap()
            .contains("# Custom tasks"));
        assert!(fs::read_to_string(vault.join("knowledge/_index.md"))
            .unwrap()
            .contains("# Custom knowledge"));

        fs::remove_dir_all(&vault).ok();
        fs::remove_dir_all(&template).ok();
    }
}
