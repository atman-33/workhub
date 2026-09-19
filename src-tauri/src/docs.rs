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
//!   user opens it. A whole-tree scan of a streamed share is a hang. The one
//!   exception is the pasted-path search (T-0395), which runs only when the
//!   user asked for one path and nothing cheaper found it, and is bounded by
//!   an entry count and a time budget - see `search_roots`.
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
use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant};

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
    /// True for HTML files, which the tab also renders itself — statically,
    /// in a sandboxed frame with scripts off (T-0271).
    pub is_html: bool,
    /// True for plain-text files the tab shows verbatim — JSON, YAML, CSV,
    /// logs and the like (T-0294). Nothing is parsed or highlighted: they are
    /// text the reader wants to glance at, and sending a ten-line file to
    /// another application to read it was the whole complaint. The default
    /// app is still one click away when the raw form is not enough.
    pub is_text: bool,
    /// Last-modified time, unix seconds; 0 when unreadable.
    pub modified: u64,
}

/// A root as the tab renders it: what was registered, plus whether it is
/// actually there.
#[derive(Clone, Debug, serde::Serialize)]
pub struct DocsRootStatus {
    pub id: String,
    pub name: String,
    /// The registered folder, recorded in the vault.
    pub path: String,
    /// False when the folder is missing on this machine — the tab says so and
    /// offers to edit the path.
    pub available: bool,
}

/// Absolute path with forward slashes, so a path compares equal regardless of
/// which side produced it.
///
/// The Win32 verbatim prefix is dropped on the way: `fs::canonicalize` (which
/// the guard runs on every path) returns `\\?\G:\...` and `\\?\UNC\server\...`,
/// and every entry listed under such a directory inherits it. Left in, it
/// reached the preview header and "Copy path", and the frontend's path
/// helpers read `//?/` as a UNC server named `?`.
fn norm(p: &Path) -> String {
    let raw = p.to_string_lossy();
    let plain = if let Some(rest) = raw.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = raw.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        raw.into_owned()
    };
    plain.replace('\\', "/")
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

/// Every root as the tab renders it, checked against this machine.
pub fn root_statuses(settings: &Settings) -> Vec<DocsRootStatus> {
    settings
        .docs_roots
        .iter()
        .map(|root| DocsRootStatus {
            id: root.id.clone(),
            name: root.name.clone(),
            available: !root.path.trim().is_empty() && Path::new(&root.path).is_dir(),
            path: root.path.clone(),
        })
        .collect()
}

/// The next free `D-NNN` id for a new root. Ids are never reused: the id is
/// how a root is addressed from the frontend across an edit that changes both
/// its name and its path.
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

/// The paths of all registered roots — the allow-list the guard is evaluated
/// against. Read from the config, never from the caller.
pub fn allowed_roots(settings: &Settings) -> Vec<String> {
    settings
        .docs_roots
        .iter()
        .map(|r| r.path.clone())
        .filter(|p| !p.trim().is_empty())
        .collect()
}

/// True for a name the tree hides: Windows' desktop.ini clutter always, and
/// dot-entries (`.obsidian`, `.git`, and the sync clients' own bookkeeping)
/// unless the reader asked to see them (T-0394) - a `.backup` folder is
/// sometimes exactly what they are looking for.
fn hidden(name: &str, show_dot_entries: bool) -> bool {
    name.eq_ignore_ascii_case("desktop.ini") || (!show_dot_entries && name.starts_with('.'))
}

fn is_markdown(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".md") || lower.ends_with(".markdown")
}

fn is_html(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".html") || lower.ends_with(".htm")
}

/// Extensions shown as plain text in the preview (T-0294).
///
/// An allow-list rather than a guess at the bytes: reading a file to decide
/// whether it is text would mean a network read per row of the tree, and the
/// tab's whole design is that a listing costs one `read_dir` and nothing more.
/// Markdown and HTML are absent on purpose — they have renderers of their own.
const TEXT_EXTENSIONS: &[&str] = &[
    "txt", "text", "log", "json", "jsonc", "yaml", "yml", "toml", "ini", "cfg", "conf", "csv",
    "tsv", "xml",
];

