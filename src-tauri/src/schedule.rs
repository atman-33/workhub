//! Schedule notes: scanning, reading/writing, and snapshots (T-0088..T-0091).
//! The lifecycle itself is the shared one in `vault_note_doc` (T-1221); this
//! module is the schedule's kind description, its skeleton, and the thin entry
//! points the commands call.
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
use crate::vault_note::frontmatter_value;
use crate::vault_note_doc::{self as note_doc, NoteKind};
use std::path::Path;

/// What a schedule is to the shared note lifecycle.
const KIND: NoteKind = NoteKind {
    name: "schedule",
    dir: "schedules",
    trash_dir: "schedule-trash",
    // Deliberately only the two section headings: the element grammar is
    // validated on the frontend, and the guard exists to catch a buffer that is
    // not a schedule at all.
    required_sections: &["## Items", "## Non-working"],
};

/// Lists schedule notes across the vault, optionally narrowed to one project
/// slug. See `vault_note::scan_notes` for what a scan skips and why.
pub fn list_schedules(vault: &Path, project: Option<&str>) -> Result<Vec<ScheduleFile>, String> {
    Ok(note_doc::list(vault, &KIND, project)?
        .into_iter()
        .map(|n| ScheduleFile {
            range: frontmatter_value(&n.front, "range"),
            path: n.path,
            project: n.project,
            title: n.title,
            updated: n.updated,
        })
        .collect())
}

pub fn read_schedule(path: &Path) -> Result<ScheduleDoc, String> {
    note_doc::read(path)
}

/// Writes the file only when its on-disk mtime still matches `expected_mtime`
/// (`0` skips the check). Returns the new mtime. See [`note_doc::write`].
pub fn write_schedule(path: &Path, content: &str, expected_mtime: u64) -> Result<u64, String> {
    note_doc::write(&KIND, path, content, expected_mtime)
}

/// The text of a new schedule note.
pub fn skeleton(title: &str, range: &str, now: &str) -> String {
    format!(
        "---
type: schedule
title: {title}
range: {range}
created: {now}
updated: {now}
---

## Non-working

- weekly: sat, sun

## Items

## Memo

"
    )
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
    let made = note_doc::create(vault, &KIND, project, title, |title, now| {
        skeleton(title, range, now)
    })?;
    Ok(ScheduleFile {
        path: made.path,
        project: made.project,
        title: made.title,
        range: range.to_string(),
        updated: made.updated,
    })
}

/// Renames a schedule note (T-0157): title and file name move together, the
/// body (including `## Memo`) is untouched, `range` is kept, and the snapshot
/// follows. See [`note_doc::rename`].
pub fn rename_schedule(vault: &Path, path: &Path, new_title: &str) -> Result<ScheduleFile, String> {
    let renamed = note_doc::rename(vault, &KIND, path, new_title)?;
    Ok(ScheduleFile {
        range: frontmatter_value(&renamed.front, "range"),
        path: renamed.path,
        project: renamed.project,
        title: renamed.title,
        updated: renamed.updated,
    })
}

/// Moves a schedule note into `_ai/state/schedule-trash/` and returns where
/// it went. See [`note_doc::delete`].
pub fn delete_schedule(vault: &Path, path: &Path) -> Result<String, String> {
    note_doc::delete(vault, &KIND, path)
}

