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

/// True for a line that continues a block list started by the key above it
/// (`  - value`). Frontmatter in these notes is written by hand as often as by
/// the app, so the block form is the one to recognise.
fn is_list_item(line: &str) -> Option<String> {
    let trimmed = line.trim_start();
    if line.starts_with(char::is_whitespace) || trimmed.starts_with('-') {
        trimmed.strip_prefix('-').map(unquote)
    } else {
        None
    }
}

/// Reads a frontmatter key that holds several values.
///
/// Accepts all three shapes a hand-written note turns up in — a block list
/// (`repos:` then `  - value` lines), an inline list (`repos: [a, b]`), and a
/// bare scalar (`repos: a`) — because the vault is edited in Obsidian as well
/// as by the app, and refusing a shape only produces a link that silently
/// reads as absent. Empty entries are dropped.
pub fn frontmatter_list(front: &str, key: &str) -> Vec<String> {
    let mut lines = front.lines();
    let mut out = Vec::new();
    while let Some(line) = lines.next() {
        let Some(idx) = line.find(':') else { continue };
        if line[..idx].trim() != key {
            continue;
        }
        let rest = line[idx + 1..].trim();
        if let Some(inner) = rest.strip_prefix('[').and_then(|r| r.strip_suffix(']')) {
            out.extend(inner.split(',').map(unquote));
        } else if !rest.is_empty() {
            out.push(unquote(rest));
        } else {
            for line in lines.by_ref() {
                match is_list_item(line) {
                    Some(v) => out.push(v),
                    None => break,
                }
            }
        }
        break;
    }
    out.retain(|v| !v.trim().is_empty());
    out
}

/// Rewrites `key` as a block list, carrying every other line through
/// byte-for-byte. The key is appended when it was missing, and dropped
/// entirely when `items` is empty.
///
/// Separate from `rewrite_frontmatter` because a list key owns the indented
/// lines beneath it: replacing only the `key:` line would leave the previous
/// entries behind as orphans of a key that no longer claims them.
pub fn rewrite_frontmatter_list(front: &str, key: &str, items: &[String]) -> String {
    let mut out = String::new();
    let mut written = false;
    let mut skipping = false;
    for line in front.lines() {
        if skipping {
            if is_list_item(line).is_some() {
                continue;
            }
            skipping = false;
        }
        let this = line.find(':').map(|i| line[..i].trim()).unwrap_or_default();
        if this == key {
            skipping = true;
            write_list(&mut out, key, items);
            written = true;
            continue;
        }
        out.push_str(line);
        out.push('\n');
    }
    if !written {
        write_list(&mut out, key, items);
    }
    out
}

fn write_list(out: &mut String, key: &str, items: &[String]) {
    let items: Vec<&str> = items
        .iter()
        .map(|i| i.trim())
        .filter(|i| !i.is_empty())
        .collect();
    if items.is_empty() {
        return;
    }
    out.push_str(&format!("{key}:\n"));
    for item in items {
        out.push_str(&format!("  - {item}\n"));
    }
}

