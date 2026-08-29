//! Mindmap notes: scanning, reading/writing, snapshots, and soft delete
//! (T-0188).
//!
//! A mindmap note is one `projects/<slug>/mindmaps/<name>.md` file. Like a
//! schedule note it is a *thinking* surface — the user restructures a tree
//! until it says what they mean — so writes are frequent and arrive from the
//! app, from Obsidian, and from a headless agent.
//!
//! The same two rules as `schedule.rs` shape this module, for the same
//! reasons:
//!
//! - **The node notation is not parsed here.** Rust only ever handles the file
//!   as a whole string. The `## Nodes` grammar is interpreted in
//!   `src/lib/mindmap/parse.ts`, because the mermaid exporter and the layout
//!   need exactly that interpretation and a second implementation in Rust
//!   would drift from it.
//! - **Writes are guarded by mtime.** `write_mindmap` refuses to overwrite a
//!   file that changed since the caller read it, rather than silently
//!   discarding an Obsidian or agent edit.
//!
//! Deleting is *soft*: the note is moved into `_ai/memory/mindmap-trash/`
//! instead of being unlinked, because the app is not the only writer of these
//! files and a mis-click should not destroy prose someone typed in Obsidian.

use crate::models::{MindmapDoc, MindmapFile};
use crate::vault_note::{
    frontmatter_value, has_snapshot as note_has_snapshot, move_snapshot, mtime_secs, norm_path,
    projects_dir, restore_snapshot as note_restore_snapshot, rewrite_frontmatter,
    save_snapshot as note_save_snapshot, scan_notes, split_frontmatter, today, unique_note_path,
};
use std::fs;
use std::path::Path;

/// Subfolder of a project that holds its mindmap notes.
const MINDMAPS_DIR: &str = "mindmaps";

/// Note kind written into a mindmap note's `type:` frontmatter key.
const KIND: &str = "mindmap";

/// Folder under `_ai/memory/` where the AI edit flow parks a copy of the file
/// before an agent touches it, so the UI can offer a one-generation undo.
const SNAPSHOT_DIR: &str = "mindmap-snapshots";

/// Folder under `_ai/memory/` that a deleted note is moved into.
const TRASH_DIR: &str = "mindmap-trash";

/// Lists mindmap notes across the vault, optionally narrowed to one project
/// slug. See `vault_note::scan_notes` for what a scan skips and why.
pub fn list_mindmaps(vault: &Path, project: Option<&str>) -> Result<Vec<MindmapFile>, String> {
    let notes = scan_notes(vault, MINDMAPS_DIR, KIND, project)?;
    Ok(notes
        .into_iter()
        .map(|note| {
            let title = match frontmatter_value(&note.front, "title") {
                t if t.is_empty() => note.name.clone(),
                t => t,
            };
            MindmapFile {
                path: norm_path(&note.path),
                project: note.project,
                title,
                updated: frontmatter_value(&note.front, "updated"),
            }
        })
        .collect())
}

pub fn read_mindmap(path: &Path) -> Result<MindmapDoc, String> {
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    Ok(MindmapDoc {
        path: norm_path(path),
        content,
        mtime: mtime_secs(path),
    })
}

