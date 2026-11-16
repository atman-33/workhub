//! Mindmap notes: scanning, reading/writing, snapshots, and soft delete
//! (T-0188).
//!
//! A mindmap note is one `projects/<slug>/mindmaps/<name>.md` file. Like a
//! schedule note it is a *thinking* surface — the user restructures a tree
//! until it says what they mean — so writes are frequent and arrive from the
//! app, from Obsidian, and from a headless agent.
//!
//! The lifecycle (guarded write, rename, soft delete, export) is the shared
//! one in `vault_note_doc` (T-1221); this module is the mindmap's kind
//! description, its skeleton and the thin entry points the commands call.
//! Two rules shape what the lifecycle does:
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
//! Deleting is *soft*: the note is moved into `_ai/state/mindmap-trash/`
//! instead of being unlinked, because the app is not the only writer of these
//! files and a mis-click should not destroy prose someone typed in Obsidian.

use crate::models::{MindmapDoc, MindmapFile};
use crate::vault_note_doc::{self as note_doc, NoteKind};
use std::path::Path;

/// What a mindmap is to the shared note lifecycle.
const KIND: NoteKind = NoteKind {
    name: "mindmap",
    dir: "mindmaps",
    trash_dir: "mindmap-trash",
    // Deliberately only the node list: the grammar is validated on the
    // frontend, and the guard exists to catch a buffer that is not a mindmap
    // at all.
    required_sections: &["## Nodes"],
};

/// Lists mindmap notes across the vault, optionally narrowed to one project
/// slug. See `vault_note::scan_notes` for what a scan skips and why.
pub fn list_mindmaps(vault: &Path, project: Option<&str>) -> Result<Vec<MindmapFile>, String> {
    Ok(note_doc::list(vault, &KIND, project)?
        .into_iter()
        .map(|n| MindmapFile {
            path: n.path,
            project: n.project,
            title: n.title,
            updated: n.updated,
        })
        .collect())
}

pub fn read_mindmap(path: &Path) -> Result<MindmapDoc, String> {
    note_doc::read(path)
}

/// Writes the file only when its on-disk mtime still matches `expected_mtime`
/// (`0` skips the check). Returns the new mtime. See [`note_doc::write`].
pub fn write_mindmap(path: &Path, content: &str, expected_mtime: u64) -> Result<u64, String> {
    note_doc::write(&KIND, path, content, expected_mtime)
}

/// The text of a new mindmap note.
pub fn skeleton(title: &str, now: &str) -> String {
    format!(
        "---\ntype: mindmap\ntitle: {title}\ncreated: {now}\nupdated: {now}\n---\n\n\
## Nodes\n\n- N-001 {title}\n\n## Memo\n\n"
    )
}

/// Creates `projects/<project>/mindmaps/<title>.md` from the skeleton.
///
/// The skeleton is not empty: a mindmap with no root is not a mindmap, and the
/// canvas would have nothing to draw or select. `N-001` is seeded with the
/// note's own title, which is what the user just typed and almost always what
/// they want at the centre.
pub fn create_mindmap(vault: &Path, project: &str, title: &str) -> Result<MindmapFile, String> {
    let made = note_doc::create(vault, &KIND, project, title, skeleton)?;
    Ok(MindmapFile {
        path: made.path,
        project: made.project,
        title: made.title,
        updated: made.updated,
    })
}

/// Renames a mindmap note: title and file name move together, the body
/// (including `## Memo`) is untouched, and the snapshot follows. See
/// [`note_doc::rename`].
pub fn rename_mindmap(vault: &Path, path: &Path, new_title: &str) -> Result<MindmapFile, String> {
    let renamed = note_doc::rename(vault, &KIND, path, new_title)?;
    Ok(MindmapFile {
        path: renamed.path,
        project: renamed.project,
        title: renamed.title,
        updated: renamed.updated,
    })
}

/// Moves a mindmap note into `_ai/state/mindmap-trash/` and returns where it
/// went. See [`note_doc::delete`].
pub fn delete_mindmap(vault: &Path, path: &Path) -> Result<String, String> {
    note_doc::delete(vault, &KIND, path)
}

/// Writes a generated export (self-contained HTML, or SVG). See
/// [`note_doc::export_text`].
pub fn export_file(
    vault: Option<&Path>,
    project: Option<&str>,
    out_path: &Path,
    content: &str,
) -> Result<(), String> {
    note_doc::export_text(vault, project, out_path, content)
}