/// Drops `key` and any block-list lines beneath it. Used to retire a key the
/// app no longer writes, so a note it rewrites does not keep both spellings.
pub fn remove_frontmatter_key(front: &str, key: &str) -> String {
    let mut out = String::new();
    let mut skipping = false;
    for line in front.lines() {
        if skipping {
            if is_list_item(line).is_some() {
                continue;
            }
            skipping = false;
        }
        if line.find(':').map(|i| line[..i].trim()) == Some(key) {
            skipping = true;
            continue;
        }
        out.push_str(line);
        out.push('\n');
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

pub fn archive_projects_dir(vault: &Path) -> PathBuf {
    vault.join("archive").join("projects")
}

/// Parses a project folder name into its optional sort number and its slug —
/// the identity used everywhere a project is named: a task's `project:`, a
/// backlog item's `project:`, and the `<project-slug>` scaffold placeholder.
/// A number is a 4-digit zero-padded prefix followed by a hyphen
/// (`0010-workhub`); a folder with no such prefix has slug == folder name,
/// which is the same rule rather than a separate fallback (T-0278).
pub fn parse_project_folder(name: &str) -> (Option<u32>, &str) {
    if name.len() > 5
        && name.as_bytes()[4] == b'-'
        && name.as_bytes()[..4].iter().all(u8::is_ascii_digit)
    {
        if let Ok(n) = name[..4].parse::<u32>() {
            return (Some(n), &name[5..]);
        }
    }
    (None, name)
}

/// The folder name a project with this number and slug gets — the inverse of
/// [`parse_project_folder`].
pub fn project_folder_name(number: u32, slug: &str) -> String {
    format!("{number:04}-{slug}")
}

/// One folder under a projects root that answers to a given slug, found by
/// [`find_project_folders`].
pub struct ProjectMatch {
    pub folder: String,
    pub number: Option<u32>,
    pub path: PathBuf,
}

/// Every folder directly under `root` (`projects/` or `archive/projects/`)
/// whose stripped slug is `slug`. Usually one folder; more than one means two
/// folders claim the same identity, which a caller must not silently pick
/// between (T-0278). `_`/`.` folders are zone machinery, never projects, and
/// are skipped — the same rule every project scan already applies.
pub fn find_project_folders(root: &Path, slug: &str) -> Result<Vec<ProjectMatch>, String> {
    let mut out = Vec::new();
    if !root.is_dir() {
        return Ok(out);
    }
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('_') || name.starts_with('.') {
            continue;
        }
        let (number, s) = parse_project_folder(&name);
        if s == slug {
            out.push(ProjectMatch {
                folder: name,
                number,
                path: entry.path(),
            });
        }
    }
    Ok(out)
}

/// Resolves a slug to its one existing folder under `root`, or `Ok(None)`
/// when no folder answers to it. Two folders answering to the same slug is a
/// vault inconsistency, not a choice for the app to make silently — it is an
/// error here, and the Projects scan surfaces the same condition as a
/// `duplicate-slug` finding so the owner sees it without triggering it
/// (T-0278).
pub fn resolve_project_dir(root: &Path, slug: &str) -> Result<Option<PathBuf>, String> {
    let mut matches = find_project_folders(root, slug)?;
    match matches.len() {
        0 => Ok(None),
        1 => Ok(Some(matches.remove(0).path)),
        _ => Err(format!(
            "more than one folder under {} answers to the slug '{slug}' — rename one so it is unique",
            norm_path(root)
        )),
    }
}

/// The next project number to allocate: the highest existing number across
/// both `projects/` and `archive/projects/`, rounded up to the next multiple
/// of ten, or 10 when the vault has no numbered project yet. Both roots are
/// counted together so archiving a project never frees its number for reuse
/// (T-0278).
pub fn next_project_number(vault: &Path) -> u32 {
    let mut highest = 0u32;
    for root in [projects_dir(vault), archive_projects_dir(vault)] {
        let Ok(entries) = fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if let (Some(n), _) = parse_project_folder(&name) {
                highest = highest.max(n);
            }
        }
    }
    (highest / 10) * 10 + 10
}

/// Project slugs the vault has, i.e. the stripped slugs of the folders under
/// `projects/` (T-0278: a folder may carry a `NNNN-` sort prefix, which is
/// not part of the identity).
///
/// A picker cannot derive this from existing notes: a vault with no notes yet
/// would offer no projects, and "create a note" needs a project first — which
/// is a deadlock, not an empty state.
///
/// Folders starting with `_` (the zone index and any scratch area) are not
/// projects and are skipped. Two folders answering to the same slug collapse
/// to one entry here — a picker has nothing useful to do with a duplicate,
/// and the Projects tab is where that inconsistency is reported.
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
        let (_, slug) = parse_project_folder(&name);
        out.push(slug.to_string());
    }
    out.sort();
    out.dedup();
    Ok(out)
}

