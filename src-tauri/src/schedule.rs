//! Schedule notes: scanning, reading/writing, and snapshots (T-0088..T-0091).
//!
//! A schedule note is one `projects/<slug>/schedules/<name>.md` file. It is a
//! *thinking* surface, not a record: the user drags bars around until the plan
//! looks right, so writes are frequent and come from three directions — the
//! app, Obsidian, and (phase 4) a headless agent.
//!
//! Two consequences shape this module:
//!
//! - **The element notation is not parsed here.** Rust only ever handles the
//!   file as a whole string. The `## Items` / `## Non-working` grammar is
//!   interpreted in `src/lib/schedule/parse.ts`, because the HTML exporter
//!   needs exactly the same interpretation and a second implementation would
//!   drift from the first (see the design note, §10.1).
//! - **Writes are guarded by mtime.** `write_schedule` refuses to overwrite a
//!   file that changed since the caller read it, rather than silently
//!   discarding an Obsidian or agent edit.
//!
//! Frontmatter handling mirrors `tasks.rs`: the block is rewritten key by key
//! and everything after it is preserved byte-for-byte. Here that guarantee is
//! *stronger* — `write_schedule` takes the whole file content from the caller,
//! so `## Memo` and any unmanaged frontmatter key survive by construction.

use crate::models::{ScheduleDoc, ScheduleFile};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// Subfolder of a project that holds its schedule notes.
const SCHEDULES_DIR: &str = "schedules";

/// Where `run_schedule_edit` parks a copy of the file before an agent touches
/// it, so the UI can offer a one-generation undo (design note §9.5).
const SNAPSHOT_DIR: &[&str] = &["_ai", "memory", "schedule-snapshots"];

fn norm_path(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

fn mtime_secs(p: &Path) -> u64 {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Splits `---\n<frontmatter>\n---\n<body>`; same contract as the task parser.
/// Returns `None` for a file with no (or an unterminated) frontmatter block —
/// such a file is simply not a schedule note and is skipped by the scan.
fn split_frontmatter(content: &str) -> Option<(String, String)> {
    let mut lines = content.split_inclusive('\n');
    let first = lines.next()?;
    if first.trim_end_matches(['\r', '\n']) != "---" {
        return None;
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
        return None;
    }
    Some((front, content[consumed..].to_string()))
}

fn unquote(s: &str) -> String {
    let s = s.trim();
    if s.len() >= 2 {
        let b = s.as_bytes();
        if (b[0] == b'"' && b[s.len() - 1] == b'"') || (b[0] == b'\'' && b[s.len() - 1] == b'\'') {
            return s[1..s.len() - 1].to_string();
        }
    }
    s.to_string()
}

/// Reads the flat scalars the schedule picker needs. Unknown keys are ignored
/// (and preserved on write, since writes carry the whole file).
fn frontmatter_value(front: &str, key: &str) -> String {
    for line in front.lines() {
        let Some(idx) = line.find(':') else { continue };
        if line[..idx].trim() == key {
            return unquote(&line[idx + 1..]);
        }
    }
    String::new()
}

fn projects_dir(vault: &Path) -> PathBuf {
    vault.join("projects")
}

/// Lists schedule notes across the vault, optionally narrowed to one project
/// slug. Files that are not schedule notes (no frontmatter, or `type` set to
/// something else) are skipped rather than failing the scan, so a stray note
/// dropped into `schedules/` never breaks the picker.
pub fn list_schedules(vault: &Path, project: Option<&str>) -> Result<Vec<ScheduleFile>, String> {
    let root = projects_dir(vault);
    let mut out = Vec::new();
    if !root.is_dir() {
        return Ok(out);
    }
    for entry in fs::read_dir(&root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let slug = entry.file_name().to_string_lossy().to_string();
        if let Some(want) = project {
            if !want.is_empty() && want != slug {
                continue;
            }
        }
        let dir = entry.path().join(SCHEDULES_DIR);
        if !dir.is_dir() {
            continue;
        }
        for file in fs::read_dir(&dir).map_err(|e| e.to_string())? {
            let file = file.map_err(|e| e.to_string())?;
            let path = file.path();
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if name.starts_with('_') {
                continue; // `_index.md`, `_example.md`, and friends
            }
            let Ok(content) = fs::read_to_string(&path) else {
                continue;
            };
            let Some((front, _)) = split_frontmatter(&content) else {
                continue;
            };
            let kind = frontmatter_value(&front, "type");
            if !kind.is_empty() && kind != "schedule" {
                continue;
            }
            let title = {
                let t = frontmatter_value(&front, "title");
                if t.is_empty() {
                    name.trim_end_matches(".md").to_string()
                } else {
                    t
                }
            };
            out.push(ScheduleFile {
                path: norm_path(&path),
                project: slug.clone(),
                title,
                range: frontmatter_value(&front, "range"),
                updated: frontmatter_value(&front, "updated"),
            });
        }
    }
    out.sort_by(|a, b| (&a.project, &a.title).cmp(&(&b.project, &b.title)));
    Ok(out)
}

pub fn read_schedule(path: &Path) -> Result<ScheduleDoc, String> {
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    Ok(ScheduleDoc {
        path: norm_path(path),
        content,
        mtime: mtime_secs(path),
    })
}

/// Minimal structural check before a write. Deliberately shallow: the element
/// grammar is validated on the frontend, and rejecting a file here for a
/// notation slip would block the user from saving their way out of it. What
/// this *does* catch is a caller about to write something that is not a
/// schedule note at all (a truncated string, an empty buffer from a failed
/// render), which would silently destroy the file.
fn validate(content: &str) -> Result<(), String> {
    let Some((_, body)) = split_frontmatter(content) else {
        return Err("schedule content must start with a frontmatter block".into());
    };
    if !body.contains("## Items") {
        return Err("schedule content is missing the `## Items` section".into());
    }
    if !body.contains("## Non-working") {
        return Err("schedule content is missing the `## Non-working` section".into());
    }
    Ok(())
}

/// Writes the file only when its on-disk mtime still matches `expected_mtime`,
/// so a concurrent Obsidian/agent edit is reported instead of overwritten.
/// Pass `0` to skip the check (used when creating a file that cannot yet have
/// been edited elsewhere).
///
/// Returns the new mtime so the caller can keep guarding subsequent writes
/// without a re-read.
pub fn write_schedule(path: &Path, content: &str, expected_mtime: u64) -> Result<u64, String> {
    validate(content)?;
    if expected_mtime != 0 && path.exists() {
        let current = mtime_secs(path);
        if current != expected_mtime {
            return Err(
                "the schedule file changed on disk since it was loaded — reload before saving"
                    .into(),
            );
        }
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, content).map_err(|e| e.to_string())?;
    Ok(mtime_secs(path))
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
        "schedule".to_string()
    } else {
        trimmed.to_string()
    }
}

fn today() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (y, m, d) = civil_from_days((secs / 86_400) as i64);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Howard Hinnant's `civil_from_days` (same rationale as `tasks.rs`: a single
/// "today" stamp does not justify a date/time crate).
fn civil_from_days(z: i64) -> (i32, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m, d)
}

