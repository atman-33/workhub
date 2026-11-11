//! The vault file watcher: debounces filesystem events under `tasks/`,
//! `projects/` and the vault root into one Tauri event per affected area
//! (`tasks-changed`, `schedules-changed`, `mindmaps-changed`,
//! `diagrams-changed`, `projects-changed`).
//!
//! This is vault-wide change notification, not task-specific code: tasks are
//! one of the areas it reports. It was split out of `tasks.rs` (T-1220) with
//! no change in behaviour.

use crate::tasks::{migrate_archived_layout, regenerate_index, tasks_dir};
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::RecvTimeoutError;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const TASKS_CHANGED_EVENT: &str = "tasks-changed";
/// Emitted when a `projects/*/schedules/*.md` file changes, so the Schedule
/// view reloads after an Obsidian or agent edit (T-0088).
const SCHEDULES_CHANGED_EVENT: &str = "schedules-changed";
/// Emitted when a `projects/*/mindmaps/*.md` file changes, so the Mindmap
/// view reloads after an Obsidian or agent edit (T-0188).
const MINDMAPS_CHANGED_EVENT: &str = "mindmaps-changed";

/// Emitted when any `.md` under `projects/` changes, so the Diagrams tab can
/// refresh its list. A diagram can sit anywhere in a project (T-0680), so this
/// is deliberately broader than the two events above.
const DIAGRAMS_CHANGED_EVENT: &str = "diagrams-changed";
/// Emitted when a project folder appears under or disappears from `projects/`,
/// so every project picker in the app reloads (T-0190). Without it the pickers
/// were read once at mount and never again: a project created in the Projects
/// tab, in Obsidian, or by an agent stayed invisible until the app restarted,
/// and an archived one stayed selectable after its folder had moved to
/// `archive/projects/`.
const PROJECTS_CHANGED_EVENT: &str = "projects-changed";
const DEBOUNCE: Duration = Duration::from_millis(300);

/// Holds the live watcher so it isn't dropped (which would stop watching).
/// Managed as Tauri app state; replacing the contents drops the previous
/// watcher, which closes its event channel and lets the old debounce thread
/// exit cleanly.
pub struct WatcherState(pub Mutex<Option<RecommendedWatcher>>);