fn is_text(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    // A name that is all extension (`.gitignore`) has no extension at all,
    // the way the frontend's `previewKindForPath` reads it too; it is handed
    // to the OS like any other unknown kind.
    match lower.rsplit_once('.') {
        Some((stem, ext)) => !stem.is_empty() && TEXT_EXTENSIONS.contains(&ext),
        None => false,
    }
}

/// Lists one directory: folders first, then files, each group by name.
///
/// Everything the folder holds is listed, not only Markdown — a team share
/// carries PDFs, spreadsheets and images, and a tree that showed none of them
/// disagreed with the folder the user was looking at. `is_markdown` and
/// `is_html` say which entries this tab can render; the rest are handed to the
/// OS on click. `is_text` joins them for the plain-text kinds (T-0294).
///
/// Never recurses: the tree asks again when a folder is opened.
///
/// `show_dot_entries` is the `docs_show_hidden` setting (T-0394).
pub fn list_dir(dir: &Path, show_dot_entries: bool) -> Result<Vec<DocsEntry>, String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| format!("{}: {e}", dir.display()))? {
        let Ok(entry) = entry else { continue };
        let name = entry.file_name().to_string_lossy().to_string();
        if hidden(&name, show_dot_entries) {
            continue;
        }
        // `file_type` avoids a second stat per entry, which matters on a share.
        let Ok(ft) = entry.file_type() else { continue };
        let is_dir = ft.is_dir();
        let path = entry.path();
        out.push(DocsEntry {
            path: norm(&path),
            is_markdown: !is_dir && is_markdown(&name),
            is_html: !is_dir && is_html(&name),
            is_text: !is_dir && is_text(&name),
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

/// Reads a document (Markdown, HTML, or one of the plain-text kinds) as text.
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
    let show_dot_entries = settings.docs_show_hidden;
    with_timeout(move || list_dir(&dir, show_dot_entries))
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

/// Shows a file or folder in the OS file manager, selected in its parent.
///
/// `explorer <path>` is not this: handed a file, Explorer *opens* it with the
/// associated app, which is what "Open with default app" already does. The
/// opener plugin's reveal passes `/select` properly.
pub fn guarded_reveal(settings: &Settings, path: &str) -> Result<(), String> {
    let target = resolve_within_roots(path, &allowed_roots(settings))?;
    tauri_plugin_opener::reveal_item_in_dir(&target).map_err(|e| e.to_string())
}

pub fn guarded_read_asset(settings: &Settings, path: &str) -> Result<String, String> {
    let file = resolve_within_roots(path, &allowed_roots(settings))?;
    with_timeout(move || read_asset(&file))
}

/// One candidate when the Docs tab resolves a pasted path (T-0362): a file or
/// folder the pasted text could have meant, already inside a registered root.
#[derive(Clone, Debug, serde::Serialize)]
pub struct OpenPathMatch {
    /// Absolute path, forward slashes — the id the frontend passes back.
    pub path: String,
    pub is_dir: bool,
}

/// How a pasted path resolved (T-0362).
#[derive(Clone, Debug, serde::Serialize)]
pub struct OpenPathResolution {
    /// True when the pasted path itself sits inside a registered root — the
    /// team's mounts agree, and no guessing happened.
    pub direct: bool,
    /// Candidates, longest tail first.
    pub matches: Vec<OpenPathMatch>,
    /// True when the candidates came from walking the roots (T-0395) rather
    /// than from joining a tail onto one: the folders on the way differ from
    /// the pasted path's, and the tab says so.
    pub searched: bool,
}

/// Most filesystem probes one resolution may make. Each tail length is tried
/// against every root, so a deep path on many roots is bounded here rather
/// than by the share's patience.
const MAX_OPEN_PATH_PROBES: usize = 48;

/// Most entries the search fallback (T-0395) looks at, across every root. A
/// team share runs to a few thousand entries; past this the pasted path is
/// the better tool, and the error says to paste a longer one.
const MAX_SEARCH_ENTRIES: usize = 20_000;

/// How long the search fallback walks before answering with what it has.
/// Well inside `TIMEOUT`, so a search cut short still reports what it found
/// instead of being overtaken by the generic "did not respond".
const SEARCH_TIME_BUDGET: Duration = Duration::from_secs(12);

/// A pasted path as the resolver sees it: trimmed, unquoted, forward slashes,
/// no `file://` scheme, no trailing separator.
fn clean_pasted_path(raw: &str) -> String {
    let mut text = raw.trim().to_string();
    // Chat clients love to wrap a path in quotes; a pasted quote is never part
    // of a name on this tab's platforms.
    if text.len() >= 2 {
        let bytes = text.as_bytes();
        let (first, last) = (bytes[0], bytes[bytes.len() - 1]);
        if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
            text = text[1..text.len() - 1].to_string();
        }
    }
    let text = text.trim();
    let without_scheme = text
        .strip_prefix("file:///")
        .or_else(|| text.strip_prefix("file://"))
        .unwrap_or(text);
    let slashed = without_scheme.replace('\\', "/");
    let trimmed = slashed.trim_end_matches('/');
    // A bare drive root ("G:/") keeps its slash - "G:" alone is not a folder.
    if trimmed.ends_with(':') {
        format!("{trimmed}/")
    } else {
        trimmed.to_string()
    }
}

/// The trailing segments of a cleaned path that may name a file inside this
/// machine's roots. Empties and `.` carry nothing, `..` is collapsed the way
/// the sender's machine would have read it, and a leading drive letter (`G:`)
/// names the sender's mount rather than the file.
fn portable_tail(cleaned: &str) -> Vec<&str> {
    let mut out: Vec<&str> = Vec::new();
    for segment in cleaned.split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." {
            out.pop();
            continue;
        }
        if out.is_empty() && segment.len() == 2 && segment.as_bytes()[1] == b':' {
            continue;
        }
        out.push(segment);
    }
    out
}

