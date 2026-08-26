//! Shared machinery for the vault's *note* features — the file-backed
//! surfaces that live under `projects/<slug>/<kind>/` and are edited from the
//! app, from Obsidian, and by agents at the same time (schedules: T-0088..;
//! mindmaps: T-0188).
//!
//! Every such feature needs the same handful of primitives: split the
//! frontmatter without disturbing the body, read a flat scalar out of it,
//! turn a title into a collision-free file name, stamp today's date, and park
//! a one-generation snapshot before an agent writes. They were written once
//! for schedules; this module is where the second feature borrows them from
//! rather than copying them.
//!
//! What is deliberately *not* here: the body grammar of any note kind. A
//! schedule's `## Items` and a mindmap's `## Nodes` are interpreted on the
//! frontend, so the backend only ever handles a note as a whole string.

use include_dir::Dir;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// Absolute path with forward slashes — the form every model field uses, so
/// that a path compares equal regardless of which API produced it.
pub fn norm_path(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

pub fn mtime_secs(p: &Path) -> u64 {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Splits `---\n<frontmatter>\n---\n<body>`; same contract as the task parser.
/// Returns `None` for a file with no (or an unterminated) frontmatter block —
/// such a file is simply not a note of any kind and is skipped by a scan.
pub fn split_frontmatter(content: &str) -> Option<(String, String)> {
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

/// Reads a flat scalar a picker needs. Unknown keys are ignored (and preserved
/// on write, since writes carry the whole file).
pub fn frontmatter_value(front: &str, key: &str) -> String {
    for line in front.lines() {
        let Some(idx) = line.find(':') else { continue };
        if line[..idx].trim() == key {
            return unquote(&line[idx + 1..]);
        }
    }
    String::new()
}

/// Rewrites the listed keys in a frontmatter block, appending any that were
/// missing and carrying every other line through byte-for-byte. Returns the
/// block's inner text (no `---` fences).
///
/// This is the half of "preserve the body" that applies to the frontmatter:
/// a note may carry keys no version of the app knows about, and a rename must
/// not be the thing that drops them.
pub fn rewrite_frontmatter(front: &str, updates: &[(&str, &str)]) -> String {
    let mut out = String::new();
    let mut seen = vec![false; updates.len()];
    for line in front.lines() {
        let key = line.find(':').map(|i| line[..i].trim()).unwrap_or_default();
        match updates.iter().position(|(k, _)| *k == key) {
            Some(i) => {
                out.push_str(&format!("{}: {}\n", updates[i].0, updates[i].1));
                seen[i] = true;
            }
            None => {
                out.push_str(line);
                out.push('\n');
            }
        }
    }
    for (i, (key, value)) in updates.iter().enumerate() {
        if !seen[i] {
            out.push_str(&format!("{key}: {value}\n"));
        }
    }
    out
}

/// Maps a note title onto a file name Windows and Obsidian both accept.
/// `fallback` names the note kind, and is used when nothing survives cleaning.
pub fn sanitize_filename(title: &str, fallback: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

/// `<dir>/<title>.md`, suffixed until the name is free. `keep` names a file
/// that is not a collision with itself — a rename to the same (or only
/// differently cased) title must not produce "plan 2".
pub fn unique_note_path(dir: &Path, title: &str, fallback: &str, keep: Option<&Path>) -> PathBuf {
    let base = sanitize_filename(title, fallback);
    let is_keep = |candidate: &Path| match keep {
        Some(k) => norm_path(candidate).eq_ignore_ascii_case(&norm_path(k)),
        None => false,
    };
    let mut path = dir.join(format!("{base}.md"));
    let mut n = 2;
    while path.exists() && !is_keep(&path) {
        path = dir.join(format!("{base} {n}.md"));
        n += 1;
    }
    path
}

pub fn today() -> String {
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

// ---------------------------------------------------------------------
// projects
// ---------------------------------------------------------------------

/// Note-kind subfolders a freshly scaffolded project gets, so that a new
/// project is immediately usable from every note tab instead of only from the
/// one that happens to create the folder on first save.
const NOTE_DIRS: &[&str] = &["schedules", "mindmaps"];

pub fn projects_dir(vault: &Path) -> PathBuf {
    vault.join("projects")
}

/// Project slugs the vault has, i.e. the folder names under `projects/`.
///
/// A picker cannot derive this from existing notes: a vault with no notes yet
/// would offer no projects, and "create a note" needs a project first — which
/// is a deadlock, not an empty state.
///
/// Folders starting with `_` (the zone index and any scratch area) are not
/// projects and are skipped.
pub fn list_projects(vault: &Path) -> Result<Vec<String>, String> {
    let root = projects_dir(vault);
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(&root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('_') || name.starts_with('.') {
            continue;
        }
        out.push(name);
    }
    out.sort();
    Ok(out)
}

/// Creates `projects/<slug>/` from the embedded project scaffold (T-0178).
///
/// The picker above lists folders under `projects/`, and until this existed a
/// vault with no projects dead-ended the note tabs: nothing to pick, and no
/// way to make one from inside the app. `name` fills the scaffold's
/// `<Project name>` placeholder (the slug stands in when it is empty), the
/// slug fills `<project-slug>`, and `{{DATE}}` becomes today. Files whose
/// names contain "example" demonstrate the notation and are skipped, so a
/// fresh project starts clean.
///
/// An existing folder is refused rather than merged: scaffolding is for
/// starting a project, and the template update flow owns any later changes.
pub fn create_project(vault: &Path, slug: &str, name: &str) -> Result<(), String> {
    let slug = slug.trim();
    if slug.is_empty() {
        return Err("a project slug is required".into());
    }
    if slug == ".." || slug.contains(['/', '\\']) {
        return Err("a project slug cannot contain path separators".into());
    }
    // `list_projects` skips such folders, so creating one would make a
    // project that exists on disk but can never be picked.
    if slug.starts_with('_') || slug.starts_with('.') {
        return Err("a project slug cannot start with '_' or '.'".into());
    }
    let dir = projects_dir(vault).join(slug);
    if dir.exists() {
        return Err(format!("a project named '{slug}' already exists"));
    }

    let template = crate::tasks::project_template()
        .ok_or_else(|| "the project template is missing from this build".to_string())?;
    let prefix = format!("{}/", crate::tasks::PROJECT_TEMPLATE_DIR);
    let display_name = match name.trim() {
        "" => slug,
        n => n,
    };
    let now = today();

    let mut files = Vec::new();
    walk_project_template(template, &mut files);
    for file in files {
        let full = norm_path(file.path());
        let Some(rel) = full.strip_prefix(&prefix) else {
            continue;
        };
        let file_name = rel.rsplit('/').next().unwrap_or(rel);
        if file_name.contains("example") {
            continue;
        }
        let dst = dir.join(rel);
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        match std::str::from_utf8(file.contents()) {
            Ok(text) => {
                let rendered = text
                    .replace("<Project name>", display_name)
                    .replace("<project-slug>", slug)
                    .replace("{{DATE}}", &now);
                fs::write(&dst, rendered).map_err(|e| e.to_string())?;
            }
            // Every scaffold file is text today; a future binary one must be
            // copied verbatim, not lossy-converted.
            Err(_) => fs::write(&dst, file.contents()).map_err(|e| e.to_string())?,
        }
    }
    // The scaffold's only content in these folders is the excluded example
    // note, so they would otherwise be missing until the first save.
    for sub in NOTE_DIRS {
        fs::create_dir_all(dir.join(sub)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Renders one file of the project scaffold into an existing project, but
/// only when it is missing — an existing file is never touched.
///
/// Creating a whole project is `create_project`; this is the single-file form
/// the Projects tab needs when a project predates a scaffold file it now has
/// to write into (linking a repo needs `_index.md`, and the vault's oldest
/// projects have none). Additive by construction, so it is safe to call on a
/// human-maintained folder.
pub fn ensure_scaffold_file(
    vault: &Path,
    slug: &str,
    name: &str,
    rel: &str,
) -> Result<PathBuf, String> {
    let dst = projects_dir(vault).join(slug).join(rel);
    if dst.exists() {
        return Ok(dst);
    }
    let template = crate::tasks::project_template()
        .ok_or_else(|| "the project template is missing from this build".to_string())?;
    let prefix = format!("{}/", crate::tasks::PROJECT_TEMPLATE_DIR);
    let mut files = Vec::new();
    walk_project_template(template, &mut files);
    let file = files
        .iter()
        .find(|f| norm_path(f.path()).strip_prefix(&prefix) == Some(rel))
        .ok_or_else(|| format!("'{rel}' is not part of the project template"))?;
    let text = std::str::from_utf8(file.contents())
        .map_err(|_| format!("'{rel}' is not a text template"))?;
    let display_name = match name.trim() {
        "" => slug,
        n => n,
    };
    let rendered = text
        .replace("<Project name>", display_name)
        .replace("<project-slug>", slug)
        .replace("{{DATE}}", &today());
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&dst, rendered).map_err(|e| e.to_string())?;
    Ok(dst)
}

fn walk_project_template<'a>(dir: &'a Dir<'a>, out: &mut Vec<&'a include_dir::File<'a>>) {
    for file in dir.files() {
        out.push(file);
    }
    for sub in dir.dirs() {
        walk_project_template(sub, out);
    }
}

// ---------------------------------------------------------------------
// scanning
// ---------------------------------------------------------------------

/// One note found by [`scan_notes`], handed back with its frontmatter block
/// unparsed so each feature can read the keys it cares about.
pub struct NoteScan {
    pub path: PathBuf,
    /// Owning project slug (the `projects/<slug>/` folder name).
    pub project: String,
    /// File name without the `.md` extension — the title fallback.
    pub name: String,
    pub front: String,
}

/// Walks `projects/*/<subdir>/*.md`, optionally narrowed to one project slug.
///
/// Files that are not notes of this kind (no frontmatter, or `type` set to
/// something else) are skipped rather than failing the scan, so a stray note
/// dropped into the folder never breaks a picker. Results are sorted by
/// project, then file name.
pub fn scan_notes(
    vault: &Path,
    subdir: &str,
    kind: &str,
    project: Option<&str>,
) -> Result<Vec<NoteScan>, String> {
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
        let dir = entry.path().join(subdir);
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
            let found = frontmatter_value(&front, "type");
            if !found.is_empty() && found != kind {
                continue;
            }
            out.push(NoteScan {
                name: name.trim_end_matches(".md").to_string(),
                path,
                project: slug.clone(),
                front,
            });
        }
    }
    out.sort_by(|a, b| (&a.project, &a.name).cmp(&(&b.project, &b.name)));
    Ok(out)
}

// ---------------------------------------------------------------------
// snapshots (undo for AI edits)
// ---------------------------------------------------------------------

/// One snapshot per note, keyed by a flattened form of its vault-relative
/// path, under `_ai/memory/<dir>/`. Only one generation is kept: the undo this
/// backs is "that AI run was wrong, put it back", and a deeper history would
/// need a UI to choose from — the vault's git backup covers anything older.
pub fn snapshot_path(vault: &Path, dir: &str, target: &Path) -> PathBuf {
    let target_norm = norm_path(target);
    let rel = target_norm
        .strip_prefix(&norm_path(vault))
        .unwrap_or(&target_norm)
        .trim_start_matches('/')
        .replace(['/', ' '], "_");
    vault
        .join("_ai")
        .join("memory")
        .join(dir)
        .join(format!("{rel}.bak"))
}

pub fn save_snapshot(vault: &Path, dir: &str, target: &Path) -> Result<(), String> {
    let content = fs::read_to_string(target).map_err(|e| e.to_string())?;
    let path = snapshot_path(vault, dir, target);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, content).map_err(|e| e.to_string())
}

/// Restores a note from its snapshot and consumes it, so "undo" is exactly one
/// generation deep and cannot be pressed twice against a snapshot that no
/// longer describes a state the user wants back.
///
/// No mtime check is applied: the whole point is to discard whatever an agent
/// just wrote.
pub fn restore_snapshot(vault: &Path, dir: &str, target: &Path, kind: &str) -> Result<(), String> {
    let path = snapshot_path(vault, dir, target);
    let content = fs::read_to_string(&path)
        .map_err(|_| format!("no snapshot is available for this {kind}"))?;
    fs::write(target, &content).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(&path);
    Ok(())
}

pub fn has_snapshot(vault: &Path, dir: &str, target: &Path) -> bool {
    snapshot_path(vault, dir, target).exists()
}

/// Moves a note's snapshot alongside a renamed note. A snapshot left behind at
/// the old key could never be found again, so the undo would silently vanish.
pub fn move_snapshot(vault: &Path, dir: &str, from: &Path, to: &Path) -> Result<(), String> {
    let (old, new) = (
        snapshot_path(vault, dir, from),
        snapshot_path(vault, dir, to),
    );
    if !old.exists() || old == new {
        return Ok(());
    }
    if let Some(parent) = new.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(&old, &new).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frontmatter_splits_and_reads_scalars() {
        let content = "---\ntype: mindmap\ntitle: \"a plan\"\n---\n\n## Nodes\n\n- N-001 root\n";
        let (front, body) = split_frontmatter(content).unwrap();
        assert_eq!(frontmatter_value(&front, "type"), "mindmap");
        assert_eq!(frontmatter_value(&front, "title"), "a plan");
        assert_eq!(frontmatter_value(&front, "missing"), "");
        assert!(body.starts_with("\n## Nodes"));
    }

    #[test]
    fn frontmatter_rejects_a_file_without_a_closed_block() {
        assert!(split_frontmatter("no frontmatter here").is_none());
        assert!(split_frontmatter("---\ntype: mindmap\n").is_none());
    }

    #[test]
    fn rewrite_frontmatter_preserves_unmanaged_keys_and_appends_missing_ones() {
        let front = "type: mindmap\ntitle: old\nowner: someone\n";
        let out = rewrite_frontmatter(front, &[("title", "new"), ("updated", "2026-08-26")]);
        assert_eq!(
            out,
            "type: mindmap\ntitle: new\nowner: someone\nupdated: 2026-08-26\n"
        );
    }

    #[test]
    fn sanitize_filename_replaces_reserved_characters() {
        assert_eq!(sanitize_filename("a/b:c", "note"), "a-b-c");
        assert_eq!(sanitize_filename("   ", "note"), "note");
        assert_eq!(
            sanitize_filename("日本語 の 名前", "note"),
            "日本語 の 名前"
        );
    }
}