/// Writes a generated HTML export. See [`note_doc::export_text`] for the
/// destination rules (T-0379).
pub fn export_html(
    vault: Option<&Path>,
    project: Option<&str>,
    out_path: &Path,
    html: &str,
) -> Result<(), String> {
    note_doc::export_text(vault, project, out_path, html)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagram::{has_snapshot, restore_snapshot, save_snapshot};
    use crate::vault_note::today;
    use std::fs;
    use std::path::PathBuf;
    use std::time::UNIX_EPOCH;

    fn temp_vault(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("workhub-sched-{name}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Most tests here create a schedule in the "demo" project, so this
    /// creates that folder up front — `create_schedule` resolves an existing
    /// project by slug rather than conjuring one (T-0278). The handful of
    /// tests that exercise `create_project`/`list_projects` directly build
    /// their own vault from the bare `temp_vault` instead.
    fn temp_vault_with_demo(name: &str) -> PathBuf {
        let vault = temp_vault(name);
        fs::create_dir_all(vault.join("projects").join("demo")).unwrap();
        vault
    }

    #[test]
    fn create_then_list_finds_the_note() {
        let vault = temp_vault_with_demo("create-list");
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
        let vault = temp_vault_with_demo("create-dup");
        let a = create_schedule(&vault, "demo", "plan", "").unwrap();
        let b = create_schedule(&vault, "demo", "plan", "").unwrap();
        assert_ne!(a.path, b.path);
        assert!(b.path.ends_with("plan 2.md"));
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn delete_moves_the_note_to_the_trash_instead_of_unlinking() {
        let vault = temp_vault_with_demo("delete");
        let created = create_schedule(&vault, "demo", "plan", "").unwrap();
        let path = PathBuf::from(&created.path);

        let moved = delete_schedule(&vault, &path).unwrap();
        assert!(!path.exists());
        assert!(moved.contains("_ai/state/schedule-trash/"));
        assert!(PathBuf::from(&moved).is_file());
        assert!(list_schedules(&vault, None).unwrap().is_empty());

        // A second delete of the same name lands beside the first.
        let again = create_schedule(&vault, "demo", "plan", "").unwrap();
        let moved2 = delete_schedule(&vault, &PathBuf::from(&again.path)).unwrap();
        assert_ne!(moved, moved2);
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn delete_drops_the_ai_snapshot_with_the_note() {
        let vault = temp_vault_with_demo("delete-snapshot");
        let created = create_schedule(&vault, "demo", "plan", "").unwrap();
        let path = PathBuf::from(&created.path);

        save_snapshot(&vault, &path).unwrap();
        assert!(has_snapshot(&vault, &path));
        delete_schedule(&vault, &path).unwrap();
        assert!(!has_snapshot(&vault, &path));
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn write_preserves_memo_and_unmanaged_frontmatter() {
        let vault = temp_vault_with_demo("write-preserve");
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
        let vault = temp_vault_with_demo("write-stale");
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

    /// Characterises today's behaviour (T-1221): unlike `write_diagram`, a
    /// guarded write to a note that has vanished *recreates* it. The views'
    /// `flushSave` exists to work around this. A later step makes the three
    /// kinds refuse; this test then changes with it.
    #[test]
    fn guarded_write_to_a_vanished_note_recreates_it() {
        let vault = temp_vault_with_demo("write-gone");
        let created = create_schedule(&vault, "demo", "plan", "").unwrap();
        let path = PathBuf::from(&created.path);
        let doc = read_schedule(&path).unwrap();
        fs::remove_file(&path).unwrap();

        write_schedule(&path, &doc.content, doc.mtime).unwrap();
        assert!(path.is_file());
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn rename_keeps_the_range() {
        let vault = temp_vault_with_demo("rename-range");
        let created = create_schedule(&vault, "demo", "plan", "2026-07-20..2026-08-31").unwrap();
        let renamed = rename_schedule(&vault, &PathBuf::from(&created.path), "plan v2").unwrap();
        assert_eq!(renamed.range, "2026-07-20..2026-08-31");
        assert_eq!(renamed.project, "demo");
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn delete_refuses_a_note_that_is_already_gone() {
        let vault = temp_vault_with_demo("delete-gone");
        let created = create_schedule(&vault, "demo", "plan", "").unwrap();
        let path = PathBuf::from(&created.path);
        delete_schedule(&vault, &path).unwrap();
        let err = delete_schedule(&vault, &path).unwrap_err();
        assert!(err.contains("no longer exists"), "error: {err}");
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn write_rejects_content_that_is_not_a_schedule() {
        let vault = temp_vault_with_demo("write-invalid");
        let created = create_schedule(&vault, "demo", "plan", "").unwrap();
        let path = PathBuf::from(&created.path);

        assert!(write_schedule(&path, "", 0).is_err());
        assert!(write_schedule(&path, "no frontmatter here", 0).is_err());
        assert!(write_schedule(&path, "---\ntype: schedule\n---\n\n## Items\n", 0).is_err());
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn rename_moves_the_title_and_the_file_together() {
        let vault = temp_vault_with_demo("rename");
        let created = create_schedule(&vault, "demo", "plan", "2026-07-20..2026-08-31").unwrap();
        let path = PathBuf::from(&created.path);
        let with_memo = read_schedule(&path)
            .unwrap()
            .content
            .replace("## Memo\n", "## Memo\n\nhuman prose\n");
        write_schedule(&path, &with_memo, 0).unwrap();

        let renamed = rename_schedule(&vault, &path, "  2026Q3 plan  ").unwrap();
        assert!(renamed
            .path
            .ends_with("projects/demo/schedules/2026Q3 plan.md"));
        assert_eq!(renamed.title, "2026Q3 plan");
        assert_eq!(renamed.project, "demo");
        assert_eq!(renamed.range, "2026-07-20..2026-08-31");
        assert!(!path.exists());

        let doc = read_schedule(&PathBuf::from(&renamed.path)).unwrap();
        assert!(doc.content.contains("title: 2026Q3 plan"));
        assert!(doc.content.contains(&format!("updated: {}", today())));
        assert!(doc.content.contains("human prose"));

        // The picker sees exactly one note, under its new name.
        let listed = list_schedules(&vault, None).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].title, "2026Q3 plan");
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn rename_never_overwrites_another_note() {
        let vault = temp_vault_with_demo("rename-dup");
        create_schedule(&vault, "demo", "taken", "").unwrap();
        let created = create_schedule(&vault, "demo", "plan", "").unwrap();
        let path = PathBuf::from(&created.path);

        let renamed = rename_schedule(&vault, &path, "taken").unwrap();
        assert!(renamed.path.ends_with("taken 2.md"));
        assert_eq!(list_schedules(&vault, None).unwrap().len(), 2);

        // Renaming a note to the name it already has is not a collision.
        let same = rename_schedule(&vault, &PathBuf::from(&renamed.path), "taken 2").unwrap();
        assert_eq!(same.path, renamed.path);
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn rename_carries_the_snapshot_to_the_new_path() {
        let vault = temp_vault_with_demo("rename-snapshot");
        let created = create_schedule(&vault, "demo", "plan", "").unwrap();
        let path = PathBuf::from(&created.path);
        let original = read_schedule(&path).unwrap().content;
        save_snapshot(&vault, &path).unwrap();

        let renamed = rename_schedule(&vault, &path, "later").unwrap();
        let new_path = PathBuf::from(&renamed.path);
        assert!(!has_snapshot(&vault, &path));
        assert!(has_snapshot(&vault, &new_path));

        // The undo still restores the pre-rename content (title included), so
        // an AI edit made before the rename remains undoable after it.
        let restored = restore_snapshot(&vault, &new_path).unwrap();
        assert_eq!(restored.content, original);
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn rename_rejects_an_empty_title() {
        let vault = temp_vault_with_demo("rename-empty");
        let created = create_schedule(&vault, "demo", "plan", "").unwrap();
        let path = PathBuf::from(&created.path);
        assert!(rename_schedule(&vault, &path, "   ").is_err());
        assert!(path.exists());
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn snapshot_round_trips() {
        let vault = temp_vault_with_demo("snapshot");
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
        let vault = temp_vault_with_demo("list-skip");
        create_schedule(&vault, "demo", "plan", "").unwrap();
        let dir = vault.join("projects").join("demo").join("schedules");
        fs::write(dir.join("_example.md"), "---\ntype: schedule\n---\n").unwrap();
        fs::write(dir.join("stray.md"), "just prose, no frontmatter\n").unwrap();
        fs::write(dir.join("other.md"), "---\ntype: note\ntitle: x\n---\n").unwrap();

        let listed = list_schedules(&vault, Some("demo")).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].title, "plan");
        fs::remove_dir_all(&vault).ok();
    }

    /// A numbered project folder (`NNNN-<slug>/`) is the normal case (T-0278):
    /// the export must resolve it via the slug rather than assume the folder
    /// name equals the slug, and write into its `attachments/` (T-0379).
    #[test]
    fn export_html_writes_into_a_numbered_project_folder() {
        let vault = temp_vault("export-numbered");
        fs::create_dir_all(vault.join("projects").join("0010-demo")).unwrap();
        let out = vault
            .join("projects")
            .join("0010-demo")
            .join("attachments")
            .join("plan.html");

        export_html(Some(&vault), Some("demo"), &out, "<html></html>").unwrap();

        assert!(out.is_file());
        assert_eq!(fs::read_to_string(&out).unwrap(), "<html></html>");
        fs::remove_dir_all(&vault).ok();
    }

    /// An unknown slug must not cause `create_dir_all` to invent a second,
    /// wrong, empty project folder — the export is refused instead (T-0379).
    #[test]
    fn export_html_rejects_an_unknown_project_without_creating_a_folder() {
        let vault = temp_vault("export-unknown");
        let out = vault
            .join("projects")
            .join("nope")
            .join("attachments")
            .join("plan.html");

        let err = export_html(Some(&vault), Some("nope"), &out, "<html></html>").unwrap_err();
        assert!(err.contains("nope"));
        assert!(!vault.join("projects").join("nope").exists());
        assert!(!out.exists());
        fs::remove_dir_all(&vault).ok();
    }

    /// A user-configured export directory (`settings.schedule_export_dir`) is
    /// not under any project, so the guard is skipped and the whole path is
    /// created as before (T-0379).
    #[test]
    fn export_html_creates_a_custom_directory_when_no_project_guard_is_given() {
        let vault = temp_vault("export-custom");
        let out = vault.join("elsewhere").join("exports").join("plan.html");

        export_html(None, None, &out, "<html></html>").unwrap();

        assert!(out.is_file());
        fs::remove_dir_all(&vault).ok();
    }
}
