//! Diagram discovery and creation (T-0680, design: B-050 `020-T-0679`).
//!
//! A *diagram* is any note under `projects/<slug>/` whose frontmatter `type` is
//! one of [`KINDS`]. Where the file sits does not matter: the project-wide
//! `diagrams/` folder, the legacy `schedules/` and `mindmaps/` folders, and a
//! backlog item's own folder are all scanned. That is what lets the Diagrams
//! tab show Schedule, Mindmap and the newer kinds in one list.
//!
//! Only the head of each file is read (the frontmatter), never the body, so
//! listing a project with hundreds of notes stays cheap.
//!
//! Reading, writing, renaming and deleting a diagram stay with the per-kind
//! modules (`schedule.rs`, `mindmap.rs`): they work on a path, and the path is
//! all the Diagrams tab needs to hand over.

use crate::vault_note::{
    frontmatter_value, norm_path, projects_dir, resolve_project_dir, sanitize_filename,
    split_frontmatter, today, unique_note_path,
};
use crate::vault_project::find_backlog_item;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

/// Every `type` the Diagrams tab lists. `schedule` and `mindmap` are the older
/// kinds; the rest arrive with the diagram series (B-050).
pub const KINDS: &[&str] = &["schedule", "mindmap", "matrix2x2", "flow", "pfd"];

/// How much of a file is read to find its frontmatter. A note whose
/// frontmatter is longer than this is not a diagram this tab can list.
const HEAD_BYTES: u64 = 4096;

/// How deep below a project folder a diagram may sit: `diagrams/x.md` is 2,
/// `backlog/B-001-item/x.md` is 3.
const MAX_DEPTH: usize = 3;

/// Folders a scan never descends into.
const SKIP_DIRS: &[&str] = &["attachments", "node_modules"];

/// Subfolder for kinds that have no older home.
const DIAGRAMS_DIR: &str = "diagrams";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagramFile {
    /// Absolute path, forward slashes.
    pub path: String,
    /// Owning project slug.
    pub project: String,
    pub title: String,
    /// The frontmatter `type` (one of [`KINDS`]).
    pub kind: String,
    pub updated: String,
    /// `project` for a note outside any backlog item, `backlog:B-NNN` for one
    /// inside an item's folder. Derived from the path; never written to a file.
    pub scope: String,
}

/// Lists the diagrams of the vault, optionally narrowed to one project slug.
/// Archived projects are not looked at. Sorted by project, kind, then name.
pub fn list_diagrams(vault: &Path, project: Option<&str>) -> Result<Vec<DiagramFile>, String> {
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
        if folder.starts_with('.') {
            continue;
        }
        let (_, slug) = crate::vault_note::parse_project_folder(&folder);
        if let Some(want) = project {
            if !want.is_empty() && want != slug {
                continue;
            }
        }
        walk(&entry.path(), &entry.path(), slug, 1, &mut out);
    }
    out.sort_by(|a, b| {
        (&a.project, &a.kind, &a.path.to_lowercase()).cmp(&(
            &b.project,
            &b.kind,
            &b.path.to_lowercase(),
        ))
    });
    Ok(out)
}

fn walk(project_dir: &Path, dir: &Path, slug: &str, depth: usize, out: &mut Vec<DiagramFile>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            if depth < MAX_DEPTH && !name.starts_with('.') && !SKIP_DIRS.contains(&name.as_str()) {
                walk(project_dir, &path, slug, depth + 1, out);
            }
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("md") || name.starts_with('_') {
            continue;
        }
        if let Some(file) = read_head(project_dir, &path, slug, &name) {
            out.push(file);
        }
    }
}

/// The frontmatter of `path` as a diagram, or `None` when the note is not one.
fn read_head(project_dir: &Path, path: &Path, slug: &str, name: &str) -> Option<DiagramFile> {
    let mut head = Vec::new();
    fs::File::open(path)
        .ok()?
        .take(HEAD_BYTES)
        .read_to_end(&mut head)
        .ok()?;
    let text = String::from_utf8_lossy(&head);
    let text = text.trim_start_matches('\u{feff}');
    if !text.starts_with("---") {
        return None;
    }
    let (front, _) = split_frontmatter(text)?;
    let rel = path.strip_prefix(project_dir).ok()?;
    let parts: Vec<String> = rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect();
    let mut kind = frontmatter_value(&front, "type");
    if kind.is_empty() {
        // Notes made before `type` was required: the folder they sit in says
        // what they are.
        kind = match parts.first().map(String::as_str) {
            Some("schedules") if parts.len() == 2 => "schedule".into(),
            Some("mindmaps") if parts.len() == 2 => "mindmap".into(),
            _ => return None,
        };
    }
    if !KINDS.contains(&kind.as_str()) {
        return None;
    }
    let title = match frontmatter_value(&front, "title") {
        t if t.is_empty() => name.trim_end_matches(".md").to_string(),
        t => t,
    };
    Some(DiagramFile {
        path: norm_path(path),
        project: slug.to_string(),
        title,
        kind,
        updated: frontmatter_value(&front, "updated"),
        scope: scope_of(&parts),
    })
}