/// Creates `projects/<project>/schedules/<title>.md` from the skeleton. The
/// weekend default in `## Non-working` is what makes a fresh note immediately
/// useful — the working-day count is the point of the feature, and a note with
/// no non-working days would report every calendar day as workable.
pub fn create_schedule(
    vault: &Path,
    project: &str,
    title: &str,
    range: &str,
) -> Result<ScheduleFile, String> {
    let project = project.trim();
    if project.is_empty() {
        return Err("a project is required to create a schedule".into());
    }
    let dir = projects_dir(vault).join(project).join(SCHEDULES_DIR);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let title = if title.trim().is_empty() {
        "schedule"
    } else {
        title.trim()
    };
    let mut path = dir.join(format!("{}.md", sanitize_filename(title)));
    // Never clobber an existing note: suffix until the name is free.
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{} {n}.md", sanitize_filename(title)));
        n += 1;
    }
    let now = today();
    let content = format!(
        "---\ntype: schedule\ntitle: {title}\nrange: {range}\ncreated: {now}\nupdated: {now}\n---\n\n\
## Non-working\n\n- weekly: sat, sun\n\n## Items\n\n## Memo\n\n"
    );
    fs::write(&path, &content).map_err(|e| e.to_string())?;
    Ok(ScheduleFile {
        path: norm_path(&path),
        project: project.to_string(),
        title: title.to_string(),
        range: range.to_string(),
        updated: now,
    })
}

/// Writes a generated HTML export. Kept in Rust (rather than a frontend
/// download) so the default destination can be the project's `attachments/`
/// folder inside the vault — the export is part of the project record, not a
/// browser download.
pub fn export_html(out_path: &Path, html: &str) -> Result<(), String> {
    if let Some(parent) = out_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(out_path, html).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------
// snapshots (undo for AI edits)
// ---------------------------------------------------------------------

fn snapshot_dir(vault: &Path) -> PathBuf {
    SNAPSHOT_DIR
        .iter()
        .fold(vault.to_path_buf(), |p, s| p.join(s))
}

/// One snapshot per schedule file, keyed by a flattened form of its
/// vault-relative path. Only one generation is kept: the undo this backs is
/// "that AI run was wrong, put it back", and a deeper history would need a UI
/// to choose from — the vault's git backup covers anything older (§9.5).
fn snapshot_path(vault: &Path, target: &Path) -> PathBuf {
    let rel = norm_path(target)
        .strip_prefix(&norm_path(vault))
        .unwrap_or(&norm_path(target))
        .trim_start_matches('/')
        .replace(['/', ' '], "_");
    snapshot_dir(vault).join(format!("{rel}.bak"))
}

pub fn save_snapshot(vault: &Path, target: &Path) -> Result<(), String> {
    let content = fs::read_to_string(target).map_err(|e| e.to_string())?;
    let path = snapshot_path(vault, target);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, content).map_err(|e| e.to_string())
}

