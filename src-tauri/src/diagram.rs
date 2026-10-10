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
//! Schedule and Mindmap keep reading, writing, renaming and deleting through
//! their own modules (`schedule.rs`, `mindmap.rs`: their undo history and trash
//! live in their own folders). The newer kinds go through the kind-independent
//! `read_diagram` / `write_diagram` / `rename_diagram` / `delete_diagram` here:
//! they work on a path, and the path is all the Diagrams tab needs to hand over.

use crate::vault_note::{
    ai_state_dir, frontmatter_value, has_snapshot as note_has_snapshot, move_snapshot, mtime_secs,
    norm_path, projects_dir, resolve_project_dir, restore_snapshot as note_restore_snapshot,
    rewrite_frontmatter, sanitize_filename, save_snapshot as note_save_snapshot, snapshot_path,
    split_frontmatter, today, unique_note_path,
};
use crate::vault_project::find_backlog_item;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

/// Every `type` the Diagrams tab lists. `schedule` and `mindmap` are the older
/// kinds; the rest arrive with the diagram series (B-050).
pub const KINDS: &[&str] = &[
    "schedule",
    "mindmap",
    "matrix2x2",
    "flow",
    "pfd",
    "algorithm",
];

/// How much of a file is read to find its frontmatter. A note whose
/// frontmatter is longer than this is not a diagram this tab can list.
const HEAD_BYTES: u64 = 4096;

/// How deep below a project folder a diagram may sit: `diagrams/x.md` is 2,
/// `backlog/B-001-item/x.md` is 3.
const MAX_DEPTH: usize = 3;

/// Folders a scan never descends into.
const SKIP_DIRS: &[&str] = &["attachments", "node_modules"];

/// Folder under `_ai/state/` holding the one-generation undo snapshot of every
/// kind of diagram (T-0685). The older `schedule-snapshots` and
/// `mindmap-snapshots` folders are not read: a snapshot only matters for the
/// run right before it, so there is nothing worth carrying over.
pub const SNAPSHOT_DIR: &str = "diagram-snapshots";

/// Folder under `_ai/state/` that a deleted diagram is moved into.
const TRASH_DIR: &str = "diagram-trash";

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

