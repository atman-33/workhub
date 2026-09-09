//! The Docs tab (T-0259): read-only browsing of Markdown that lives *outside*
//! the vault — typically a Google Drive share the team keeps its notes in.
//!
//! Why this exists at all, given Obsidian: opening a shared folder as an
//! Obsidian vault writes `.obsidian/` into it, and every member's workspace
//! state then fights over the same files. So the one invariant this module
//! must never break is **nothing is ever written into a document root** — no
//! index, no cache, no thumbnails. There is deliberately no write command in
//! here, and adding one is a design change, not a feature.
//!
//! Two consequences of the target being a network share, and Google Drive's
//! streaming mode in particular (files are placeholders until read, so a read
//! can go to the network):
//!
//! - **Nothing is walked recursively.** A directory is listed only when the
//!   user opens it. A whole-tree scan of a streamed share is a hang.
//! - **Every call is bounded by a timeout.** A stuck placeholder fetch must
//!   surface as an error in the tree, not as a frozen tab.
//!
//! There is no file watcher either — watching a network drive is unreliable
//! and expensive, so the tab refreshes on demand.
//!
//! ## The containment guard
//!
//! These commands take a path from the webview and read it, so every entry
//! point resolves that path against the *registered roots* read from the
//! config (never from the caller) and refuses anything outside them. Both
//! sides are canonicalized first, which is also what closes the symlink
//! escape. See `resolve_within_roots`.

use crate::b64;
use crate::models::{DocsRoot, Settings};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

/// How long any one filesystem call may take before the tab is told the share
/// is not answering. Generous, because a cold Drive placeholder is genuinely
/// slow; short enough that the UI never looks hung.
const TIMEOUT: Duration = Duration::from_secs(20);

/// Largest Markdown file rendered. Past this the preview says so rather than
/// pulling a huge file over the network into the webview.
const MAX_DOC_BYTES: u64 = 4 * 1024 * 1024;

/// Largest embedded image inlined as a data URI.
const MAX_ASSET_BYTES: u64 = 16 * 1024 * 1024;

/// One row in the tree: a folder, or a file.
#[derive(Clone, Debug, serde::Serialize)]
pub struct DocsEntry {
    /// Absolute path, forward slashes — the id the frontend passes back.
    pub path: String,
    /// File or folder name as it appears on disk, extension included.
    pub name: String,
    pub is_dir: bool,
    /// True for the files this tab can render itself. Everything else is
    /// listed too, but is opened in whatever the OS associates with it —
    /// a share holds PDFs and spreadsheets, and hiding them made the tree
    /// disagree with what the folder actually contains.
    pub is_markdown: bool,
    /// Last-modified time, unix seconds; 0 when unreadable.
    pub modified: u64,
}

/// A root as the tab renders it: the shared value, plus what it actually
/// resolves to on *this* machine and whether that place exists.
#[derive(Clone, Debug, serde::Serialize)]
pub struct DocsRootStatus {
    pub id: String,
    pub name: String,
    /// The path recorded in the vault — what the team agreed on.
    pub path: String,
    /// The path used on this machine (the override when there is one).
    pub effective_path: String,
    /// True when `effective_path` came from this machine's override map.
    pub overridden: bool,
    /// False when the folder is missing here — the tab offers to re-point it.
    pub available: bool,
}

/// Absolute path with forward slashes, so a path compares equal regardless of
/// which side produced it.
fn norm(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

fn mtime_secs(p: &Path) -> u64 {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Runs a blocking filesystem job with a wall-clock bound.
///
/// A timeout cannot cancel a blocked `read_dir`, so the worker thread is left
/// to finish and drop its result on its own. That is the point: the caller is
/// released, the UI reports a slow share, and the stuck thread does not take
/// the tab with it.
fn with_timeout<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(f());
    });
    match rx.recv_timeout(TIMEOUT) {
        Ok(result) => result,
        Err(_) => Err(format!(
            "the folder did not respond within {}s — the share may be offline or still syncing",
            TIMEOUT.as_secs()
        )),
    }
}

/// The path a root resolves to on this machine: its own `path`, unless this
/// machine records an override for its id.
pub fn effective_path(root: &DocsRoot, overrides: &HashMap<String, String>) -> String {
    match overrides.get(&root.id) {
        Some(p) if !p.trim().is_empty() => p.clone(),
        _ => root.path.clone(),
    }
}

