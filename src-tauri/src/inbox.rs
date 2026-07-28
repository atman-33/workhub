//! The vault's `inbox/` folder: listing raw notes and the tidy agent's
//! deferred filing proposals (T-0104, phase 1).
//!
//! Notes a human drops into `inbox/` were invisible to the app: only the tidy
//! routine (`tidy.rs`) ever looked at them, and when its unattended run could
//! not decide where a note belonged it parked a proposal in
//! `_ai/memory/tidy-pending.json` that nothing ever displayed. This module is
//! the read side of that gap — it enumerates the folder and surfaces those
//! proposals so the Inbox tab can show both.
//!
//! **The exclusion rules live here, once.** `tidy.rs` decides whether the
//! vault has work by asking this module for the same list the UI shows, rather
//! than walking `inbox/` with a second copy of the rules — a note the user can
//! see in the tab is exactly a note tidy would consider, by construction.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Where the kb-ingest skill records the notes it declined to file itself.
const PENDING_FILE: &[&str] = &["_ai", "memory", "tidy-pending.json"];

/// A tidy run's deferred filing decision for one inbox note.
#[derive(Clone, Debug, Default, serde::Serialize)]
pub struct PendingProposal {
    /// Why the agent did not file the note itself.
    pub reason: String,
    /// Where it thinks the note should go (free text — it may name several
    /// candidates, which is precisely why it deferred).
    pub proposal: String,
}

/// One note in `inbox/`, as the Inbox tab renders it.
#[derive(Clone, Debug, serde::Serialize)]
pub struct InboxNote {
    /// Absolute path, forward slashes — the id used by `read_note`.
    pub path: String,
    /// Vault-relative path, forward slashes (matches `tidy-pending.json`).
    pub rel_path: String,
    /// File name without the `.md` extension.
    pub name: String,
    /// Last-modified time, unix seconds.
    pub modified: u64,
    /// Whole days since `modified`.
    pub age_days: u64,
    /// True once `age_days` reaches the tidy `stale_days` threshold — i.e. the
    /// note is old enough for the tidy routine to act on it.
    pub stale: bool,
    /// The tidy agent's parked proposal for this note, when it has one.
    pub pending: Option<PendingProposal>,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Modification time in unix seconds. An unreadable mtime yields `u64::MAX`,
/// which reads as "just now" everywhere it is used — tidy must never act on a
/// note it cannot date, and the UI must not flag one as stale.
pub fn mtime_secs(p: &Path) -> u64 {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(u64::MAX)
}

fn norm_path(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

// ---------------------------------------------------------------------------
// Pending proposals
// ---------------------------------------------------------------------------

/// The parked proposals, keyed by absolute note path, plus the mtime of the
/// list itself (= when the entries were written).
pub struct Pending {
    entries: HashMap<PathBuf, PendingProposal>,
    /// mtime of `tidy-pending.json`, unix seconds; 0 when there is no list.
    pub mtime: u64,
}

impl Pending {
    /// Whether a deferred note should be left alone: it is on the list and the
    /// user has not edited it since the deferral. Re-running the agent on such
    /// a note would only defer it again.
    pub fn shields(&self, path: &Path, file_mtime: u64) -> bool {
        file_mtime <= self.mtime && self.entries.contains_key(path)
    }

    pub fn get(&self, path: &Path) -> Option<&PendingProposal> {
        self.entries.get(path)
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.entries.len()
    }
}

/// Reads `_ai/memory/tidy-pending.json`. A missing, unreadable, or malformed
/// list is an empty one — the inbox listing and the tidy pre-check both have to
/// work on a vault that has never run a tidy.
pub fn load_pending(vault: &Path) -> Pending {
    let mut file = vault.to_path_buf();
    for part in PENDING_FILE {
        file.push(part);
    }
    let mut entries = HashMap::new();
    let mut mtime = 0;
    if let Ok(text) = fs::read_to_string(&file) {
        mtime = mtime_secs(&file);
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
            for entry in v
                .get("files")
                .and_then(|f| f.as_array())
                .into_iter()
                .flatten()
            {
                if let Some(p) = entry.get("path").and_then(|x| x.as_str()) {
                    let str_field = |key: &str| {
                        entry
                            .get(key)
                            .and_then(|x| x.as_str())
                            .unwrap_or_default()
                            .to_string()
                    };
                    // Vault-relative, forward slashes; join() normalizes.
                    entries.insert(
                        vault.join(p),
                        PendingProposal {
                            reason: str_field("reason"),
                            proposal: str_field("proposal"),
                        },
                    );
                }
            }
        }
    }
    Pending { entries, mtime }
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

/// Every note in `inbox/` the vault considers unfiled, newest first.
///
/// `exclude` names subfolders skipped entirely, and only at the inbox root —
/// they are hold areas the user manages by hand, whereas a folder nested
/// deeper is just structure inside an unfiled note set. `README.md` is the
/// folder's own signage, never a note.
pub fn list_notes(vault: &Path, exclude: &[String], stale_days: u32) -> Vec<InboxNote> {
    let inbox = vault.join("inbox");
    let mut out = Vec::new();
    if !inbox.is_dir() {
        return out;
    }
    let pending = load_pending(vault);
    let mut paths = Vec::new();
    collect(&inbox, true, exclude, &mut paths);

    let now_secs = now();
    let stale_cutoff = now_secs.saturating_sub(stale_days as u64 * 86_400);
    for path in paths {
        let modified = mtime_secs(&path);
        let rel = path.strip_prefix(vault).unwrap_or(&path).to_path_buf();
        out.push(InboxNote {
            name: path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default(),
            age_days: now_secs.saturating_sub(modified.min(now_secs)) / 86_400,
            stale: modified <= stale_cutoff,
            pending: pending.get(&path).cloned(),
            rel_path: norm_path(&rel),
            path: norm_path(&path),
            modified,
        });
    }
    out.sort_by_key(|n| std::cmp::Reverse(n.modified));
    out
}

/// Recursively gathers candidate `.md` files, applying the exclusion rules.
fn collect(dir: &Path, is_inbox_root: bool, exclude: &[String], out: &mut Vec<PathBuf>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            if is_inbox_root && exclude.iter().any(|d| d == &name) {
                continue;
            }
            collect(&path, false, exclude, out);
        } else if name.ends_with(".md") && name != "README.md" {
            out.push(path);
        }
    }
}