/// The text of a new note of `kind`. The 2x2 matrix starts empty; the flow and
/// the PFD start with a small working example.
fn skeleton(kind: &str, title: &str, range: &str, now: &str) -> Result<String, String> {
    Ok(match kind {
        "schedule" => crate::schedule::skeleton(title, range, now),
        "mindmap" => crate::mindmap::skeleton(title, now),
        // The axis and quadrant labels start empty (an empty one is not drawn);
        // the keys are there so a person or an agent sees what can be filled.
        "matrix2x2" => format!(
            "---\ntype: matrix2x2\ntitle: {title}\ncreated: {now}\nupdated: {now}\n\
x_axis:\nx_low:\nx_high:\ny_axis:\ny_low:\ny_high:\nq_tl:\nq_tr:\nq_bl:\nq_br:\n---\n\n\
## Items\n\n## Memo\n\n"
        ),
        // A small working flow rather than empty sections: on a blank
        // canvas there is nothing to double-click, and the three steps show
        // what a lane, a terminator and an arrow look like.
        "flow" => format!(
            "---\ntype: flow\ntitle: {title}\ncreated: {now}\nupdated: {now}\n---\n\n\
## Lanes\n\n- L-001 Lane 1\n\n\
## Steps\n\n- F-001 Start ^start lane:L-001\n- F-002 Step lane:L-001\n- F-003 End ^end lane:L-001\n\n\
## Edges\n\n- F-001 -> F-002\n- F-002 -> F-003\n\n\
## Memo\n\n"
        ),
        // One process, the deliverable it produces and the arrow between them:
        // the two symbols and the one connection a PFD is made of. The positions
        // are left to the layout.
        "pfd" => format!(
            "---\ntype: pfd\ntitle: {title}\ncreated: {now}\nupdated: {now}\n---\n\n\
## Nodes\n\n- P-001 Process\n- D-001 Deliverable\n\n\
## Edges\n\n- P-001 -> D-001\n\n\
## Memo\n\n"
        ),
        // A small working chart: the start and end terminals and one step
        // between them, so a blank canvas has something to build on. The
        // positions are left to the layout.
        "algorithm" => format!(
            "---\ntype: algorithm\ntitle: {title}\ncreated: {now}\nupdated: {now}\n---\n\n\
## Nodes\n\n- A-001 Start ^start\n- A-002 Step\n- A-003 End ^end\n\n\
## Edges\n\n- A-001 -> A-002\n- A-002 -> A-003\n\n\
## Memo\n\n"
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

/// A diagram note's full text plus the mtime that guards the next write.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagramDoc {
    pub path: String,
    pub content: String,
    /// Unix seconds; pass back to [`write_diagram`] for conflict detection.
    pub mtime: u64,
}

pub fn read_diagram(path: &Path) -> Result<DiagramDoc, String> {
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    Ok(DiagramDoc {
        path: norm_path(path),
        content,
        mtime: mtime_secs(path),
    })
}

/// Minimal structural check before a write. Deliberately shallow: each kind's
/// grammar is validated on the frontend, and rejecting a file here for a
/// notation slip would block the user from saving their way out of it. What
/// this *does* catch is a caller about to write something that is not a
/// diagram note at all (a truncated string, an empty buffer from a failed
/// render), which would silently destroy the file.
fn validate(content: &str) -> Result<(), String> {
    let Some((front, _)) = split_frontmatter(content) else {
        return Err("diagram content must start with a frontmatter block".into());
    };
    let kind = frontmatter_value(&front, "type");
    if !KINDS.contains(&kind.as_str()) {
        return Err(format!(
            "diagram content has no valid `type` (found '{kind}')"
        ));
    }
    Ok(())
}

/// Writes the file only when its on-disk mtime still matches `expected_mtime`,
/// so a concurrent Obsidian/agent edit is reported instead of overwritten.
/// Pass `0` to skip the check. Returns the new mtime so the caller can keep
/// guarding subsequent writes without a re-read.
pub fn write_diagram(path: &Path, content: &str, expected_mtime: u64) -> Result<u64, String> {
    validate(content)?;
    if expected_mtime != 0 {
        // A guarded write is an edit of a note that was read. If the note has
        // gone (renamed, moved, deleted), writing would quietly recreate it
        // under the old name.
        if !path.exists() {
            return Err("the diagram file is gone — it was renamed, moved or deleted".into());
        }
        if mtime_secs(path) != expected_mtime {
            return Err(
                "the diagram file changed on disk since it was loaded — reload before saving"
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

/// The listing entry of the diagram at `path`, found by its place under
/// `projects/`.
fn describe(vault: &Path, path: &Path) -> Result<DiagramFile, String> {
    let root = projects_dir(vault);
    let rel = path
        .strip_prefix(&root)
        .map_err(|_| "this note is not inside the vault's projects/ folder".to_string())?;
    let folder = rel
        .components()
        .next()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .unwrap_or_default();
    let (_, slug) = crate::vault_note::parse_project_folder(&folder);
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    read_head(&root.join(&folder), path, slug, &name)
        .ok_or_else(|| "this note is not a diagram".to_string())
}

/// Renames a diagram: its frontmatter `title` and its file name move together.
/// A numbered child of a backlog item (`020-<title>.md`) keeps its number so the
/// item's ordering survives. The note's own file is never a name collision.
pub fn rename_diagram(vault: &Path, path: &Path, new_title: &str) -> Result<DiagramFile, String> {
    let title = new_title.trim();
    if title.is_empty() {
        return Err("a diagram name is required".into());
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let Some((front, body)) = split_frontmatter(&content) else {
        return Err("this file is not a diagram note (no frontmatter block)".into());
    };
    let kind = frontmatter_value(&front, "type");
    if !KINDS.contains(&kind.as_str()) {
        return Err("this file is not a diagram note (no valid `type`)".into());
    }
    let dir = path
        .parent()
        .ok_or_else(|| "the diagram path has no parent folder".to_string())?;

    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let digits: String = stem.chars().take_while(|c| c.is_ascii_digit()).collect();
    let name = if !digits.is_empty() && stem[digits.len()..].starts_with('-') {
        format!("{digits}-{}", sanitize_filename(title, &kind))
    } else {
        title.to_string()
    };
    let target = unique_note_path(dir, &name, &kind, Some(path));

    let now = today();
    let front_out = rewrite_frontmatter(&front, &[("title", title), ("updated", &now)]);
    fs::write(path, format!("---\n{front_out}---\n{body}")).map_err(|e| e.to_string())?;
    // Compared exactly, not case-insensitively: renaming "ideas" to "Ideas" is
    // a real rename, even though the two names collide on Windows.
    if norm_path(&target) != norm_path(path) {
        fs::rename(path, &target).map_err(|e| e.to_string())?;
        // The snapshot is keyed by path; left behind, the undo would vanish.
        move_snapshot(vault, SNAPSHOT_DIR, path, &target)?;
    }
    describe(vault, &target)
}

/// Moves a diagram into `_ai/state/diagram-trash/` rather than unlinking it:
/// the app is not the only writer of these files, and a mis-click should not
/// destroy prose someone typed in Obsidian. Returns where it went.
pub fn delete_diagram(vault: &Path, path: &Path) -> Result<String, String> {
    if !path.is_file() {
        return Err("this diagram no longer exists".into());
    }
    let dir = ai_state_dir(vault).join(TRASH_DIR);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = path
        .file_stem()
        .and_then(|n| n.to_str())
        .unwrap_or("diagram")
        .to_string();
    // Two projects may hold a note of the same name, and the same note may be
    // deleted twice; suffix rather than overwrite what is already in the trash.
    let target = unique_note_path(&dir, &format!("{name} {}", today()), "diagram", None);
    fs::rename(path, &target).map_err(|e| e.to_string())?;
    // The snapshot describes a file that is no longer there.
    let _ = fs::remove_file(snapshot_path(vault, SNAPSHOT_DIR, path));
    Ok(norm_path(&target))
}

/// The frontmatter `type` of the diagram at `path`, or an error when the file
/// is not a diagram note.
pub fn kind_of(path: &Path) -> Result<String, String> {
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let Some((front, _)) = split_frontmatter(&content) else {
        return Err("this file is not a diagram note (no frontmatter block)".into());
    };
    let kind = frontmatter_value(&front, "type");
    if !KINDS.contains(&kind.as_str()) {
        return Err(format!(
            "this file is not a diagram note (type '{kind}' is not one of {})",
            KINDS.join(", ")
        ));
    }
    Ok(kind)
}

// ---------------------------------------------------------------------
// snapshots (undo for AI edits)
// ---------------------------------------------------------------------

/// Parks a copy of the note before an agent touches it.
pub fn save_snapshot(vault: &Path, target: &Path) -> Result<(), String> {
    note_save_snapshot(vault, SNAPSHOT_DIR, target)
}

/// Restores the note from its snapshot and consumes it, so "undo" is exactly
/// one generation deep and cannot be pressed twice against a snapshot that no
/// longer describes a state the user wants back.
pub fn restore_snapshot(vault: &Path, target: &Path) -> Result<DiagramDoc, String> {
    note_restore_snapshot(vault, SNAPSHOT_DIR, target, "diagram")?;
    read_diagram(target)
}

pub fn has_snapshot(vault: &Path, target: &Path) -> bool {
    note_has_snapshot(vault, SNAPSHOT_DIR, target)
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

    #[test]
    fn matrix_skeleton_carries_empty_label_keys_and_an_items_section() {
        let vault = temp_vault("matrix-skeleton");
        let file = create_diagram(&vault, "demo", "matrix2x2", "Priorities", "", "").unwrap();
        let doc = read_diagram(Path::new(&file.path)).unwrap();
        let (front, body) = split_frontmatter(&doc.content).unwrap();
        assert_eq!(frontmatter_value(&front, "type"), "matrix2x2");
        assert_eq!(frontmatter_value(&front, "title"), "Priorities");
        for key in [
            "x_axis", "x_low", "x_high", "y_axis", "y_low", "y_high", "q_tl", "q_tr", "q_bl",
            "q_br",
        ] {
            assert!(front.contains(&format!("{key}:")), "missing {key}");
            assert_eq!(frontmatter_value(&front, key), "");
        }
        assert!(body.contains("## Items"));
        assert!(body.contains("## Memo"));
        // Written back as-is, it is still a valid diagram.
        assert!(write_diagram(Path::new(&file.path), &doc.content, doc.mtime).is_ok());
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn flow_skeleton_is_a_small_working_flow() {
        let vault = temp_vault("flow-skeleton");
        let file = create_diagram(&vault, "demo", "flow", "Order", "", "").unwrap();
        let doc = read_diagram(Path::new(&file.path)).unwrap();
        let (front, body) = split_frontmatter(&doc.content).unwrap();
        assert_eq!(frontmatter_value(&front, "type"), "flow");
        assert_eq!(frontmatter_value(&front, "title"), "Order");
        // Every managed section is there, in the order the editor writes them.
        let at = |h: &str| body.find(h).unwrap_or_else(|| panic!("missing {h}"));
        assert!(at("## Lanes") < at("## Steps"));
        assert!(at("## Steps") < at("## Edges"));
        assert!(at("## Edges") < at("## Memo"));
        assert!(body.contains("- L-001 Lane 1"));
        assert!(body.contains("- F-001 Start ^start lane:L-001"));
        assert!(body.contains("- F-003 End ^end lane:L-001"));
        assert!(body.contains("- F-002 -> F-003"));
        // Written back as-is, it is still a valid diagram.
        assert!(write_diagram(Path::new(&file.path), &doc.content, doc.mtime).is_ok());
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn pfd_skeleton_is_a_process_a_deliverable_and_an_arrow() {
        let vault = temp_vault("pfd-skeleton");
        let file = create_diagram(&vault, "demo", "pfd", "Dev", "", "").unwrap();
        let doc = read_diagram(Path::new(&file.path)).unwrap();
        let (front, body) = split_frontmatter(&doc.content).unwrap();
        assert_eq!(frontmatter_value(&front, "type"), "pfd");
        assert_eq!(frontmatter_value(&front, "title"), "Dev");
        // Every managed section is there, in the order the editor writes them.
        let at = |h: &str| body.find(h).unwrap_or_else(|| panic!("missing {h}"));
        assert!(at("## Nodes") < at("## Edges"));
        assert!(at("## Edges") < at("## Memo"));
        assert!(body.contains("- P-001 Process\n"));
        assert!(body.contains("- D-001 Deliverable\n"));
        assert!(body.contains("- P-001 -> D-001\n"));
        // Written back as-is, it is still a valid diagram.
        assert!(write_diagram(Path::new(&file.path), &doc.content, doc.mtime).is_ok());
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn algorithm_skeleton_is_a_start_a_step_an_end_and_two_arrows() {
        let vault = temp_vault("algorithm-skeleton");
        let file = create_diagram(&vault, "demo", "algorithm", "Order", "", "").unwrap();
        assert!(
            file.path.ends_with("projects/0010-demo/diagrams/Order.md"),
            "{}",
            file.path
        );
        assert_eq!(file.kind, "algorithm");
        let doc = read_diagram(Path::new(&file.path)).unwrap();
        let (front, body) = split_frontmatter(&doc.content).unwrap();
        assert_eq!(frontmatter_value(&front, "type"), "algorithm");
        assert_eq!(frontmatter_value(&front, "title"), "Order");
        let at = |h: &str| body.find(h).unwrap_or_else(|| panic!("missing {h}"));
        assert!(at("## Nodes") < at("## Edges"));
        assert!(at("## Edges") < at("## Memo"));
        assert!(body.contains("- A-001 Start ^start\n"));
        assert!(body.contains("- A-003 End ^end\n"));
        assert!(body.contains("- A-001 -> A-002\n"));
        assert!(body.contains("- A-002 -> A-003\n"));
        // The scan finds it, and written back as-is it is still a diagram.
        let listed = list_diagrams(&vault, Some("demo")).unwrap();
        assert!(listed.iter().any(|d| d.kind == "algorithm"));
        assert!(write_diagram(Path::new(&file.path), &doc.content, doc.mtime).is_ok());
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn write_refuses_a_stale_mtime_and_a_non_diagram() {
        let vault = temp_vault("write");
        let file = create_diagram(&vault, "demo", "matrix2x2", "Grid", "", "").unwrap();
        let path = Path::new(&file.path);
        let doc = read_diagram(path).unwrap();

        let changed = doc.content.replace("## Items", "## Items\n\n- M-001 a");
        let mtime = write_diagram(path, &changed, doc.mtime).unwrap();
        assert!(fs::read_to_string(path).unwrap().contains("M-001"));
        // A guard from before another writer touched the file is refused.
        assert!(write_diagram(path, &changed, mtime + 5).is_err());
        // 0 skips the check.
        assert!(write_diagram(path, &changed, 0).is_ok());

        // A guarded write to a note that has vanished does not recreate it.
        let gone = path.with_file_name("gone.md");
        assert!(write_diagram(&gone, &changed, mtime).is_err());
        assert!(!gone.exists());

        assert!(write_diagram(path, "no frontmatter", 0).is_err());
        assert!(write_diagram(path, "---\ntype: note\n---\n", 0).is_err());
        assert!(write_diagram(path, "---\ntitle: x\n---\n", 0).is_err());
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn rename_moves_title_and_name_and_keeps_a_backlog_number() {
        let vault = temp_vault("rename");
        let loose = create_diagram(&vault, "demo", "matrix2x2", "Old", "", "").unwrap();
        let renamed = rename_diagram(&vault, Path::new(&loose.path), "New name").unwrap();
        assert!(
            renamed.path.ends_with("diagrams/New name.md"),
            "{}",
            renamed.path
        );
        assert_eq!(renamed.title, "New name");
        assert_eq!(renamed.kind, "matrix2x2");
        assert!(!Path::new(&loose.path).exists());
        let (front, body) = split_frontmatter(&fs::read_to_string(&renamed.path).unwrap()).unwrap();
        assert_eq!(frontmatter_value(&front, "title"), "New name");
        // Keys the rename does not know about, and the body, survive.
        assert!(front.contains("q_tl:"));
        assert!(body.contains("## Items"));

        write(
            &vault,
            "projects/0010-demo/backlog/B-001-item/B-001-item.md",
            "x",
        );
        let child = create_diagram(&vault, "demo", "matrix2x2", "Child", "B-001", "").unwrap();
        assert!(child.path.ends_with("010-Child.md"), "{}", child.path);
        let moved = rename_diagram(&vault, Path::new(&child.path), "Other").unwrap();
        assert!(moved.path.ends_with("010-Other.md"), "{}", moved.path);
        assert_eq!(moved.scope, "backlog:B-001");

        // The same name is not a collision with the note itself.
        let same = rename_diagram(&vault, Path::new(&moved.path), "Other").unwrap();
        assert_eq!(same.path, moved.path);
        assert!(rename_diagram(&vault, Path::new(&same.path), "  ").is_err());
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn delete_moves_to_the_trash_instead_of_unlinking() {
        let vault = temp_vault("delete");
        let file = create_diagram(&vault, "demo", "matrix2x2", "Gone", "", "").unwrap();
        let trashed = delete_diagram(&vault, Path::new(&file.path)).unwrap();
        assert!(!Path::new(&file.path).exists());
        assert!(Path::new(&trashed).is_file());
        assert!(trashed.contains("_ai/state/diagram-trash/"), "{trashed}");
        assert!(delete_diagram(&vault, Path::new(&file.path)).is_err());
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn snapshot_round_trips_one_generation_for_every_kind() {
        let vault = temp_vault("snapshot");
        for kind in KINDS {
            let file =
                create_diagram(&vault, "demo", kind, &format!("snap {kind}"), "", "").unwrap();
            let path = PathBuf::from(&file.path);
            assert_eq!(kind_of(&path).unwrap(), *kind);
            let original = read_diagram(&path).unwrap().content;

            assert!(!has_snapshot(&vault, &path), "{kind}");
            save_snapshot(&vault, &path).unwrap();
            assert!(has_snapshot(&vault, &path), "{kind}");

            let edited = format!(
                "{original}
an agent wrote this
"
            );
            write_diagram(&path, &edited, 0).unwrap();
            assert_ne!(read_diagram(&path).unwrap().content, original);

            let restored = restore_snapshot(&vault, &path).unwrap();
            assert_eq!(restored.content, original, "{kind}");
            // One generation only: the snapshot is consumed by the restore.
            assert!(!has_snapshot(&vault, &path), "{kind}");
            assert!(restore_snapshot(&vault, &path).is_err(), "{kind}");
        }
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn snapshots_live_in_one_shared_folder() {
        let vault = temp_vault("snapshot-dir");
        let a = create_diagram(&vault, "demo", "pfd", "a", "", "").unwrap();
        let b = create_diagram(&vault, "demo", "mindmap", "b", "", "").unwrap();
        save_snapshot(&vault, Path::new(&a.path)).unwrap();
        save_snapshot(&vault, Path::new(&b.path)).unwrap();
        let dir = ai_state_dir(&vault).join("diagram-snapshots");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 2);
        assert!(!ai_state_dir(&vault).join("mindmap-snapshots").exists());
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn kind_of_rejects_a_note_that_is_not_a_diagram() {
        let vault = temp_vault("kind-of");
        write(
            &vault,
            "projects/0010-demo/dev-notes/n.md",
            "---
type: note
---
",
        );
        write(
            &vault,
            "projects/0010-demo/dev-notes/bare.md",
            "no frontmatter
",
        );
        assert!(kind_of(&vault.join("projects/0010-demo/dev-notes/n.md")).is_err());
        assert!(kind_of(&vault.join("projects/0010-demo/dev-notes/bare.md")).is_err());
        assert!(kind_of(&vault.join("projects/0010-demo/dev-notes/missing.md")).is_err());
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn rename_carries_the_snapshot_and_delete_drops_it() {
        let vault = temp_vault("snapshot-follow");
        let file = create_diagram(&vault, "demo", "flow", "Before", "", "").unwrap();
        let path = PathBuf::from(&file.path);
        save_snapshot(&vault, &path).unwrap();

        let renamed = rename_diagram(&vault, &path, "After").unwrap();
        let moved = PathBuf::from(&renamed.path);
        assert!(!has_snapshot(&vault, &path));
        assert!(has_snapshot(&vault, &moved));

        delete_diagram(&vault, &moved).unwrap();
        assert!(!has_snapshot(&vault, &moved));
        fs::remove_dir_all(&vault).ok();
    }
}