/// Every root as the tab renders it, resolved against this machine.
pub fn root_statuses(settings: &Settings) -> Vec<DocsRootStatus> {
    settings
        .docs_roots
        .iter()
        .map(|root| {
            let resolved = effective_path(root, &settings.docs_root_paths);
            let overridden = resolved != root.path;
            let available = !resolved.trim().is_empty() && Path::new(&resolved).is_dir();
            DocsRootStatus {
                id: root.id.clone(),
                name: root.name.clone(),
                path: root.path.clone(),
                effective_path: resolved,
                overridden,
                available,
            }
        })
        .collect()
}

/// The next free `D-NNN` id for a new root. Ids are never reused, because a
/// machine-local override in `docs_root_paths` is keyed by one.
pub fn next_root_id(roots: &[DocsRoot]) -> String {
    let max = roots
        .iter()
        .filter_map(|r| r.id.strip_prefix("D-"))
        .filter_map(|n| n.parse::<u32>().ok())
        .max()
        .unwrap_or(0);
    format!("D-{:03}", max + 1)
}

/// Canonicalizes `target` and refuses it unless it sits inside one of `roots`.
///
/// Canonicalization is what makes this a real guard rather than a string
/// check: `..` segments are collapsed and symlinks are followed, so a link
/// inside a root that points outside it is rejected like any other outside
/// path. A root that cannot be canonicalized (an unmounted share) simply
/// contains nothing.
pub fn resolve_within_roots(target: &str, roots: &[String]) -> Result<PathBuf, String> {
    if target.trim().is_empty() {
        return Err("no path given".into());
    }
    let real = fs::canonicalize(target).map_err(|e| format!("{target}: {e}"))?;
    let inside = roots
        .iter()
        .filter(|r| !r.trim().is_empty())
        .filter_map(|r| fs::canonicalize(r).ok())
        .any(|root| real.starts_with(&root));
    if inside {
        Ok(real)
    } else {
        Err(format!(
            "{target} is outside every registered document root"
        ))
    }
}

/// The effective paths of all registered roots — the allow-list the guard is
/// evaluated against. Read from the config, never from the caller.
pub fn allowed_roots(settings: &Settings) -> Vec<String> {
    settings
        .docs_roots
        .iter()
        .map(|r| effective_path(r, &settings.docs_root_paths))
        .filter(|p| !p.trim().is_empty())
        .collect()
}

/// True for a name the tree hides: dot-entries (`.obsidian`, `.git`, and the
/// sync clients' own bookkeeping) and Windows' desktop.ini clutter.
fn hidden(name: &str) -> bool {
    name.starts_with('.') || name.eq_ignore_ascii_case("desktop.ini")
}

fn is_markdown(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".md") || lower.ends_with(".markdown")
}

/// Lists one directory: folders first, then files, each group by name.
///
/// Everything the folder holds is listed, not only Markdown — a team share
/// carries PDFs, spreadsheets and images, and a tree that showed none of them
/// disagreed with the folder the user was looking at. `is_markdown` says which
/// entries this tab can render; the rest are handed to the OS on click.
///
/// Never recurses: the tree asks again when a folder is opened.
pub fn list_dir(dir: &Path) -> Result<Vec<DocsEntry>, String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| format!("{}: {e}", dir.display()))? {
        let Ok(entry) = entry else { continue };
        let name = entry.file_name().to_string_lossy().to_string();
        if hidden(&name) {
            continue;
        }
        // `file_type` avoids a second stat per entry, which matters on a share.
        let Ok(ft) = entry.file_type() else { continue };
        let is_dir = ft.is_dir();
        let path = entry.path();
        out.push(DocsEntry {
            path: norm(&path),
            is_markdown: !is_dir && is_markdown(&name),
            name,
            is_dir,
            modified: if is_dir { 0 } else { mtime_secs(&path) },
        });
    }
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(out)
}

/// Reads a Markdown file as text.
pub fn read_doc(path: &Path) -> Result<String, String> {
    let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    if size > MAX_DOC_BYTES {
        return Err(format!(
            "file is {:.1} MB — too large to preview (limit {} MB)",
            size as f64 / 1_048_576.0,
            MAX_DOC_BYTES / 1_048_576
        ));
    }
    fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))
}

/// The `data:` URI media type for an embedded asset, by extension. `None` for
/// anything the preview will not inline.
fn media_type(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_string_lossy().to_ascii_lowercase();
    Some(match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        _ => return None,
    })
}