/// `backlog:B-NNN` for a path inside `backlog/B-NNN-<slug>/`, else `project`.
fn scope_of(parts: &[String]) -> String {
    if parts.len() >= 3 && parts[0] == "backlog" {
        if let Some(rest) = parts[1].strip_prefix("B-") {
            let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
            if !digits.is_empty() {
                return format!("backlog:B-{digits}");
            }
        }
    }
    "project".into()
}

/// The text of a new note of `kind`. The three newer kinds start empty; their
/// editors arrive with the tasks of the diagram series.
fn skeleton(kind: &str, title: &str, range: &str, now: &str) -> Result<String, String> {
    Ok(match kind {
        "schedule" => crate::schedule::skeleton(title, range, now),
        "mindmap" => crate::mindmap::skeleton(title, now),
        "matrix2x2" => format!(
            "---\ntype: matrix2x2\ntitle: {title}\ncreated: {now}\nupdated: {now}\n---\n\n## Items\n\n## Memo\n\n"
        ),
        "flow" => format!(
            "---\ntype: flow\ntitle: {title}\ncreated: {now}\nupdated: {now}\n---\n\n## Lanes\n\n## Steps\n\n## Edges\n\n## Memo\n\n"
        ),
        "pfd" => format!(
            "---\ntype: pfd\ntitle: {title}\ncreated: {now}\nupdated: {now}\n---\n\n## Nodes\n\n## Edges\n\n## Memo\n\n"
        ),
        other => return Err(format!("unknown diagram type '{other}'")),
    })
}

/// Creates a diagram note and returns it.
///
/// Placement:
/// - `backlog` empty: the project-wide folder. `schedule` and `mindmap` keep
///   their older folders so the rules, skills and tools that look there keep
///   working; every other kind goes to `diagrams/`.
/// - `backlog` = `B-NNN`: inside that item's folder as `NNN-<title>.md`, the
///   next ten after the highest number already there. Existing notes of the
///   item are never renamed.
///
/// A missing folder is created; an existing note is never overwritten.
pub fn create_diagram(
    vault: &Path,
    project: &str,
    kind: &str,
    title: &str,
    backlog: &str,
    range: &str,
) -> Result<DiagramFile, String> {
    let project = project.trim();
    if project.is_empty() {
        return Err("a project is required to create a diagram".into());
    }
    let project_dir = resolve_project_dir(&projects_dir(vault), project)?
        .ok_or_else(|| format!("no project named '{project}' is in projects/"))?;
    let title = match title.trim() {
        "" => kind,
        t => t,
    };
    let now = today();
    let content = skeleton(kind, title, range, &now)?;

    let backlog = backlog.trim();
    let path: PathBuf = if backlog.is_empty() {
        let sub = match kind {
            "schedule" => "schedules",
            "mindmap" => "mindmaps",
            _ => DIAGRAMS_DIR,
        };
        let dir = project_dir.join(sub);
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        unique_note_path(&dir, title, kind, None)
    } else {
        let item = find_backlog_item(vault, project, backlog)?
            .ok_or_else(|| format!("no backlog item '{backlog}' in project '{project}'"))?;
        let next = next_child_number(&item.folder);
        let stem = format!("{next:03}-{}", sanitize_filename(title, kind));
        unique_note_path(&item.folder, &stem, kind, None)
    };
    fs::write(&path, &content).map_err(|e| e.to_string())?;
    let rel: Vec<String> = path
        .strip_prefix(&project_dir)
        .map_err(|e| e.to_string())?
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect();
    Ok(DiagramFile {
        path: norm_path(&path),
        project: project.to_string(),
        title: title.to_string(),
        kind: kind.to_string(),
        updated: now,
        scope: scope_of(&rel),
    })
}