/// Raw Markdown of one inbox note, for the preview pane.
pub fn read_note(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| format!("could not read {}: {e}", norm_path(path)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_vault(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "inbox-test-{tag}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        fs::create_dir_all(dir.join("inbox")).unwrap();
        dir
    }

    fn write(path: &Path, body: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, body).unwrap();
    }

    #[test]
    fn list_notes_applies_the_exclusion_rules() {
        let vault = temp_vault("exclusions");
        let inbox = vault.join("inbox");
        write(&inbox.join("a note.md"), "# a");
        write(&inbox.join("README.md"), "signage");
        write(&inbox.join("notes.txt"), "not markdown");
        write(&inbox.join("_wip").join("draft.md"), "# draft");
        write(&inbox.join("sub").join("nested.md"), "# nested");

        let notes = list_notes(&vault, &["_wip".to_string()], 7);
        let mut names: Vec<&str> = notes.iter().map(|n| n.name.as_str()).collect();
        names.sort();
        // README, non-markdown and the excluded hold folder are gone; a plain
        // subfolder is still part of the inbox.
        assert_eq!(names, vec!["a note", "nested"]);
        let nested = notes.iter().find(|n| n.name == "nested").unwrap();
        assert_eq!(nested.rel_path, "inbox/sub/nested.md");
        assert!(nested.path.ends_with("inbox/sub/nested.md"));

        let _ = fs::remove_dir_all(&vault);
    }

    #[test]
    fn list_notes_attaches_pending_proposals() {
        let vault = temp_vault("pending");
        write(&vault.join("inbox").join("srms.md"), "# srms");
        write(&vault.join("inbox").join("other.md"), "# other");
        write(
            &vault.join("_ai").join("memory").join("tidy-pending.json"),
            r#"{"task":"T-0061","pendingReview":1,"files":[
                {"path":"inbox/srms.md","reason":"redundant prefix","proposal":"projects/srms/dev-notes/"}
            ]}"#,
        );

        let notes = list_notes(&vault, &[], 7);
        let srms = notes.iter().find(|n| n.name == "srms").unwrap();
        let pending = srms.pending.as_ref().expect("proposal is surfaced");
        assert_eq!(pending.reason, "redundant prefix");
        assert_eq!(pending.proposal, "projects/srms/dev-notes/");
        assert!(notes
            .iter()
            .find(|n| n.name == "other")
            .unwrap()
            .pending
            .is_none());

        let _ = fs::remove_dir_all(&vault);
    }

    #[test]
    fn list_notes_flags_stale_and_ages() {
        let vault = temp_vault("stale");
        let fresh = vault.join("inbox").join("fresh.md");
        write(&fresh, "# fresh");
        let notes = list_notes(&vault, &[], 7);
        let note = &notes[0];
        assert!(!note.stale);
        assert_eq!(note.age_days, 0);
        // A zero threshold makes every dated note stale immediately.
        assert!(list_notes(&vault, &[], 0)[0].stale);

        let _ = fs::remove_dir_all(&vault);
    }

    #[test]
    fn missing_inbox_folder_lists_nothing() {
        let vault = std::env::temp_dir().join("inbox-test-absent");
        assert!(list_notes(&vault, &[], 7).is_empty());
    }

    #[test]
    fn pending_shields_only_unedited_listed_files() {
        let vault = temp_vault("shields");
        write(
            &vault.join("_ai").join("memory").join("tidy-pending.json"),
            r#"{"files":[{"path":"inbox/random idea.md","reason":"low confidence"}]}"#,
        );
        let pending = load_pending(&vault);
        assert!(pending.mtime > 0);
        assert_eq!(pending.len(), 1);
        // Same file arrived at via a component-wise identical path matches.
        let seen = vault.join("inbox").join("random idea.md");
        assert!(pending.shields(&seen, pending.mtime));
        // Edited after the deferral → no longer shielded.
        assert!(!pending.shields(&seen, pending.mtime + 1));
        // A different file is never shielded.
        assert!(!pending.shields(&vault.join("inbox").join("other.md"), 0));
        // A missing `proposal` reads as empty rather than dropping the entry.
        assert_eq!(pending.get(&seen).unwrap().proposal, "");

        let _ = fs::remove_dir_all(&vault);
    }

    #[test]
    fn load_pending_missing_file_is_empty() {
        let vault = std::env::temp_dir().join("inbox-pending-missing");
        let pending = load_pending(&vault);
        assert_eq!(pending.len(), 0);
        assert!(!pending.shields(&vault.join("inbox").join("a.md"), 0));
    }

    #[test]
    fn read_note_returns_body_and_reports_missing() {
        let vault = temp_vault("read");
        let path = vault.join("inbox").join("note.md");
        write(&path, "# hello\n");
        assert_eq!(read_note(&path).unwrap(), "# hello\n");
        assert!(read_note(&vault.join("inbox").join("nope.md")).is_err());

        let _ = fs::remove_dir_all(&vault);
    }
}