/// Reads an image referenced by a document and returns it as a `data:` URI.
///
/// Images go through the same guard as documents rather than through Tauri's
/// asset protocol: the protocol's scope is configured once at build time,
/// while the roots here are whatever the user registered, and the check has
/// to be against *those*.
pub fn read_asset(path: &Path) -> Result<String, String> {
    let media = media_type(path)
        .ok_or_else(|| format!("{}: not an image the preview can inline", path.display()))?;
    let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    if size > MAX_ASSET_BYTES {
        return Err(format!(
            "image is {:.1} MB — too large to inline (limit {} MB)",
            size as f64 / 1_048_576.0,
            MAX_ASSET_BYTES / 1_048_576
        ));
    }
    let bytes = fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(format!("data:{media};base64,{}", b64::encode(&bytes)))
}

// ---- guarded entry points -----------------------------------------------
// Each takes the settings (for the allow-list), applies the containment
// guard, and runs the filesystem work under the timeout.

pub fn guarded_list_dir(settings: &Settings, path: &str) -> Result<Vec<DocsEntry>, String> {
    let dir = resolve_within_roots(path, &allowed_roots(settings))?;
    with_timeout(move || list_dir(&dir))
}

pub fn guarded_read_doc(settings: &Settings, path: &str) -> Result<String, String> {
    let file = resolve_within_roots(path, &allowed_roots(settings))?;
    with_timeout(move || read_doc(&file))
}

/// Hands a file to whatever the OS associates with it.
///
/// This one launches another program, so the guard matters more here than
/// anywhere else in the module: only a path inside a registered root is ever
/// passed on, and a directory is refused — "open the folder" is what the
/// tree's own expand does, and Explorer is reachable from the preview header.
pub fn guarded_open_external(settings: &Settings, path: &str) -> Result<(), String> {
    let file = resolve_within_roots(path, &allowed_roots(settings))?;
    if file.is_dir() {
        return Err(format!("{} is a folder, not a file", file.display()));
    }
    tauri_plugin_opener::open_path(&file, None::<&str>).map_err(|e| e.to_string())
}

