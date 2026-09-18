//! Breaking-change notices (T-0377).
//!
//! Some releases change the shape of the vault, and an existing vault does not
//! move with them. The failure that follows is silent by construction: the
//! agent hooks gate on a path and exit 0 when it is missing, so the symptom is
//! an agent that has forgotten who the owner is rather than an error anyone
//! can see. T-0374 moved `profile/` to `memory/identity/` exactly this way.
//!
//! A notice is data, not code. The next such change is one entry in
//! `notices.json`; writing React for each one would come apart on the second.
//!
//! ## Why a notice fires on the vault's shape, not on a version
//!
//! The obvious trigger — "you just updated past the release that broke this" —
//! cannot work, and would have missed its own first case. The banner ships in
//! the release *after* the one that changed the layout, so by the time the
//! code exists the update it would have watched for is already in the past.
//! A vault that jumps several versions at once has no observable path either.
//!
//! So a notice declares the *shape that needs fixing* and the app looks for
//! it. That is version-independent, it is still true weeks later, and it stops
//! being true the moment the migration runs — including on the second machine,
//! which never saw the first one do it.
//!
//! `requires` remains, with a different job: it is not what makes a notice
//! appear but what makes it *actionable*. The migration lives in a plugin
//! skill, and pointing someone at a skill their installed plugin does not
//! carry is worse than saying nothing.
//!
//! ## Why the condition is only ever "the old thing is still here"
//!
//! The first draft of this also carried a `path_missing` list, so a notice
//! could say "…and the new thing has not arrived". Written out for the first
//! notice it reads perfectly — `profile/decision-policy.md` exists,
//! `memory/identity/decision-policy.md` does not — and it is wrong.
//!
//! The template seeds missing files without asking, so a vault that updates
//! the app before migrating ends up with a blank `memory/identity/` note
//! beside the owner's real one in `profile/`. That is the case that loses
//! content, and `path_missing` would have switched the warning off for
//! precisely it. The surviving rule is simpler and safer: **the old path
//! still being there is the whole condition**, because a finished migration
//! is one that moved it.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

/// Bundled into the binary for the same reason `vault-template/` is: there is
/// no second distribution channel, and a notice that arrives separately from
/// the change it describes arrives at the wrong time.
const NOTICES_JSON: &str = include_str!("notices.json");

/// The shape a vault has to be in for a notice to apply.
///
/// One flat list, not an expression language. See the module docs for why it
/// is only ever about paths that should have gone.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct When {
    /// Vault-relative paths that must **all** still be present. Each one is
    /// something the migration moves, so their survival is the evidence.
    #[serde(default)]
    pub path_exists: Vec<String>,
}

impl When {
    /// A notice with no conditions applies to nothing. An empty `when` is far
    /// more likely to be an unfinished entry than a deliberate "always", and
    /// the harmless reading of a mistake is the one to take.
    fn matches(&self, vault: &Path) -> bool {
        !self.path_exists.is_empty() && self.path_exists.iter().all(|p| vault.join(p).exists())
    }
}

/// What has to be installed before the notice's action can be carried out.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Requires {
    /// Plugin name → minimum version. Compared in the frontend, which already
    /// reads plugin state for its own banner; a second comparison here would
    /// mean two answers to one question.
    #[serde(default)]
    pub plugin: BTreeMap<String, String>,
}

/// The task this notice offers to file.
///
/// A task rather than a copied prompt, because workhub is a task board: the
/// launch prompt, model choice, worktree, `## Results` and status all come for
/// free, and afterwards there is a record of whether the migration actually
/// happened. A prompt pasted into a terminal leaves nothing behind.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoticeAction {
    pub title: String,
    /// Markdown, written into the task's `## Description`.
    pub body: String,
    /// Vault project slug the task is filed under; empty for none.
    #[serde(default)]
    pub project: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notice {
    pub id: String,
    /// The release that introduced the change. Shown, never used to decide
    /// whether the notice applies — see the module docs.
    pub since: String,
    /// `breaking` notices come back every launch until they are marked read;
    /// anything else may simply be dismissed.
    pub severity: String,
    pub title: String,
    /// One line, for the banner itself.
    pub summary: String,
    /// Markdown, for the detail dialog.
    pub body: String,
    #[serde(default)]
    pub when: When,
    #[serde(default)]
    pub requires: Requires,
    pub action: NoticeAction,
}

/// Every notice this build carries.
///
/// A malformed file is a build-time mistake, not a runtime condition the user
/// can act on, so it fails loudly in tests (`notices_json_parses…`) and
/// degrades to "no notices" in the app rather than breaking startup.
pub fn all() -> Vec<Notice> {
    serde_json::from_str(NOTICES_JSON).unwrap_or_default()
}

/// Notices that apply to this vault and have not been marked read.
pub fn pending(vault: &Path, read: &[String]) -> Vec<Notice> {
    all()
        .into_iter()
        .filter(|n| !read.iter().any(|id| id == &n.id))
        .filter(|n| n.when.matches(vault))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_vault(tag: &str, paths: &[&str]) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("workhub-notices-{tag}-{nanos}"));
        for p in paths {
            let path = dir.join(p);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, "x").unwrap();
        }
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn notices_json_parses_and_every_entry_can_fire() {
        let notices: Vec<Notice> =
            serde_json::from_str(NOTICES_JSON).expect("notices.json must parse");
        for n in &notices {
            assert!(!n.id.is_empty(), "a notice needs an id");
            assert!(
                !n.when.path_exists.is_empty(),
                "{}: a notice with no `when` can never fire",
                n.id
            );
            assert!(!n.action.title.is_empty(), "{}: action needs a title", n.id);
        }
    }

    #[test]
    fn applies_while_the_old_shape_is_still_there() {
        let vault = temp_vault("old", &["profile/decision-policy.md"]);
        assert_eq!(pending(&vault, &[]).len(), 1);
    }

    #[test]
    fn stops_applying_once_the_migration_has_run() {
        // The whole point of keying on shape: no version was consulted, and a
        // second machine gets the same answer without being told anything.
        let vault = temp_vault("migrated", &["memory/identity/decision-policy.md"]);
        assert!(pending(&vault, &[]).is_empty());
    }

    #[test]
    fn still_warns_when_the_template_seeded_a_blank_note_beside_the_real_one() {
        // The case that loses content, and the one a `path_missing` condition
        // on the new path would have silenced. See the module docs.
        let vault = temp_vault(
            "half",
            &[
                "profile/decision-policy.md",
                "memory/identity/decision-policy.md",
            ],
        );
        assert_eq!(pending(&vault, &[]).len(), 1);
    }

    #[test]
    fn a_read_notice_stays_gone() {
        let vault = temp_vault("read", &["profile/decision-policy.md"]);
        let ids: Vec<String> = pending(&vault, &[]).iter().map(|n| n.id.clone()).collect();
        assert!(!ids.is_empty());
        assert!(pending(&vault, &ids).is_empty());
    }

    #[test]
    fn an_empty_when_never_fires() {
        let vault = temp_vault("empty", &["anything.md"]);
        assert!(!When::default().matches(&vault));
    }
}