/// Writes a generated binary export (PNG), given its base64 payload. See
/// [`note_doc::export_binary`].
pub fn export_binary(
    vault: Option<&Path>,
    project: Option<&str>,
    out_path: &Path,
    base64_data: &str,
) -> Result<(), String> {
    note_doc::export_binary(vault, project, out_path, base64_data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagram::{has_snapshot, restore_snapshot, save_snapshot};
    use std::fs;
    use std::path::PathBuf;
    use std::time::UNIX_EPOCH;

    /// Every test here creates a mindmap in the "demo" project, so the
    /// fixture creates that folder up front — `create_mindmap` resolves an
    /// existing project by slug rather than conjuring one (T-0278).
    fn temp_vault(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("workhub-mind-{name}-{nanos}"));
        fs::create_dir_all(dir.join("projects").join("demo")).unwrap();
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
        assert!(moved.contains("_ai/state/mindmap-trash/"));
        assert!(PathBuf::from(&moved).is_file());
        assert!(list_mindmaps(&vault, None).unwrap().is_empty());

        // A second delete of the same name lands beside the first.
        let again = create_mindmap(&vault, "demo", "ideas").unwrap();
        let moved2 = delete_mindmap(&vault, &PathBuf::from(&again.path)).unwrap();
        assert_ne!(moved, moved2);
        fs::remove_dir_all(&vault).ok();
    }

    /// Characterises today's behaviour (T-1221): unlike `write_diagram`, a
    /// guarded write to a note that has vanished *recreates* it. The views'
    /// `flushSave` exists to work around this. A later step makes the three
    /// kinds refuse; this test then changes with it.
    #[test]
    fn guarded_write_to_a_vanished_note_recreates_it() {
        let vault = temp_vault("write-gone");
        let created = create_mindmap(&vault, "demo", "ideas").unwrap();
        let path = PathBuf::from(&created.path);
        let doc = read_mindmap(&path).unwrap();
        fs::remove_file(&path).unwrap();

        write_mindmap(&path, &doc.content, doc.mtime).unwrap();
        assert!(path.is_file());
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn rename_rejects_an_empty_title_and_a_non_note() {
        let vault = temp_vault("rename-invalid");
        let created = create_mindmap(&vault, "demo", "ideas").unwrap();
        let path = PathBuf::from(&created.path);
        let err = rename_mindmap(&vault, &path, "  ").unwrap_err();
        assert!(err.contains("name is required"), "error: {err}");

        let stray = path.with_file_name("stray.md");
        fs::write(&stray, "just prose\n").unwrap();
        let err = rename_mindmap(&vault, &stray, "x").unwrap_err();
        assert!(err.contains("no frontmatter"), "error: {err}");
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn delete_refuses_a_note_that_is_already_gone() {
        let vault = temp_vault("delete-gone");
        let created = create_mindmap(&vault, "demo", "ideas").unwrap();
        let path = PathBuf::from(&created.path);
        delete_mindmap(&vault, &path).unwrap();
        let err = delete_mindmap(&vault, &path).unwrap_err();
        assert!(err.contains("no longer exists"), "error: {err}");
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

    /// A numbered project folder (`NNNN-<slug>/`) is the normal case
    /// (T-0278): the export must resolve it via the slug rather than assume
    /// the folder name equals the slug, and write into its `attachments/`
    /// (T-0379).
    #[test]
    fn export_file_writes_into_a_numbered_project_folder() {
        let vault = temp_vault("export-numbered");
        fs::create_dir_all(vault.join("projects").join("0020-other")).unwrap();
        let out = vault
            .join("projects")
            .join("0020-other")
            .join("attachments")
            .join("map.html");

        export_file(Some(&vault), Some("other"), &out, "<html></html>").unwrap();

        assert!(out.is_file());
        assert_eq!(fs::read_to_string(&out).unwrap(), "<html></html>");
        fs::remove_dir_all(&vault).ok();
    }

    /// An unknown slug must not cause `create_dir_all` to invent a second,
    /// wrong, empty project folder — the export is refused instead (T-0379).
    #[test]
    fn export_file_rejects_an_unknown_project_without_creating_a_folder() {
        let vault = temp_vault("export-unknown");
        let out = vault
            .join("projects")
            .join("nope")
            .join("attachments")
            .join("map.html");

        let err = export_file(Some(&vault), Some("nope"), &out, "<html></html>").unwrap_err();
        assert!(err.contains("nope"));
        assert!(!vault.join("projects").join("nope").exists());
        assert!(!out.exists());
        fs::remove_dir_all(&vault).ok();
    }

    /// `export_binary` (PNG) applies the same guard as `export_file`.
    #[test]
    fn export_binary_rejects_an_unknown_project_without_creating_a_folder() {
        let vault = temp_vault("export-binary-unknown");
        let out = vault
            .join("projects")
            .join("nope")
            .join("attachments")
            .join("map.png");
        // A minimal valid base64 payload; the guard runs before decoding
        // would matter.
        let err = export_binary(Some(&vault), Some("nope"), &out, "AA==").unwrap_err();
        assert!(err.contains("nope"));
        assert!(!vault.join("projects").join("nope").exists());
        fs::remove_dir_all(&vault).ok();
    }
}
