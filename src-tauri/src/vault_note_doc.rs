//! The lifecycle of a note document (T-1221): list, read, validate, guarded
//! write, create, rename, delete into a trash folder, and export.
//!
//! Mindmaps, schedules and the other diagram kinds are all one Markdown file
//! under `projects/<slug>/`, edited from the app, from Obsidian and by agents
//! at the same time. They used to carry three copies of the same policy; this
//! module is the one copy. A kind describes itself with a [`NoteKind`] and
//! brings only what is really its own: the skeleton text and the required
//! body sections.
//!
//! What is deliberately *not* here:
//!
//! - the body grammar of any kind. The backend handles a note as a whole
//!   string; the grammar lives on the frontend (see `vault_note.rs`);
//! - the Tauri command wrappers and the per-kind `*File` shapes, which stay in
//!   each kind's module so that the frontend's gateway does not change.

use crate::vault_note::{
    ai_state_dir, ensure_export_dir, frontmatter_value, mtime_secs, norm_path, projects_dir,
    resolve_project_dir, rewrite_frontmatter, scan_notes, snapshot_path, split_frontmatter, today,
    unique_note_path,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

/// What a kind of note is, as far as the lifecycle is concerned.
pub struct NoteKind {
    /// The `type:` frontmatter value. Also the noun in error messages and the
    /// fallback title.
    pub name: &'static str,
    /// Subfolder of a project that holds this kind's notes.
    pub dir: &'static str,
    /// Folder under `_ai/state/` that a deleted note is moved into.
    pub trash_dir: &'static str,
    /// Headings a body must contain to be accepted by [`write`], in the order
    /// they are reported when missing.
    pub required_sections: &'static [&'static str],
}

/// A note's full text plus the mtime that guards the next write.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteDoc {
    /// Absolute path, forward slashes.
    pub path: String,
    pub content: String,
    /// Unix seconds; pass back to [`write`] for conflict detection.
    pub mtime: u64,
}

/// One note as a picker sees it.
pub struct NoteListing {
    pub path: String,
    pub project: String,
    pub title: String,
    pub updated: String,
}

/// A note just created or renamed.
pub struct NoteHandle {
    pub path: String,
    pub project: String,
    pub title: String,
    pub updated: String,
}

/// Lists the notes of `kind` across the vault, optionally narrowed to one
/// project slug. See `vault_note::scan_notes` for what a scan skips and why.
pub fn list(
    vault: &Path,
    kind: &NoteKind,
    project: Option<&str>,
) -> Result<Vec<NoteListing>, String> {
    let notes = scan_notes(vault, kind.dir, kind.name, project)?;
    Ok(notes
        .into_iter()
        .map(|note| {
            let title = match frontmatter_value(&note.front, "title") {
                t if t.is_empty() => note.name.clone(),
                t => t,
            };
            NoteListing {
                path: norm_path(&note.path),
                project: note.project,
                title,
                updated: frontmatter_value(&note.front, "updated"),
            }
        })
        .collect())
}

pub fn read(path: &Path) -> Result<NoteDoc, String> {
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    Ok(NoteDoc {
        path: norm_path(path),
        content,
        mtime: mtime_secs(path),
    })
}