/// Resolves a pasted absolute path against this machine's roots (T-0362).
///
/// A teammate's `G:\team\docs\a.md` is this machine's `H:\team\docs\a.md`, or
/// nothing at all — an absolute path only names a file on the machine that
/// wrote it. So the pasted text is tried directly first (the mounts agree),
/// then by ever-shorter tails against every root (they do not). Matches come
/// back longest tail first; same-length matches from several roots all come
/// back, and the frontend asks rather than guesses.
///
/// When no tail lands, the roots are searched for the pasted name instead
/// (T-0395): a teammate's share may be laid out differently on the way down
/// (`docs/a.md` there, `2026/docs/a.md` here), and a tail joined onto a root
/// can never find that. Roots are searched in the order given, so the caller
/// puts the one being read first; dot-entries follow `show_dot_entries`.
pub fn resolve_open_path(
    pasted: &str,
    roots: &[String],
    show_dot_entries: bool,
) -> Result<OpenPathResolution, String> {
    let cleaned = clean_pasted_path(pasted);
    if cleaned.is_empty() {
        return Err("no path given".into());
    }
    // The mounts agree: the pasted path names a file on this machine too.
    if let Ok(real) = resolve_within_roots(&cleaned, roots) {
        return Ok(OpenPathResolution {
            direct: true,
            matches: vec![OpenPathMatch {
                path: norm(&real),
                is_dir: real.is_dir(),
            }],
            searched: false,
        });
    }
    // They do not: walk the tail down until something lands inside a root.
    let tail = portable_tail(&cleaned);
    if tail.is_empty() {
        return Err(format!(
            "{pasted} matches nothing under the registered document roots"
        ));
    }
    let canonical_roots: Vec<PathBuf> = roots
        .iter()
        .filter(|r| !r.trim().is_empty())
        .filter_map(|r| fs::canonicalize(r).ok())
        .collect();
    let mut matches: Vec<OpenPathMatch> = Vec::new();
    let mut probes = 0;
    'lengths: for len in (1..=tail.len()).rev() {
        let suffix = tail[tail.len() - len..].join("/");
        for root in &canonical_roots {
            probes += 1;
            if probes > MAX_OPEN_PATH_PROBES {
                break 'lengths;
            }
            let Ok(real) = fs::canonicalize(root.join(&suffix)) else {
                continue;
            };
            // Joined from the root, but a symlink inside it may still point
            // out — the same escape the main guard exists for.
            if !real.starts_with(root) {
                continue;
            }
            let path = norm(&real);
            if !matches.iter().any(|m| m.path == path) {
                matches.push(OpenPathMatch {
                    path,
                    is_dir: real.is_dir(),
                });
            }
        }
        // The longest tail that lands anywhere wins; shorter ones only add
        // same-named files from elsewhere.
        if !matches.is_empty() {
            break;
        }
    }
    let searched = matches.is_empty();
    let mut truncated = false;
    if searched {
        (matches, truncated) = search_roots(&tail, &canonical_roots, show_dot_entries);
    }
    if matches.is_empty() {
        return Err(if truncated {
            format!(
                "{pasted} was not found - the search of the document roots stopped after \
                 {MAX_SEARCH_ENTRIES} entries or {}s; paste a longer path",
                SEARCH_TIME_BUDGET.as_secs()
            )
        } else {
            format!(
                "{pasted} matches nothing under the registered document roots - \
                 a file outside them cannot be opened here"
            )
        });
    }
    Ok(OpenPathResolution {
        direct: false,
        matches,
        searched,
    })
}