/// Minimal structural check before a write. Deliberately shallow: the node
/// grammar is validated on the frontend, and rejecting a file here for a
/// notation slip would block the user from saving their way out of it. What
/// this *does* catch is a caller about to write something that is not a
/// mindmap note at all (a truncated string, an empty buffer from a failed
/// render), which would silently destroy the file.
fn validate(content: &str) -> Result<(), String> {
    let Some((_, body)) = split_frontmatter(content) else {
        return Err("mindmap content must start with a frontmatter block".into());
    };
    if !body.contains("## Nodes") {
        return Err("mindmap content is missing the `## Nodes` section".into());
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
pub fn write_mindmap(path: &Path, content: &str, expected_mtime: u64) -> Result<u64, String> {
    validate(content)?;
    if expected_mtime != 0 && path.exists() {
        let current = mtime_secs(path);
        if current != expected_mtime {
            return Err(
                "the mindmap file changed on disk since it was loaded — reload before saving"
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

/// Creates `projects/<project>/mindmaps/<title>.md` from the skeleton.
///
/// The skeleton is not empty: a mindmap with no root is not a mindmap, and the
/// canvas would have nothing to draw or select. `N-001` is seeded with the
/// note's own title, which is what the user just typed and almost always what
/// they want at the centre.
pub fn create_mindmap(vault: &Path, project: &str, title: &str) -> Result<MindmapFile, String> {
    let project = project.trim();
    if project.is_empty() {
        return Err("a project is required to create a mindmap".into());
    }
    let dir = projects_dir(vault).join(project).join(MINDMAPS_DIR);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let title = if title.trim().is_empty() {
        KIND
    } else {
        title.trim()
    };
    // Never clobber an existing note: suffix until the name is free.
    let path = unique_note_path(&dir, title, KIND, None);
    let now = today();
    let content = format!(
        "---\ntype: mindmap\ntitle: {title}\ncreated: {now}\nupdated: {now}\n---\n\n\
## Nodes\n\n- N-001 {title}\n\n## Memo\n\n"
    );
    fs::write(&path, &content).map_err(|e| e.to_string())?;
    Ok(MindmapFile {
        path: norm_path(&path),
        project: project.to_string(),
        title: title.to_string(),
        updated: now,
    })
}

/// Renames a mindmap note. The frontmatter `title` and the file name move
/// **together**: `create_mindmap` derives one from the other, so letting them
/// drift would leave a note whose name in the app and name in Obsidian
/// disagree.
///
/// Everything else about the file is preserved — only `title` and `updated`
/// are rewritten, and the body (including `## Memo`) is carried over
/// untouched. The snapshot travels with the note, since it is keyed by path
/// and an undo left behind at the old key could never be found again.
pub fn rename_mindmap(vault: &Path, path: &Path, new_title: &str) -> Result<MindmapFile, String> {
    let title = new_title.trim();
    if title.is_empty() {
        return Err("a mindmap name is required".into());
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let Some((front, body)) = split_frontmatter(&content) else {
        return Err("this file is not a mindmap note (no frontmatter block)".into());
    };
    let dir = path
        .parent()
        .ok_or_else(|| "the mindmap path has no parent folder".to_string())?;

    // Same collision rule as `create_mindmap`, except that the note's own file
    // is not a collision — renaming "ideas" to "ideas" (or only changing its
    // case) must not produce "ideas 2".
    let target = unique_note_path(dir, title, KIND, Some(path));

    let now = today();
    let front_out = rewrite_frontmatter(&front, &[("title", title), ("updated", &now)]);
    let updated_content = format!("---\n{front_out}---\n{body}");
    fs::write(path, &updated_content).map_err(|e| e.to_string())?;

    // Compared exactly here, not case-insensitively: renaming "ideas" to
    // "Ideas" is a real rename the user asked for, even though the two names
    // collide on Windows.
    if norm_path(&target) != norm_path(path) {
        fs::rename(path, &target).map_err(|e| e.to_string())?;
        move_snapshot(vault, SNAPSHOT_DIR, path, &target)?;
    }

    let project = dir
        .parent()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    Ok(MindmapFile {
        path: norm_path(&target),
        project,
        title: title.to_string(),
        updated: now,
    })
}

/// Moves a mindmap note into `_ai/memory/mindmap-trash/` and returns where it
/// went.
///
/// Deliberately not an unlink. These files are shared with Obsidian and with
/// agents, they can hold hand-written prose under `## Memo`, and the app's
/// delete is one click behind one confirmation — a recoverable move is the
/// proportionate operation. Anything older than the last delete of a given
/// note is covered by the vault's git backup.
pub fn delete_mindmap(vault: &Path, path: &Path) -> Result<String, String> {
    if !path.is_file() {
        return Err("this mindmap no longer exists".into());
    }
    let dir = vault.join("_ai").join("memory").join(TRASH_DIR);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = path
        .file_stem()
        .and_then(|n| n.to_str())
        .unwrap_or(KIND)
        .to_string();
    // Two projects may hold a note of the same name, and the same note may be
    // deleted twice; suffix rather than overwrite what is already in the trash.
    let target = unique_note_path(&dir, &format!("{name} {}", today()), KIND, None);
    fs::rename(path, &target).map_err(|e| e.to_string())?;
    // The snapshot describes a file that is no longer there. Leaving it would
    // make a later note that happens to reuse the path inherit a stranger's
    // undo.
    let snapshot = crate::vault_note::snapshot_path(vault, SNAPSHOT_DIR, path);
    let _ = fs::remove_file(snapshot);
    Ok(norm_path(&target))
}

/// Writes a generated export (self-contained HTML, or SVG). Kept in Rust
/// rather than as a browser download so the default destination can be the
/// project's `attachments/` folder inside the vault — the export is part of
/// the project record.
pub fn export_file(out_path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = out_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(out_path, content).map_err(|e| e.to_string())
}

/// Writes a generated binary export (PNG), given its base64 payload.
pub fn export_binary(out_path: &Path, base64_data: &str) -> Result<(), String> {
    let bytes = crate::b64::decode(base64_data)?;
    if let Some(parent) = out_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(out_path, bytes).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------
// snapshots (undo for AI edits)
// ---------------------------------------------------------------------

pub fn save_snapshot(vault: &Path, target: &Path) -> Result<(), String> {
    note_save_snapshot(vault, SNAPSHOT_DIR, target)
}

/// Restores the mindmap from its snapshot and consumes it, so "undo" is
/// exactly one generation deep and cannot be pressed twice against a snapshot
/// that no longer describes a state the user wants back.
pub fn restore_snapshot(vault: &Path, target: &Path) -> Result<MindmapDoc, String> {
    note_restore_snapshot(vault, SNAPSHOT_DIR, target, KIND)?;
    read_mindmap(target)
}

pub fn has_snapshot(vault: &Path, target: &Path) -> bool {
    note_has_snapshot(vault, SNAPSHOT_DIR, target)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::UNIX_EPOCH;

    fn temp_vault(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("workhub-mind-{name}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn create_seeds_a_root_node_and_list_finds_it() {
        let vault = temp_vault("create-list");
        let created = create_mindmap(&vault, "demo", "product ideas").unwrap();
        assert!(created
            .path
            .ends_with("projects/demo/mindmaps/product ideas.md"));

        let doc = read_mindmap(&PathBuf::from(&created.path)).unwrap();
        assert!(doc.content.contains("## Nodes"));
        assert!(doc.content.contains("- N-001 product ideas"));

        let listed = list_mindmaps(&vault, None).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].title, "product ideas");
        assert_eq!(listed[0].project, "demo");

        // Filtering by another project hides it.
        assert!(list_mindmaps(&vault, Some("other")).unwrap().is_empty());
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn create_never_overwrites_an_existing_note() {
        let vault = temp_vault("create-dup");
        let a = create_mindmap(&vault, "demo", "ideas").unwrap();
        let b = create_mindmap(&vault, "demo", "ideas").unwrap();
        assert_ne!(a.path, b.path);
        assert!(b.path.ends_with("ideas 2.md"));
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn write_preserves_memo_and_unmanaged_frontmatter() {
        let vault = temp_vault("write-preserve");
        let created = create_mindmap(&vault, "demo", "ideas").unwrap();
        let path = PathBuf::from(&created.path);

        let hand_written = "---\ntype: mindmap\ntitle: ideas\nowner: someone\n\
created: 2026-08-26\nupdated: 2026-08-26\n---\n\n## Nodes\n\n- N-001 root\n  - N-002 child\n\n\
## Memo\n\nhuman prose\n";
        write_mindmap(&path, hand_written, 0).unwrap();

        let doc = read_mindmap(&path).unwrap();
        assert!(doc.content.contains("owner: someone"));
        assert!(doc.content.contains("human prose"));
        assert!(doc.mtime > 0);
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn write_rejects_a_stale_mtime() {
        let vault = temp_vault("write-stale");
        let created = create_mindmap(&vault, "demo", "ideas").unwrap();
        let path = PathBuf::from(&created.path);
        let doc = read_mindmap(&path).unwrap();

        // A mtime that never matches stands in for an external edit.
        let err = write_mindmap(&path, &doc.content, doc.mtime + 9_999).unwrap_err();
        assert!(err.contains("changed on disk"), "unexpected error: {err}");

        // The matching mtime is accepted.
        write_mindmap(&path, &doc.content, doc.mtime).unwrap();
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn write_rejects_content_that_is_not_a_mindmap() {
        let vault = temp_vault("write-invalid");
        let created = create_mindmap(&vault, "demo", "ideas").unwrap();
        let path = PathBuf::from(&created.path);

        assert!(write_mindmap(&path, "", 0).is_err());
        assert!(write_mindmap(&path, "no frontmatter here", 0).is_err());
        assert!(write_mindmap(&path, "---\ntype: mindmap\n---\n\n## Memo\n", 0).is_err());
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn rename_moves_the_file_and_the_title_together() {
        let vault = temp_vault("rename");
        let created = create_mindmap(&vault, "demo", "ideas").unwrap();
        let path = PathBuf::from(&created.path);

        let renamed = rename_mindmap(&vault, &path, "roadmap ideas").unwrap();
        assert!(renamed.path.ends_with("roadmap ideas.md"));
        assert!(!path.exists());

        let doc = read_mindmap(&PathBuf::from(&renamed.path)).unwrap();
        assert!(doc.content.contains("title: roadmap ideas"));
        // The body is carried over, node ids and all.
        assert!(doc.content.contains("- N-001 ideas"));
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn delete_moves_the_note_to_the_trash_instead_of_unlinking() {
        let vault = temp_vault("delete");
        let created = create_mindmap(&vault, "demo", "ideas").unwrap();
        let path = PathBuf::from(&created.path);

        let moved = delete_mindmap(&vault, &path).unwrap();
        assert!(!path.exists());
        assert!(moved.contains("_ai/memory/mindmap-trash/"));
        assert!(PathBuf::from(&moved).is_file());
        assert!(list_mindmaps(&vault, None).unwrap().is_empty());

        // A second delete of the same name lands beside the first.
        let again = create_mindmap(&vault, "demo", "ideas").unwrap();
        let moved2 = delete_mindmap(&vault, &PathBuf::from(&again.path)).unwrap();
        assert_ne!(moved, moved2);
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn snapshot_round_trips_one_generation() {
        let vault = temp_vault("snapshot");
        let created = create_mindmap(&vault, "demo", "ideas").unwrap();
        let path = PathBuf::from(&created.path);

        assert!(!has_snapshot(&vault, &path));
        save_snapshot(&vault, &path).unwrap();
        assert!(has_snapshot(&vault, &path));

        let edited = "---\ntype: mindmap\ntitle: ideas\n---\n\n## Nodes\n\n- N-001 replaced\n";
        write_mindmap(&path, edited, 0).unwrap();

        let restored = restore_snapshot(&vault, &path).unwrap();
        assert!(restored.content.contains("- N-001 ideas"));
        // Consumed: undo is exactly one generation deep.
        assert!(!has_snapshot(&vault, &path));
        assert!(restore_snapshot(&vault, &path).is_err());
        fs::remove_dir_all(&vault).ok();
    }
}