pub fn guarded_read_asset(settings: &Settings, path: &str) -> Result<String, String> {
    let file = resolve_within_roots(path, &allowed_roots(settings))?;
    with_timeout(move || read_asset(&file))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    /// A throwaway directory tree, removed on drop.
    struct TempTree(PathBuf);

    impl TempTree {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "workhub-docs-{tag}-{}-{:?}",
                std::process::id(),
                std::thread::current().id()
            ));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
        fn path(&self) -> &Path {
            &self.0
        }
        fn norm(&self) -> String {
            norm(&fs::canonicalize(&self.0).unwrap())
        }
    }

    impl Drop for TempTree {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn settings_with_roots(roots: Vec<DocsRoot>, overrides: HashMap<String, String>) -> Settings {
        Settings {
            docs_roots: roots,
            docs_root_paths: overrides,
            ..Settings::default()
        }
    }

    fn root(id: &str, path: &str) -> DocsRoot {
        DocsRoot {
            id: id.into(),
            name: String::new(),
            path: path.into(),
        }
    }

    #[test]
    fn lists_every_visible_entry_folders_first() {
        let tree = TempTree::new("list");
        fs::create_dir(tree.path().join("sub")).unwrap();
        fs::create_dir(tree.path().join(".obsidian")).unwrap();
        fs::write(tree.path().join("b.md"), "b").unwrap();
        fs::write(tree.path().join("A.markdown"), "a").unwrap();
        fs::write(tree.path().join("sheet.xlsx"), "x").unwrap();
        fs::write(tree.path().join("desktop.ini"), "x").unwrap();

        let entries = list_dir(tree.path()).unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        // `.obsidian` and desktop.ini stay hidden; the spreadsheet is listed
        // because the folder really contains it. Folders sort ahead of files,
        // and files sort case-insensitively — extensions and all.
        assert_eq!(names, vec!["sub", "A.markdown", "b.md", "sheet.xlsx"]);
    }

    #[test]
    fn only_markdown_is_flagged_as_renderable() {
        let tree = TempTree::new("kinds");
        fs::create_dir(tree.path().join("sub")).unwrap();
        fs::write(tree.path().join("a.md"), "a").unwrap();
        fs::write(tree.path().join("b.MARKDOWN"), "b").unwrap();
        fs::write(tree.path().join("c.pdf"), "c").unwrap();

        let flags: Vec<(String, bool, bool)> = list_dir(tree.path())
            .unwrap()
            .into_iter()
            .map(|e| (e.name, e.is_dir, e.is_markdown))
            .collect();
        assert_eq!(
            flags,
            vec![
                ("sub".to_string(), true, false),
                ("a.md".to_string(), false, true),
                ("b.MARKDOWN".to_string(), false, true),
                ("c.pdf".to_string(), false, false),
            ]
        );
    }

    #[test]
    fn guard_accepts_a_path_inside_a_registered_root() {
        let tree = TempTree::new("inside");
        fs::create_dir(tree.path().join("notes")).unwrap();
        let target = norm(&tree.path().join("notes"));
        let roots = vec![tree.norm()];
        assert!(resolve_within_roots(&target, &roots).is_ok());
    }

    #[test]
    fn guard_rejects_an_unregistered_root() {
        let tree = TempTree::new("unreg");
        let other = TempTree::new("unreg-other");
        fs::write(other.path().join("secret.md"), "s").unwrap();
        let target = norm(&other.path().join("secret.md"));
        let err = resolve_within_roots(&target, &[tree.norm()]).unwrap_err();
        assert!(
            err.contains("outside every registered document root"),
            "{err}"
        );
    }

    #[test]
    fn guard_rejects_a_dotdot_escape() {
        let tree = TempTree::new("escape");
        let inner = tree.path().join("root");
        fs::create_dir(&inner).unwrap();
        fs::write(tree.path().join("outside.md"), "o").unwrap();
        // A path that *starts* inside the root but climbs out of it: the
        // string prefix would pass, canonicalization is what catches it.
        let target = norm(&inner.join("..").join("outside.md"));
        let roots = vec![norm(&fs::canonicalize(&inner).unwrap())];
        assert!(resolve_within_roots(&target, &roots).is_err());
    }

    #[test]
    fn guard_rejects_an_empty_path_with_no_roots() {
        assert!(resolve_within_roots("", &[]).is_err());
        let tree = TempTree::new("noroots");
        let target = norm(tree.path());
        assert!(resolve_within_roots(&target, &[]).is_err());
    }

    #[test]
    fn machine_override_wins_over_the_vault_path() {
        let mut overrides = HashMap::new();
        overrides.insert("D-001".to_string(), "Z:/local/mount".to_string());
        let r = root("D-001", "G:/shared drives/team");
        assert_eq!(effective_path(&r, &overrides), "Z:/local/mount");
        // An empty override is not an override — it falls back to the vault
        // value rather than resolving to nothing.
        overrides.insert("D-001".to_string(), "  ".to_string());
        assert_eq!(effective_path(&r, &overrides), "G:/shared drives/team");
        assert_eq!(effective_path(&r, &HashMap::new()), "G:/shared drives/team");
    }

    #[test]
    fn root_status_reports_availability_and_override() {
        let tree = TempTree::new("status");
        let mut overrides = HashMap::new();
        overrides.insert("D-002".to_string(), norm(tree.path()));
        let settings = settings_with_roots(
            vec![
                root("D-001", "G:/nowhere/at/all"),
                root("D-002", "G:/shared drives/team"),
            ],
            overrides,
        );
        let statuses = root_statuses(&settings);
        assert!(!statuses[0].available);
        assert!(!statuses[0].overridden);
        assert!(statuses[1].available);
        assert!(statuses[1].overridden);
    }

    #[test]
    fn allowed_roots_follow_the_override() {
        let mut overrides = HashMap::new();
        overrides.insert("D-001".to_string(), "Z:/mount".to_string());
        let settings = settings_with_roots(vec![root("D-001", "G:/team")], overrides);
        assert_eq!(allowed_roots(&settings), vec!["Z:/mount".to_string()]);
    }

    #[test]
    fn root_ids_are_never_reused() {
        assert_eq!(next_root_id(&[]), "D-001");
        let roots = vec![root("D-001", "a"), root("D-007", "b")];
        assert_eq!(next_root_id(&roots), "D-008");
    }

    #[test]
    fn assets_are_inlined_by_extension_and_nothing_else() {
        let tree = TempTree::new("asset");
        let png = tree.path().join("a.png");
        // The 1x1 GIF header is enough — only the encoding is under test.
        fs::write(&png, [0x89u8, 0x50, 0x4E, 0x47]).unwrap();
        let uri = read_asset(&png).unwrap();
        assert!(uri.starts_with("data:image/png;base64,"), "{uri}");

        let exe = tree.path().join("a.exe");
        fs::write(&exe, [0u8; 4]).unwrap();
        assert!(read_asset(&exe).is_err());
    }

    #[test]
    fn oversized_documents_are_refused_rather_than_streamed() {
        let tree = TempTree::new("big");
        let big = tree.path().join("big.md");
        fs::write(&big, vec![b'x'; (MAX_DOC_BYTES + 1) as usize]).unwrap();
        let err = read_doc(&big).unwrap_err();
        assert!(err.contains("too large"), "{err}");
    }
}