impl Default for WatcherState {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

/// True for a path under `projects/<slug>/<folder>/` ending in `.md`.
///
/// `projects/` as a whole is a human writing area with far more churn than
/// `tasks/`, so the watcher subscribes to the tree but only *reports* the note
/// kinds a view is showing — otherwise every note edit in Obsidian would
/// round-trip a reload through the Schedule and Mindmap views (schedule design
/// note §10.4).
/// True for `projects/<slug>` itself — the creation, removal or rename of a
/// project folder.
///
/// Matched on the *parent* rather than on depth so that only the top level
/// counts: `projects/<slug>/backlog` is a folder inside a project, not a project.
/// These paths currently fall through every arm of the watcher's classifier and
/// are discarded, so reporting them adds no reload that was not wanted.
fn is_project_dir_path(p: &Path, projects_root: &Path) -> bool {
    p.parent() == Some(projects_root)
}

/// Starts (or restarts) watching `<vault>/tasks` and `<vault>/projects` for
/// changes, debouncing bursts of events (e.g. an editor's
/// save-as-temp-then-rename) into a single emit per affected area:
/// `tasks-changed` for the task tree, `schedules-changed` for schedule notes,
/// `mindmaps-changed` for mindmap notes.
/// Any per-event error from `notify` (a transient OS/FS hiccup) is treated as
/// "the tasks changed" rather than killing the loop, so the watcher stays
/// alive for the app's lifetime.
pub fn start_watcher(
    app: AppHandle,
    state: &Mutex<Option<RecommendedWatcher>>,
    vault: PathBuf,
) -> Result<(), String> {
    let dir = tasks_dir(&vault);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // Heal the archived-task layout once per vault load, before the index is
    // (re)generated below, so existing vaults migrate without a manual step.
    let _ = migrate_archived_layout(&vault);

    let (tx, rx) = std::sync::mpsc::channel::<Result<Event, notify::Error>>();
    let mut watcher = notify::recommended_watcher(tx).map_err(|e| e.to_string())?;
    // Recursive so moves into/out of `tasks/archive/` (and edits inside it)
    // are picked up, including the subfolder being created after this point.
    watcher
        .watch(&dir, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    // Schedule notes live under `projects/<slug>/schedules/`. A vault that has
    // no `projects/` yet is not an error — the folder appears when the user
    // creates their first project, and the watcher is restarted on vault load.
    let projects = vault.join("projects");
    if projects.is_dir() {
        let _ = watcher.watch(&projects, RecursiveMode::Recursive);
    }
    // The vault root itself is watched non-recursively so the *creation* of
    // `projects/` is noticed too: with no `projects/` dir there is nothing to
    // watch yet, and the first project made elsewhere (another window,
    // Obsidian, an agent) otherwise leaves every picker empty until the next
    // vault load (T-0343). One level only — everything deeper is covered by
    // the watches above.
    let _ = watcher.watch(&vault, RecursiveMode::NonRecursive);

    let vault_for_thread = vault.clone();
    std::thread::spawn(move || loop {
        // Block for the first event of a new burst.
        let mut tasks_touched = false;
        let mut schedules_touched = false;
        let mut mindmaps_touched = false;
        let mut diagrams_touched = false;
        let mut projects_touched = false;
        let mut classify = |ev: &Result<Event, notify::Error>| match ev {
            Ok(event) => {
                for path in &event.paths {
                    if path == &projects {
                        // `projects/` itself appeared or was removed.
                        projects_touched = true;
                    } else if is_project_dir_path(path, &projects) {
                        projects_touched = true;
                    } else if path.starts_with(&projects)
                        && path.extension().and_then(|e| e.to_str()) == Some("md")
                    {
                        // A diagram may be anywhere in a project, so any note
                        // there can be one. The open Schedule and Mindmap
                        // editors re-read their file on these events and skip
                        // it when its mtime is unchanged, so firing them for
                        // every note is cheap (T-0680).
                        diagrams_touched = true;
                        schedules_touched = true;
                        mindmaps_touched = true;
                    } else if !path.starts_with(&projects) {
                        tasks_touched = true;
                    }
                }
            }
            // An unreadable event could have been anything; assume the tasks
            // moved (the cheaper, self-healing direction).
            Err(_) => tasks_touched = true,
        };

        match rx.recv() {
            Ok(ev) => classify(&ev),
            Err(_) => break, // watcher dropped: channel closed, thread exits
        }
        // Drain further events within the debounce window.
        loop {
            match rx.recv_timeout(DEBOUNCE) {
                Ok(ev) => classify(&ev),
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
        if tasks_touched {
            let _ = regenerate_index(&vault_for_thread);
            let _ = app.emit(TASKS_CHANGED_EVENT, ());
        }
        if schedules_touched {
            let _ = app.emit(SCHEDULES_CHANGED_EVENT, ());
        }
        if mindmaps_touched {
            let _ = app.emit(MINDMAPS_CHANGED_EVENT, ());
        }
        if diagrams_touched {
            let _ = app.emit(DIAGRAMS_CHANGED_EVENT, ());
        }
        if projects_touched {
            let _ = app.emit(PROJECTS_CHANGED_EVENT, ());
        }
    });

    let mut guard = state
        .lock()
        .map_err(|_| "watcher state poisoned".to_string())?;
    *guard = Some(watcher);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_top_level_of_projects_counts_as_a_project_folder() {
        let projects = PathBuf::from("C:/vault/projects");
        assert!(is_project_dir_path(&projects.join("demo"), &projects));
        // Inside a project: a subfolder, and a note the note-kind arms own.
        assert!(!is_project_dir_path(
            &projects.join("demo/backlog"),
            &projects
        ));
        assert!(!is_project_dir_path(
            &projects.join("demo/schedules/a.md"),
            &projects
        ));
        // Outside it entirely.
        assert!(!is_project_dir_path(
            &PathBuf::from("C:/vault/tasks/T-0001 a.md"),
            &projects
        ));
    }
}