/// Minimal structural check before a write. Deliberately shallow: the grammar
/// is validated on the frontend, and rejecting a file here for a notation slip
/// would block the user from saving their way out of it. What this *does*
/// catch is a caller about to write something that is not a note of this kind
/// at all (a truncated string, an empty buffer from a failed render), which
/// would silently destroy the file.
fn validate(kind: &NoteKind, content: &str) -> Result<(), String> {
    let Some((_, body)) = split_frontmatter(content) else {
        return Err(format!(
            "{} content must start with a frontmatter block",
            kind.name
        ));
    };
    for section in kind.required_sections {
        if !body.contains(section) {
            return Err(format!(
                "{} content is missing the `{section}` section",
                kind.name
            ));
        }
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
pub fn write(
    kind: &NoteKind,
    path: &Path,
    content: &str,
    expected_mtime: u64,
) -> Result<u64, String> {
    validate(kind, content)?;
    if expected_mtime != 0 && path.exists() {
        let current = mtime_secs(path);
        if current != expected_mtime {
            return Err(format!(
                "the {} file changed on disk since it was loaded — reload before saving",
                kind.name
            ));
        }
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, content).map_err(|e| e.to_string())?;
    Ok(mtime_secs(path))
}

/// Creates `projects/<project>/<kind.dir>/<title>.md` from `skeleton(title,
/// today)`. A blank title falls back to the kind's name; an existing note is
/// never overwritten (the name is suffixed until it is free).
pub fn create(
    vault: &Path,
    kind: &NoteKind,
    project: &str,
    title: &str,
    skeleton: impl FnOnce(&str, &str) -> String,
) -> Result<NoteHandle, String> {
    let project = project.trim();
    if project.is_empty() {
        return Err(format!("a project is required to create a {}", kind.name));
    }
    // Resolved by slug rather than joined directly (T-0278): a project folder
    // may carry a `NNNN-` sort prefix, and joining the bare slug would create
    // a second, unnumbered folder beside it instead of writing into the real
    // one.
    let project_dir = resolve_project_dir(&projects_dir(vault), project)?
        .ok_or_else(|| format!("no project named '{project}' is in projects/"))?;
    let dir = project_dir.join(kind.dir);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let title = if title.trim().is_empty() {
        kind.name
    } else {
        title.trim()
    };
    let path = unique_note_path(&dir, title, kind.name, None);
    let now = today();
    let content = skeleton(title, &now);
    fs::write(&path, &content).map_err(|e| e.to_string())?;
    Ok(NoteHandle {
        path: norm_path(&path),
        project: project.to_string(),
        title: title.to_string(),
        updated: now,
    })
}

/// Renames a note. The frontmatter `title` and the file name move
/// **together**: `create` derives one from the other, so letting them drift
/// would leave a note whose name in the app and name in Obsidian disagree.
///
/// Everything else about the file is preserved — only `title` and `updated`
/// are rewritten, and the body is carried over untouched. The snapshot travels
/// with the note, since it is keyed by path and an undo left behind at the old
/// key could never be found again.
pub fn rename(
    vault: &Path,
    kind: &NoteKind,
    path: &Path,
    new_title: &str,
) -> Result<NoteHandle, String> {
    let title = new_title.trim();
    if title.is_empty() {
        return Err(format!("a {} name is required", kind.name));
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let Some((front, body)) = split_frontmatter(&content) else {
        return Err(format!(
            "this file is not a {} note (no frontmatter block)",
            kind.name
        ));
    };
    let dir = path
        .parent()
        .ok_or_else(|| format!("the {} path has no parent folder", kind.name))?;

    // Same collision rule as `create`, except that the note's own file is not
    // a collision — renaming "ideas" to "ideas" (or only changing its case)
    // must not produce "ideas 2".
    let target = unique_note_path(dir, title, kind.name, Some(path));

    let now = today();
    let front_out = rewrite_frontmatter(&front, &[("title", title), ("updated", &now)]);
    let updated_content = format!("---\n{front_out}---\n{body}");
    fs::write(path, &updated_content).map_err(|e| e.to_string())?;

    // Compared exactly here, not case-insensitively: renaming "ideas" to
    // "Ideas" is a real rename the user asked for, even though the two names
    // collide on Windows.
    if norm_path(&target) != norm_path(path) {
        fs::rename(path, &target).map_err(|e| e.to_string())?;
        crate::vault_note::move_snapshot(vault, SNAPSHOT_DIR, path, &target)?;
    }

    let project = dir
        .parent()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    Ok(NoteHandle {
        path: norm_path(&target),
        project,
        title: title.to_string(),
        updated: now,
    })
}

/// Moves a note into `_ai/state/<kind.trash_dir>/` and returns where it went.
///
/// Deliberately not an unlink. These files are shared with Obsidian and with
/// agents, they can hold hand-written prose, and the app's delete is one click
/// behind one confirmation — a recoverable move is the proportionate
/// operation. Anything older than the last delete of a given note is covered
/// by the vault's git backup.
pub fn delete(vault: &Path, kind: &NoteKind, path: &Path) -> Result<String, String> {
    if !path.is_file() {
        return Err(format!("this {} no longer exists", kind.name));
    }
    let dir = ai_state_dir(vault).join(kind.trash_dir);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = path
        .file_stem()
        .and_then(|n| n.to_str())
        .unwrap_or(kind.name)
        .to_string();
    // Two projects may hold a note of the same name, and the same note may be
    // deleted twice; suffix rather than overwrite what is already in the trash.
    let target = unique_note_path(&dir, &format!("{name} {}", today()), kind.name, None);
    fs::rename(path, &target).map_err(|e| e.to_string())?;
    // The snapshot describes a file that is no longer there. Leaving it would
    // make a later note that happens to reuse the path inherit a stranger's
    // undo.
    let _ = fs::remove_file(snapshot_path(vault, SNAPSHOT_DIR, path));
    Ok(norm_path(&target))
}

/// Writes a generated text export (self-contained HTML, or SVG). Kept in Rust
/// rather than as a browser download so the default destination can be the
/// project's `attachments/` folder inside the vault — the export is part of
/// the project record.
///
/// `vault`/`project` are `Some` only when `out_path` is the vault's own
/// default destination: see [`ensure_export_dir`] for what that guards
/// against (T-0379).
pub fn export_text(
    vault: Option<&Path>,
    project: Option<&str>,
    out_path: &Path,
    content: &str,
) -> Result<(), String> {
    ensure_export_dir(vault, project, out_path)?;
    fs::write(out_path, content).map_err(|e| e.to_string())
}

/// Writes a generated binary export (PNG), given its base64 payload. Same
/// destination rules as [`export_text`].
pub fn export_binary(
    vault: Option<&Path>,
    project: Option<&str>,
    out_path: &Path,
    base64_data: &str,
) -> Result<(), String> {
    let bytes = crate::b64::decode(base64_data)?;
    ensure_export_dir(vault, project, out_path)?;
    fs::write(out_path, bytes).map_err(|e| e.to_string())
}

/// The folder every kind keeps its AI-edit undo snapshot in. Owned by
/// `diagram` for now; the lifecycle only needs to carry or drop it.
const SNAPSHOT_DIR: &str = crate::diagram::SNAPSHOT_DIR;

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    const TWO: NoteKind = NoteKind {
        name: "thing",
        dir: "things",
        trash_dir: "thing-trash",
        required_sections: &["## One", "## Two"],
    };

    fn temp_vault(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("workhub-notedoc-{name}-{nanos}"));
        fs::create_dir_all(dir.join("projects").join("demo")).unwrap();
        dir
    }

    fn skeleton(title: &str, now: &str) -> String {
        format!("---\ntype: thing\ntitle: {title}\nupdated: {now}\n---\n\n## One\n\n## Two\n\n")
    }

    #[test]
    fn validate_names_the_first_missing_section() {
        let err = validate(&TWO, "---\ntype: thing\n---\n\n## Two\n").unwrap_err();
        assert_eq!(err, "thing content is missing the `## One` section");
        let err = validate(&TWO, "---\ntype: thing\n---\n\n## One\n").unwrap_err();
        assert_eq!(err, "thing content is missing the `## Two` section");
        assert!(validate(&TWO, "---\ntype: thing\n---\n\n## One\n## Two\n").is_ok());
        let err = validate(&TWO, "no frontmatter").unwrap_err();
        assert_eq!(err, "thing content must start with a frontmatter block");
    }

    #[test]
    fn a_kind_runs_the_whole_lifecycle_in_its_own_folders() {
        let vault = temp_vault("life");
        let made = create(&vault, &TWO, "demo", "first", skeleton).unwrap();
        assert!(made.path.ends_with("projects/demo/things/first.md"));

        let listed = list(&vault, &TWO, None).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].title, "first");

        let renamed = rename(&vault, &TWO, Path::new(&made.path), "second").unwrap();
        assert!(renamed.path.ends_with("things/second.md"));
        assert_eq!(renamed.project, "demo");

        let moved = delete(&vault, &TWO, Path::new(&renamed.path)).unwrap();
        assert!(moved.contains("_ai/state/thing-trash/"), "{moved}");
        assert!(list(&vault, &TWO, None).unwrap().is_empty());
        fs::remove_dir_all(&vault).ok();
    }
}
