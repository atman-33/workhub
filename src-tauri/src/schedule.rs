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
use crate::vault_note::{
    frontmatter_value, has_snapshot as note_has_snapshot, move_snapshot, mtime_secs, norm_path,
    restore_snapshot as note_restore_snapshot, rewrite_frontmatter,
    save_snapshot as note_save_snapshot, scan_notes, split_frontmatter, today, unique_note_path,
};
use std::fs;
use std::path::Path;

/// Subfolder of a project that holds its schedule notes.
const SCHEDULES_DIR: &str = "schedules";

/// Note kind written into a schedule note's `type:` frontmatter key.
const KIND: &str = "schedule";

/// Folder under `_ai/memory/` where `run_schedule_edit` parks a copy of the
/// file before an agent touches it, so the UI can offer a one-generation undo
/// (design note §9.5).
const SNAPSHOT_DIR: &str = "schedule-snapshots";

/// Folder under `_ai/memory/` that a deleted note is moved into.
const TRASH_DIR: &str = "schedule-trash";

/// Lists schedule notes across the vault, optionally narrowed to one project
/// slug. See `vault_note::scan_notes` for what a scan skips and why.
pub fn list_schedules(vault: &Path, project: Option<&str>) -> Result<Vec<ScheduleFile>, String> {
    let notes = scan_notes(vault, SCHEDULES_DIR, KIND, project)?;
    Ok(notes
        .into_iter()
        .map(|note| {
            let title = match frontmatter_value(&note.front, "title") {
                t if t.is_empty() => note.name.clone(),
                t => t,
            };
            ScheduleFile {
                path: norm_path(&note.path),
                project: note.project,
                title,
                range: frontmatter_value(&note.front, "range"),
                updated: frontmatter_value(&note.front, "updated"),
            }
        })
        .collect())
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
    let dir = crate::vault_note::projects_dir(vault)
        .join(project)
        .join(SCHEDULES_DIR);
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

/// Renames a schedule note (T-0157). The frontmatter `title` and the file name
/// move **together**: `create_schedule` derives one from the other, so letting
/// them drift would leave a note whose name in the app and name in Obsidian
/// disagree.
///
/// Everything else about the file is preserved — only `title` and `updated` are
/// rewritten, and the body (including `## Memo`) is carried over untouched.
/// The snapshot travels with the note, since it is keyed by path and an undo
/// left behind at the old key could never be found again.
pub fn rename_schedule(vault: &Path, path: &Path, new_title: &str) -> Result<ScheduleFile, String> {
    let title = new_title.trim();
    if title.is_empty() {
        return Err("a schedule name is required".into());
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let Some((front, body)) = split_frontmatter(&content) else {
        return Err("this file is not a schedule note (no frontmatter block)".into());
    };
    let dir = path
        .parent()
        .ok_or_else(|| "the schedule path has no parent folder".to_string())?;

    // Same collision rule as `create_schedule`, except that the note's own file
    // is not a collision — renaming "plan" to "plan" (or only changing its
    // case) must not produce "plan 2".
    let target = unique_note_path(dir, title, KIND, Some(path));

    let now = today();
    let front_out = rewrite_frontmatter(&front, &[("title", title), ("updated", &now)]);
    let updated_content = format!("---\n{front_out}---\n{body}");
    fs::write(path, &updated_content).map_err(|e| e.to_string())?;

    // Compared exactly here, not case-insensitively: renaming "plan" to "Plan"
    // is a real rename the user asked for, even though the two names collide on
    // Windows.
    if norm_path(&target) != norm_path(path) {
        fs::rename(path, &target).map_err(|e| e.to_string())?;
        move_snapshot(vault, SNAPSHOT_DIR, path, &target)?;
    }

    let project = dir
        .parent()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    Ok(ScheduleFile {
        path: norm_path(&target),
        project,
        title: title.to_string(),
        range: frontmatter_value(&front, "range"),
        updated: now,
    })
}

/// Moves a schedule note into `_ai/memory/schedule-trash/` and returns where
/// it went.
///
/// Deliberately not an unlink, for the same reasons as the mindmap's delete:
/// these files are shared with Obsidian and with agents, they can hold
/// hand-written prose under `## Memo`, and the app's delete is one click behind
/// one confirmation — a recoverable move is the proportionate operation.
/// Anything older than the last delete of a given note is covered by the
/// vault's git backup.
pub fn delete_schedule(vault: &Path, path: &Path) -> Result<String, String> {
    if !path.is_file() {
        return Err("this schedule no longer exists".into());
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

pub fn save_snapshot(vault: &Path, target: &Path) -> Result<(), String> {
    note_save_snapshot(vault, SNAPSHOT_DIR, target)
}

/// Restores the schedule from its snapshot and consumes it, so "undo" is
/// exactly one generation deep and cannot be pressed twice against a snapshot
/// that no longer describes a state the user wants back (§9.5).
pub fn restore_snapshot(vault: &Path, target: &Path) -> Result<ScheduleDoc, String> {
    note_restore_snapshot(vault, SNAPSHOT_DIR, target, KIND)?;
    read_schedule(target)
}

pub fn has_snapshot(vault: &Path, target: &Path) -> bool {
    note_has_snapshot(vault, SNAPSHOT_DIR, target)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault_note::{create_project, list_projects};
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
    fn delete_moves_the_note_to_the_trash_instead_of_unlinking() {
        let vault = temp_vault("delete");
        let created = create_schedule(&vault, "demo", "plan", "").unwrap();
        let path = PathBuf::from(&created.path);

        let moved = delete_schedule(&vault, &path).unwrap();
        assert!(!path.exists());
        assert!(moved.contains("_ai/memory/schedule-trash/"));
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
        let vault = temp_vault("delete-snapshot");
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
    fn rename_moves_the_title_and_the_file_together() {
        let vault = temp_vault("rename");
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
        let vault = temp_vault("rename-dup");
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
        let vault = temp_vault("rename-snapshot");
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
        let vault = temp_vault("rename-empty");
        let created = create_schedule(&vault, "demo", "plan", "").unwrap();
        let path = PathBuf::from(&created.path);
        assert!(rename_schedule(&vault, &path, "   ").is_err());
        assert!(path.exists());
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
    fn list_projects_finds_folders_without_any_schedule_yet() {
        let vault = temp_vault("projects");
        // The deadlock this guards: a project with no `schedules/` folder at
        // all must still be offered, or the first schedule can never be made.
        fs::create_dir_all(vault.join("projects").join("alpha")).unwrap();
        fs::create_dir_all(vault.join("projects").join("beta").join(SCHEDULES_DIR)).unwrap();
        fs::create_dir_all(vault.join("projects").join("_wip")).unwrap();
        fs::write(vault.join("projects").join("_index.md"), "x").unwrap();

        assert_eq!(list_projects(&vault).unwrap(), vec!["alpha", "beta"]);
        assert!(list_schedules(&vault, None).unwrap().is_empty());
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn create_project_scaffolds_the_template() {
        let vault = temp_vault("project-create");
        create_project(&vault, "demo", "Demo project").unwrap();

        let readme = fs::read_to_string(vault.join("projects/demo/README.md")).unwrap();
        assert!(readme.contains("title: Demo project"), "README: {readme}");
        assert!(readme.contains("project: demo"), "README: {readme}");
        assert!(
            readme.contains(&format!("updated: {}", today())),
            "README: {readme}"
        );
        assert!(!readme.contains("<Project name>"), "README: {readme}");
        // The (example-free) schedules folder exists from the start.
        assert!(vault.join("projects/demo/schedules").is_dir());
        // The notation demos are not part of a fresh project.
        assert!(!vault.join("projects/demo/schedules/_example.md").exists());
        assert!(!vault.join("projects/demo/specs/_example.md").exists());
        assert!(!vault
            .join("projects/demo/backlog/B-000-example.md")
            .exists());
        // The new project shows up in the picker.
        assert_eq!(list_projects(&vault).unwrap(), vec!["demo"]);
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn create_project_defaults_the_display_name_to_the_slug() {
        let vault = temp_vault("project-noname");
        create_project(&vault, "demo", "  ").unwrap();
        let readme = fs::read_to_string(vault.join("projects/demo/README.md")).unwrap();
        assert!(readme.contains("title: demo"), "README: {readme}");
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn create_project_refuses_an_existing_folder() {
        let vault = temp_vault("project-exists");
        create_project(&vault, "demo", "").unwrap();
        let err = create_project(&vault, "demo", "").unwrap_err();
        assert!(err.contains("already exists"), "error: {err}");
        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn create_project_rejects_unusable_slugs() {
        let vault = temp_vault("project-slug");
        for slug in ["", "  ", "a/b", "a\\b", "..", "_wip", ".hidden"] {
            assert!(
                create_project(&vault, slug, "x").is_err(),
                "slug {slug:?} was accepted"
            );
        }
        // Nothing was created on disk.
        assert!(list_projects(&vault).unwrap().is_empty());
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