/// The search fallback (T-0395): walks `roots` breadth-first for entries named
/// like the pasted path's last segment, and keeps the ones that share the most
/// trailing segments with it - so `share/docs/a.md` prefers `2026/docs/a.md`
/// over an unrelated `old/a.md`. The second value is true when the walk ran
/// out of budget first, which is worth telling the reader.
///
/// Names compare ASCII-case-insensitively, as the Windows filesystems these
/// shares live on do. Links are not followed: one could lead out of the root
/// or round in a loop, and the guard would refuse what it found anyway.
fn search_roots(
    tail: &[&str],
    roots: &[PathBuf],
    show_dot_entries: bool,
) -> (Vec<OpenPathMatch>, bool) {
    let Some(name) = tail.last() else {
        return (Vec::new(), false);
    };
    let started = Instant::now();
    let mut seen = 0usize;
    let mut best = 0usize;
    let mut found: Vec<OpenPathMatch> = Vec::new();
    for root in roots {
        let mut queue = VecDeque::from([root.clone()]);
        while let Some(dir) = queue.pop_front() {
            let Ok(read) = fs::read_dir(&dir) else {
                continue;
            };
            for entry in read.flatten() {
                seen += 1;
                if seen > MAX_SEARCH_ENTRIES || started.elapsed() > SEARCH_TIME_BUDGET {
                    return (found, true);
                }
                let entry_name = entry.file_name().to_string_lossy().to_string();
                if hidden(&entry_name, show_dot_entries) {
                    continue;
                }
                let Ok(ft) = entry.file_type() else { continue };
                if ft.is_symlink() {
                    continue;
                }
                let path = entry.path();
                if entry_name.eq_ignore_ascii_case(name) {
                    let score = shared_tail(root, &path, tail);
                    if score > best {
                        best = score;
                        found.clear();
                    }
                    if score == best {
                        found.push(OpenPathMatch {
                            path: norm(&path),
                            is_dir: ft.is_dir(),
                        });
                    }
                }
                if ft.is_dir() {
                    queue.push_back(path);
                }
            }
        }
    }
    (found, false)
}

/// How many trailing segments `path` (inside `root`) shares with `tail`.
fn shared_tail(root: &Path, path: &Path, tail: &[&str]) -> usize {
    let Ok(rel) = path.strip_prefix(root) else {
        return 0;
    };
    let segments: Vec<String> = rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect();
    segments
        .iter()
        .rev()
        .zip(tail.iter().rev())
        .take_while(|(have, want)| have.eq_ignore_ascii_case(want))
        .count()
}