/// Restores the schedule from its snapshot and consumes it, so "undo" is
/// exactly one generation deep and cannot be pressed twice against a snapshot
/// that no longer describes a state the user wants back.
///
/// The mtime check is deliberately *not* applied: the whole point is to
/// discard whatever an agent just wrote.
pub fn restore_snapshot(vault: &Path, target: &Path) -> Result<ScheduleDoc, String> {
    let path = snapshot_path(vault, target);
    let content = fs::read_to_string(&path)
        .map_err(|_| "no snapshot is available for this schedule".to_string())?;
    fs::write(target, &content).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(&path);
    read_schedule(target)
}

pub fn has_snapshot(vault: &Path, target: &Path) -> bool {
    snapshot_path(vault, target).exists()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_vault(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("workhub-sched-{name}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn create_then_list_finds_the_note() {
        let vault = temp_vault("create-list");
        let created =
            create_schedule(&vault, "demo", "2026Q3 plan", "2026-07-20..2026-08-31").unwrap();
        assert!(created
            .path
            .ends_with("projects/demo/schedules/2026Q3 plan.md"));

        let listed = list_schedules(&vault, None).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].title, "2026Q3 plan");
        assert_eq!(listed[0].project, "demo");
        assert_eq!(listed[0].range, "2026-07-20..2026-08-31");

        // Filtering by another project hides it.
        assert!(list_schedules(&vault, Some("other")).unwrap().is_empty());
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn create_never_overwrites_an_existing_note() {
        let vault = temp_vault("create-dup");
        let a = create_schedule(&vault, "demo", "plan", "").unwrap();
        let b = create_schedule(&vault, "demo", "plan", "").unwrap();
        assert_ne!(a.path, b.path);
        assert!(b.path.ends_with("plan 2.md"));
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn write_preserves_memo_and_unmanaged_frontmatter() {
        let vault = temp_vault("write-preserve");
        let created = create_schedule(&vault, "demo", "plan", "").unwrap();
        let path = PathBuf::from(&created.path);

        let hand_written = "---\ntype: schedule\ntitle: plan\nrange: \nowner: someone\n\
created: 2026-07-24\nupdated: 2026-07-24\n---\n\n## Non-working\n\n- weekly: sat, sun\n\n\
## Items\n\n- [bar] I-001 2026-07-21..2026-08-07 build\n\n## Memo\n\nhuman prose\n";
        write_schedule(&path, hand_written, 0).unwrap();

        let doc = read_schedule(&path).unwrap();
        assert!(doc.content.contains("owner: someone"));
        assert!(doc.content.contains("human prose"));
        assert!(doc.mtime > 0);
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn write_rejects_a_stale_mtime() {
        let vault = temp_vault("write-stale");
        let created = create_schedule(&vault, "demo", "plan", "").unwrap();
        let path = PathBuf::from(&created.path);
        let doc = read_schedule(&path).unwrap();
        let body = doc.content.clone();

        // A mtime that never matches stands in for an external edit.
        let err = write_schedule(&path, &body, doc.mtime + 9_999).unwrap_err();
        assert!(err.contains("changed on disk"), "unexpected error: {err}");

        // The matching mtime is accepted.
        write_schedule(&path, &body, doc.mtime).unwrap();
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn write_rejects_content_that_is_not_a_schedule() {
        let vault = temp_vault("write-invalid");
        let created = create_schedule(&vault, "demo", "plan", "").unwrap();
        let path = PathBuf::from(&created.path);

        assert!(write_schedule(&path, "", 0).is_err());
        assert!(write_schedule(&path, "no frontmatter here", 0).is_err());
        assert!(write_schedule(&path, "---\ntype: schedule\n---\n\n## Items\n", 0).is_err());
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn snapshot_round_trips() {
        let vault = temp_vault("snapshot");
        let created = create_schedule(&vault, "demo", "plan", "").unwrap();
        let path = PathBuf::from(&created.path);
        let original = read_schedule(&path).unwrap().content;

        assert!(!has_snapshot(&vault, &path));
        save_snapshot(&vault, &path).unwrap();
        assert!(has_snapshot(&vault, &path));

        let edited = original.replace("## Items\n", "## Items\n\n- [note] I-001 2026-07-21 x\n");
        write_schedule(&path, &edited, 0).unwrap();
        assert_ne!(read_schedule(&path).unwrap().content, original);

        let restored = restore_snapshot(&vault, &path).unwrap();
        assert_eq!(restored.content, original);
        // One generation only: the snapshot is consumed by the restore.
        assert!(!has_snapshot(&vault, &path));
        assert!(restore_snapshot(&vault, &path).is_err());
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn list_skips_non_schedule_notes() {
        let vault = temp_vault("list-skip");
        create_schedule(&vault, "demo", "plan", "").unwrap();
        let dir = vault.join("projects").join("demo").join(SCHEDULES_DIR);
        fs::write(dir.join("_example.md"), "---\ntype: schedule\n---\n").unwrap();
        fs::write(dir.join("stray.md"), "just prose, no frontmatter\n").unwrap();
        fs::write(dir.join("other.md"), "---\ntype: note\ntitle: x\n---\n").unwrap();

        let listed = list_schedules(&vault, Some("demo")).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].title, "plan");
        fs::remove_dir_all(&vault).ok();
    }
}