/// Fills the project scaffold's placeholders for one project.
///
/// `<Project name>` becomes `name` (the slug stands in when it is blank),
/// `<project-slug>` becomes `slug`, and `{{DATE}}` becomes today. Shared by
/// every path that renders scaffold content — whole-project creation,
/// single-file backfill, and the template sync of per-project copies
/// (`tasks::project_copies`) — so the three cannot drift apart. That last one
/// compares its output against what is on disk, which only works while every
/// renderer produces the same bytes.
pub fn render_project_scaffold(text: &str, slug: &str, name: &str) -> String {
    let display_name = match name.trim() {
        "" => slug,
        n => n,
    };
    text.replace("<Project name>", display_name)
        .replace("<project-slug>", slug)
        .replace("{{DATE}}", &today())
}

/// Checks a caller-supplied project slug for the constraints every creation
/// path shares, and rejects it against both `projects/` and
/// `archive/projects/` — a slug already used by an archived project is not
/// available either, since restoring it later would collide.
fn check_new_project_slug(vault: &Path, slug: &str) -> Result<(), String> {
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
    if parse_project_folder(slug).0.is_some() {
        return Err(
            "a project slug cannot start with a number and a hyphen — the sort number is assigned automatically"
                .into(),
        );
    }
    if let Some(existing) = find_project_folders(&projects_dir(vault), slug)?.first() {
        return Err(format!(
            "a project named '{slug}' already exists as '{}'{}",
            existing.folder,
            existing
                .number
                .map(|n| format!(" (number {n:04})"))
                .unwrap_or_default()
        ));
    }
    if let Some(existing) = find_project_folders(&archive_projects_dir(vault), slug)?.first() {
        return Err(format!(
            "a project named '{slug}' already exists in archive/projects/ as '{}'{}",
            existing.folder,
            existing
                .number
                .map(|n| format!(" (number {n:04})"))
                .unwrap_or_default()
        ));
    }
    Ok(())
}

/// The folder name `create_project` will give a new project with this slug,
/// for the create dialog's preview — asked before the folder is written so
/// the owner sees the `NNNN-` prefix they are about to get (T-0278).
pub fn next_project_folder(vault: &Path, slug: &str) -> Result<String, String> {
    let slug = slug.trim();
    check_new_project_slug(vault, slug)?;
    Ok(project_folder_name(next_project_number(vault), slug))
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
///
/// The folder gets a `NNNN-` sort prefix the caller never chooses (T-0278):
/// `next_project_number` allocates it, so two agents creating a project at
/// the same time still both get a folder, and a slug that already looks
/// numbered (`0010-workhub`) is refused rather than double-prefixed.
pub fn create_project(vault: &Path, slug: &str, name: &str) -> Result<(), String> {
    let slug = slug.trim();
    check_new_project_slug(vault, slug)?;
    let folder = project_folder_name(next_project_number(vault), slug);
    let dir = projects_dir(vault).join(&folder);

    let template = crate::tasks::project_template()
        .ok_or_else(|| "the project template is missing from this build".to_string())?;
    let prefix = format!("{}/", crate::tasks::PROJECT_TEMPLATE_DIR);
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
                let rendered = render_project_scaffold(text, slug, name);
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
    let dir = resolve_project_dir(&projects_dir(vault), slug)?
        .ok_or_else(|| format!("no project named '{slug}' is in projects/"))?;
    let dst = dir.join(rel);
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
    let rendered = render_project_scaffold(text, slug, name);
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&dst, rendered).map_err(|e| e.to_string())?;
    Ok(dst)
}