/// The next `NNN` for a backlog item's child note: ten above the highest
/// number prefix present, starting at 10.
fn next_child_number(folder: &Path) -> u32 {
    let highest = fs::read_dir(folder)
        .map(|entries| {
            entries
                .flatten()
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    let digits: String = name.chars().take_while(|c| c.is_ascii_digit()).collect();
                    (!digits.is_empty() && name[digits.len()..].starts_with('-'))
                        .then(|| digits.parse::<u32>().ok())
                        .flatten()
                })
                .max()
                .unwrap_or(0)
        })
        .unwrap_or(0);
    (highest / 10 + 1) * 10
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_vault(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("workhub-diagram-{name}-{nanos}"));
        fs::create_dir_all(dir.join("projects/0010-demo/backlog/B-001-item")).unwrap();
        fs::create_dir_all(dir.join("projects/0020-other")).unwrap();
        dir
    }

    fn write(vault: &Path, rel: &str, content: &str) {
        let path = vault.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    #[test]
    fn finds_diagrams_by_type_wherever_they_sit() {
        let vault = temp_vault("scan");
        write(
            &vault,
            "projects/0010-demo/diagrams/grid.md",
            "---\ntype: matrix2x2\ntitle: Grid\nupdated: 2026-10-09\n---\n",
        );
        write(
            &vault,
            "projects/0010-demo/mindmaps/old.md",
            "---\ntitle: Old map\n---\n",
        );
        write(
            &vault,
            "projects/0010-demo/schedules/s.md",
            "---\ntype: schedule\n---\n",
        );
        write(
            &vault,
            "projects/0010-demo/backlog/B-001-item/020-flow.md",
            "---\ntype: flow\n---\n",
        );
        // Not diagrams: another type, no type outside a legacy folder, a `_`
        // file, a non-diagram folder deeper than the scan goes.
        write(
            &vault,
            "projects/0010-demo/dev-notes/note.md",
            "---\ntype: note\n---\n",
        );
        write(
            &vault,
            "projects/0010-demo/dev-notes/untyped.md",
            "---\ntitle: x\n---\n",
        );
        write(
            &vault,
            "projects/0010-demo/diagrams/_example.md",
            "---\ntype: pfd\n---\n",
        );
        write(
            &vault,
            "projects/0010-demo/backlog/B-001-item/a/b/deep.md",
            "---\ntype: pfd\n---\n",
        );
        write(
            &vault,
            "projects/0020-other/diagrams/p.md",
            "---\ntype: pfd\n---\n",
        );

        let all = list_diagrams(&vault, None).unwrap();
        let summary: Vec<(String, String, String)> = all
            .iter()
            .map(|d| (d.project.clone(), d.kind.clone(), d.scope.clone()))
            .collect();
        assert_eq!(
            summary,
            vec![
                ("demo".into(), "flow".into(), "backlog:B-001".into()),
                ("demo".into(), "matrix2x2".into(), "project".into()),
                ("demo".into(), "mindmap".into(), "project".into()),
                ("demo".into(), "schedule".into(), "project".into()),
                ("other".into(), "pfd".into(), "project".into()),
            ]
        );
        let grid = all.iter().find(|d| d.kind == "matrix2x2").unwrap();
        assert_eq!(grid.title, "Grid");
        assert_eq!(grid.updated, "2026-10-09");
        assert_eq!(list_diagrams(&vault, Some("other")).unwrap().len(), 1);
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn ignores_archived_projects() {
        let vault = temp_vault("archive");
        write(
            &vault,
            "archive/projects/0010-old/diagrams/x.md",
            "---\ntype: pfd\n---\n",
        );
        assert!(list_diagrams(&vault, None).unwrap().is_empty());
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn create_places_by_kind_and_scope() {
        let vault = temp_vault("create");
        let mm = create_diagram(&vault, "demo", "mindmap", "Ideas", "", "").unwrap();
        assert!(
            mm.path.ends_with("projects/0010-demo/mindmaps/Ideas.md"),
            "{}",
            mm.path
        );
        let flow = create_diagram(&vault, "demo", "flow", "Order", "", "").unwrap();
        assert!(
            flow.path.ends_with("projects/0010-demo/diagrams/Order.md"),
            "{}",
            flow.path
        );
        assert_eq!(flow.scope, "project");

        write(
            &vault,
            "projects/0010-demo/backlog/B-001-item/B-001-item.md",
            "x",
        );
        write(
            &vault,
            "projects/0010-demo/backlog/B-001-item/030-notes.md",
            "x",
        );
        let pfd = create_diagram(&vault, "demo", "pfd", "Flow of work", "B-001", "").unwrap();
        assert!(
            pfd.path.ends_with("backlog/B-001-item/040-Flow of work.md"),
            "{}",
            pfd.path
        );
        assert_eq!(pfd.scope, "backlog:B-001");
        // The new notes are found again by the scan.
        assert_eq!(list_diagrams(&vault, Some("demo")).unwrap().len(), 3);
        // A second diagram with the same name does not overwrite the first.
        let again = create_diagram(&vault, "demo", "flow", "Order", "", "").unwrap();
        assert_ne!(again.path, flow.path);

        assert!(create_diagram(&vault, "demo", "pfd", "x", "B-999", "").is_err());
        assert!(create_diagram(&vault, "demo", "nope", "x", "", "").is_err());
        assert!(create_diagram(&vault, "missing", "pfd", "x", "", "").is_err());
        fs::remove_dir_all(&vault).ok();
    }
}