/// `current_root` is the root the tab is showing: its folders are searched
/// first (T-0395), since that is where the reader expects the file to be.
pub fn guarded_resolve_open_path(
    settings: &Settings,
    pasted: &str,
    current_root: &str,
) -> Result<OpenPathResolution, String> {
    let mut roots = allowed_roots(settings);
    if let Some(i) = roots.iter().position(|r| r == current_root) {
        let first = roots.remove(i);
        roots.insert(0, first);
    }
    let pasted = pasted.to_string();
    let show_dot_entries = settings.docs_show_hidden;
    with_timeout(move || resolve_open_path(&pasted, &roots, show_dot_entries))
}

#[cfg(test)]
mod tests {
    use super::*;

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
            // Canonicalize once: TEMP may use 8.3 short names (RUNNER~1 on
            // CI), while the resolver canonicalizes everything it touches.
            // Comparing a raw join against a canonicalized result then fails
            // on the user dir alone (T-0362 CI failure).
            let dir = fs::canonicalize(&dir).unwrap();
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

    fn settings_with_roots(roots: Vec<DocsRoot>) -> Settings {
        Settings {
            docs_roots: roots,
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
    fn norm_drops_the_verbatim_prefix() {
        assert_eq!(norm(Path::new(r"\\?\G:\docs\a.md")), "G:/docs/a.md");
        assert_eq!(
            norm(Path::new(r"\\?\UNC\server\share\a.md")),
            "//server/share/a.md"
        );
        assert_eq!(norm(Path::new(r"C:\docs\a.md")), "C:/docs/a.md");
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

        let entries = list_dir(tree.path(), false).unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        // `.obsidian` and desktop.ini stay hidden; the spreadsheet is listed
        // because the folder really contains it. Folders sort ahead of files,
        // and files sort case-insensitively — extensions and all.
        assert_eq!(names, vec!["sub", "A.markdown", "b.md", "sheet.xlsx"]);
    }

    #[test]
    fn dot_entries_are_listed_when_asked_for_but_desktop_ini_never_is() {
        let tree = TempTree::new("list-hidden");
        fs::create_dir(tree.path().join(".backup")).unwrap();
        fs::create_dir(tree.path().join("sub")).unwrap();
        fs::write(tree.path().join(".gitignore"), "x").unwrap();
        fs::write(tree.path().join("a.md"), "a").unwrap();
        fs::write(tree.path().join("desktop.ini"), "x").unwrap();

        let names = |show: bool| -> Vec<String> {
            list_dir(tree.path(), show)
                .unwrap()
                .into_iter()
                .map(|e| e.name)
                .collect()
        };
        assert_eq!(names(true), vec![".backup", "sub", ".gitignore", "a.md"]);
        assert_eq!(names(false), vec!["sub", "a.md"]);
    }

    #[test]
    fn a_dotfile_is_not_mistaken_for_its_extension() {
        // `.json` is a name, not a JSON file with no stem.
        assert!(!is_text(".json"));
        assert!(is_text("a.json"));
    }

    #[test]
    fn each_file_is_flagged_with_the_renderer_that_can_show_it() {
        let tree = TempTree::new("kinds");
        fs::create_dir(tree.path().join("sub")).unwrap();
        fs::write(tree.path().join("a.md"), "a").unwrap();
        fs::write(tree.path().join("b.MARKDOWN"), "b").unwrap();
        fs::write(tree.path().join("c.pdf"), "c").unwrap();
        fs::write(tree.path().join("d.html"), "d").unwrap();
        fs::write(tree.path().join("e.HTM"), "e").unwrap();
        fs::write(tree.path().join("f.json"), "{}").unwrap();
        fs::write(tree.path().join("g.YAML"), "a: 1").unwrap();
        fs::write(tree.path().join("h.csv"), "a,b").unwrap();
        fs::write(tree.path().join("i.xlsx"), "x").unwrap();

        let flags: Vec<(String, bool, bool, bool, bool)> = list_dir(tree.path(), false)
            .unwrap()
            .into_iter()
            .map(|e| (e.name, e.is_dir, e.is_markdown, e.is_html, e.is_text))
            .collect();
        // The three flags never overlap: Markdown and HTML have renderers of
        // their own, `is_text` is for what would otherwise leave the app, and
        // a spreadsheet still gets none of them.
        assert_eq!(
            flags,
            vec![
                ("sub".to_string(), true, false, false, false),
                ("a.md".to_string(), false, true, false, false),
                ("b.MARKDOWN".to_string(), false, true, false, false),
                ("c.pdf".to_string(), false, false, false, false),
                ("d.html".to_string(), false, false, true, false),
                ("e.HTM".to_string(), false, false, true, false),
                ("f.json".to_string(), false, false, false, true),
                ("g.YAML".to_string(), false, false, false, true),
                ("h.csv".to_string(), false, false, false, true),
                ("i.xlsx".to_string(), false, false, false, false),
            ]
        );
    }

    #[test]
    fn a_text_extension_is_matched_whole_not_as_a_suffix() {
        // `.geojson` ends with "json" but is not in the list; matching on the
        // substring would quietly pull in every neighbour of every extension.
        assert!(is_text("notes.txt"));
        assert!(is_text("data.JSON"));
        assert!(!is_text("map.geojson"));
        assert!(!is_text("archive.tar"));
        assert!(!is_text("README"));
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
    fn root_status_reports_whether_the_folder_is_there() {
        let tree = TempTree::new("status");
        let settings = settings_with_roots(vec![
            root("D-001", "G:/nowhere/at/all"),
            root("D-002", &norm(tree.path())),
        ]);
        let statuses = root_statuses(&settings);
        assert!(!statuses[0].available);
        assert!(statuses[1].available);
    }

    #[test]
    fn the_allow_list_is_exactly_the_registered_paths() {
        let settings = settings_with_roots(vec![root("D-001", "G:/team"), root("D-002", "  ")]);
        // A root with a blank path contributes nothing rather than matching
        // everything, which is what an empty prefix would do.
        assert_eq!(allowed_roots(&settings), vec!["G:/team".to_string()]);
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

    fn resolve(pasted: &str, roots: &[String]) -> Result<OpenPathResolution, String> {
        resolve_open_path(pasted, roots, false)
    }

    #[test]
    fn open_path_hits_directly_when_the_mounts_agree() {
        let tree = TempTree::new("open-direct");
        fs::write(tree.path().join("spec.md"), "s").unwrap();
        let pasted = norm(&tree.path().join("spec.md"));
        let res = resolve(&pasted, &[tree.norm()]).unwrap();
        assert!(res.direct);
        assert_eq!(res.matches.len(), 1);
        assert_eq!(res.matches[0].path, pasted);
        assert!(!res.matches[0].is_dir);
    }

    #[test]
    fn open_path_falls_back_to_the_longest_tail() {
        let tree = TempTree::new("open-tail");
        fs::create_dir_all(tree.path().join("docs")).unwrap();
        fs::write(tree.path().join("docs").join("spec.md"), "s").unwrap();
        // A drive letter this machine never had: nothing resolves directly,
        // and the sender-specific lead ("foreign") drops away with the tail.
        let res = resolve(r"Q:\foreign\docs\spec.md", &[tree.norm()]).unwrap();
        assert!(!res.direct);
        assert_eq!(res.matches.len(), 1);
        assert_eq!(res.matches[0].path, norm(&tree.path().join("docs/spec.md")));
    }

    #[test]
    fn open_path_prefers_a_longer_tail_over_a_shorter_one() {
        let shallow = TempTree::new("open-shallow");
        let deep = TempTree::new("open-deep");
        fs::write(shallow.path().join("spec.md"), "s").unwrap();
        fs::create_dir_all(deep.path().join("docs")).unwrap();
        fs::write(deep.path().join("docs").join("spec.md"), "s").unwrap();
        // `docs/spec.md` lands under the deep root; the bare `spec.md` under
        // the shallow one must not shadow it.
        let res = resolve(r"Q:\docs\spec.md", &[shallow.norm(), deep.norm()]).unwrap();
        assert!(!res.direct);
        assert_eq!(res.matches.len(), 1);
        assert_eq!(res.matches[0].path, norm(&deep.path().join("docs/spec.md")));
    }

    #[test]
    fn open_path_returns_every_root_at_the_winning_length() {
        let first = TempTree::new("open-multi-a");
        let second = TempTree::new("open-multi-b");
        fs::create_dir_all(first.path().join("docs")).unwrap();
        fs::create_dir_all(second.path().join("docs")).unwrap();
        fs::write(first.path().join("docs").join("same.md"), "a").unwrap();
        fs::write(second.path().join("docs").join("same.md"), "b").unwrap();
        let res = resolve(r"Q:\docs\same.md", &[first.norm(), second.norm()]).unwrap();
        assert!(!res.direct);
        assert_eq!(res.matches.len(), 2);
    }

    #[test]
    fn open_path_reports_folders_and_strips_quotes() {
        let tree = TempTree::new("open-dir");
        fs::create_dir(tree.path().join("notes")).unwrap();
        // Backslashes and surrounding quotes are chat formatting, not the name.
        let pasted = format!("\"{}\\notes\"", tree.norm().replace('/', "\\"));
        let res = resolve(&pasted, &[tree.norm()]).unwrap();
        assert!(res.direct);
        assert!(res.matches[0].is_dir);
    }

    #[test]
    fn open_path_finds_a_file_whose_folders_differ_midway() {
        // The teammate's share is laid out differently from this root: the
        // file sits a year folder deeper, so no tail joined to the root lands.
        let tree = TempTree::new("open-search");
        fs::create_dir_all(tree.path().join("2026/docs")).unwrap();
        fs::write(tree.path().join("2026/docs/a.md"), "a").unwrap();
        let res = resolve(r"Q:\share\docs\a.md", &[tree.norm()]).unwrap();
        assert!(!res.direct);
        assert!(res.searched);
        assert_eq!(res.matches.len(), 1);
        assert_eq!(
            res.matches[0].path,
            norm(&tree.path().join("2026/docs/a.md"))
        );
    }

    #[test]
    fn open_path_search_prefers_more_shared_folders() {
        let tree = TempTree::new("open-search-rank");
        fs::create_dir_all(tree.path().join("2026/docs")).unwrap();
        fs::create_dir_all(tree.path().join("old")).unwrap();
        fs::write(tree.path().join("2026/docs/a.md"), "a").unwrap();
        fs::write(tree.path().join("old/a.md"), "a").unwrap();
        // Both are named a.md; only one also sits in a `docs` folder.
        let res = resolve(r"Q:\share\docs\a.md", &[tree.norm()]).unwrap();
        assert_eq!(res.matches.len(), 1);
        assert_eq!(
            res.matches[0].path,
            norm(&tree.path().join("2026/docs/a.md"))
        );
    }

    #[test]
    fn open_path_search_offers_every_equally_good_candidate() {
        let tree = TempTree::new("open-search-tie");
        fs::create_dir_all(tree.path().join("x")).unwrap();
        fs::create_dir_all(tree.path().join("y")).unwrap();
        fs::write(tree.path().join("x/A.md"), "a").unwrap();
        fs::write(tree.path().join("y/a.md"), "a").unwrap();
        let res = resolve(r"Q:\share\a.md", &[tree.norm()]).unwrap();
        assert!(res.searched);
        assert_eq!(res.matches.len(), 2);
    }

    #[test]
    fn open_path_search_follows_the_dot_entry_setting() {
        let tree = TempTree::new("open-search-dot");
        fs::create_dir_all(tree.path().join(".backup/docs")).unwrap();
        fs::write(tree.path().join(".backup/docs/a.md"), "a").unwrap();
        let roots = [tree.norm()];
        assert!(resolve_open_path(r"Q:\share\docs\a.md", &roots, false).is_err());
        let res = resolve_open_path(r"Q:\share\docs\a.md", &roots, true).unwrap();
        assert_eq!(
            res.matches[0].path,
            norm(&tree.path().join(".backup/docs/a.md"))
        );
    }

    #[test]
    fn open_path_fails_openly_when_nothing_matches() {
        let tree = TempTree::new("open-miss");
        assert!(resolve("", &[tree.norm()]).is_err());
        let err = resolve(r"Q:\nowhere\missing.md", &[tree.norm()]).unwrap_err();
        assert!(err.contains("matches nothing"), "{err}");
    }
}