pub(crate) fn walk_project_template<'a>(
    dir: &'a Dir<'a>,
    out: &mut Vec<&'a include_dir::File<'a>>,
) {
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
    /// Owning project's stripped slug (T-0278: the folder itself may carry a
    /// `NNNN-` sort prefix, which is not part of the identity).
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
        let folder = entry.file_name().to_string_lossy().to_string();
        let (_, slug) = parse_project_folder(&folder);
        let slug = slug.to_string();
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

    // -----------------------------------------------------------------
    // numbered project folders (T-0278)
    // -----------------------------------------------------------------

    fn temp_project_vault(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("workhub-projnum-{name}-{nanos}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("projects")).unwrap();
        dir
    }

    #[test]
    fn parse_project_folder_strips_only_a_well_formed_number_prefix() {
        assert_eq!(parse_project_folder("0010-workhub"), (Some(10), "workhub"));
        assert_eq!(parse_project_folder("workhub"), (None, "workhub"));
        // Only the first `NNNN-` is stripped, so a slug that itself looks
        // numbered keeps its own prefix.
        assert_eq!(
            parse_project_folder("0010-0020-workhub"),
            (Some(10), "0020-workhub")
        );
        // Not exactly 4 digits followed by a hyphen: read as an unnumbered
        // folder rather than guessing.
        assert_eq!(parse_project_folder("123-workhub"), (None, "123-workhub"));
        assert_eq!(
            parse_project_folder("00010-workhub"),
            (None, "00010-workhub")
        );
        assert_eq!(parse_project_folder("0010workhub"), (None, "0010workhub"));
    }

    #[test]
    fn resolve_project_dir_finds_a_numbered_and_an_unnumbered_folder() {
        let vault = temp_project_vault("resolve");
        fs::create_dir_all(vault.join("projects").join("0010-workhub")).unwrap();
        fs::create_dir_all(vault.join("projects").join("legacy")).unwrap();

        let root = projects_dir(&vault);
        assert_eq!(
            resolve_project_dir(&root, "workhub").unwrap(),
            Some(vault.join("projects").join("0010-workhub"))
        );
        assert_eq!(
            resolve_project_dir(&root, "legacy").unwrap(),
            Some(vault.join("projects").join("legacy"))
        );
        assert_eq!(resolve_project_dir(&root, "nope").unwrap(), None);
    }

    #[test]
    fn resolve_project_dir_errs_on_a_duplicate_slug() {
        let vault = temp_project_vault("duplicate");
        fs::create_dir_all(vault.join("projects").join("0010-workhub")).unwrap();
        fs::create_dir_all(vault.join("projects").join("0020-workhub")).unwrap();

        let err = resolve_project_dir(&projects_dir(&vault), "workhub").unwrap_err();
        assert!(err.contains("workhub"), "error: {err}");
    }

    #[test]
    fn next_project_number_rounds_up_to_the_next_ten_across_both_roots() {
        let vault = temp_project_vault("numbering");
        assert_eq!(
            next_project_number(&vault),
            10,
            "an empty vault starts at 10"
        );

        fs::create_dir_all(vault.join("projects").join("0010-a")).unwrap();
        fs::create_dir_all(vault.join("projects").join("0025-b")).unwrap();
        assert_eq!(next_project_number(&vault), 30);

        // An archived project's number is never handed out again, even once
        // its active folder is gone.
        fs::create_dir_all(vault.join("archive").join("projects").join("0090-c")).unwrap();
        assert_eq!(next_project_number(&vault), 100);
    }

    #[test]
    fn create_project_allocates_a_numbered_folder_and_next_project_folder_previews_it() {
        let vault = temp_project_vault("create");
        assert_eq!(next_project_folder(&vault, "demo").unwrap(), "0010-demo");
        create_project(&vault, "demo", "Demo").unwrap();
        assert!(vault.join("projects").join("0010-demo").is_dir());
        assert_eq!(list_projects(&vault).unwrap(), vec!["demo"]);

        // The next project continues the sequence in tens.
        assert_eq!(
            next_project_folder(&vault, "second").unwrap(),
            "0020-second"
        );
        create_project(&vault, "second", "Second").unwrap();
        assert!(vault.join("projects").join("0020-second").is_dir());
    }

    #[test]
    fn create_project_rejects_a_slug_that_already_looks_numbered() {
        let vault = temp_project_vault("numbered-slug");
        let err = create_project(&vault, "0010-workhub", "x").unwrap_err();
        assert!(err.contains("automatically"), "error: {err}");
        assert!(next_project_folder(&vault, "0010-workhub").is_err());
    }

    #[test]
    fn create_project_refuses_a_slug_already_used_by_an_archived_project() {
        let vault = temp_project_vault("archived-clash");
        fs::create_dir_all(vault.join("archive").join("projects").join("0010-demo")).unwrap();
        let err = create_project(&vault, "demo", "x").unwrap_err();
        assert!(err.contains("already exists"), "error: {err}");
    }
}
