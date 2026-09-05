//! Vault projects: what `projects/<slug>/` actually holds, and where that
//! departs from the layout the vault's CLAUDE.md documents (T-0190).
//!
//! The app already had three different things called a "project": a registered
//! repository (`models::Project`, the Repos tab), a folder under the vault's
//! `projects/`, and the free-text `project:` key on a task. Only the first had
//! a screen. This module is the second one's backend, and it deliberately does
//! **not** try to merge the three — a project with no repo and a repo with no
//! project both exist in the owner's vault, so merging them would lose real
//! information. What it does instead is make the mismatch visible.
//!
//! The design bias here is *reporting over repair*. The scan reads the folder
//! and reports findings; the only writes it performs are the ones a user asks
//! for explicitly (archive/restore, and linking a repo). Repairing a scaffold
//! or moving misfiled notes is a later phase, because "fix it without breaking
//! it" is a judgement call that is much easier to make once the findings from
//! a real vault are on screen.
//!
//! Deleting a project is deliberately absent, and not an oversight: a project
//! folder accumulates months of hand-written prose, and the same argument that
//! made the mindmap delete a move-to-trash applies here with more force.
//! Archiving moves the folder to `archive/projects/<slug>/`, which keeps its
//! provenance and is reversible from the same screen.

use crate::models::{SharedSpace, VaultProject, VaultProjectFolder, VaultProjectIssue};
use crate::vault_note::{
    ensure_scaffold_file, frontmatter_list, frontmatter_value, norm_path, projects_dir,
    remove_frontmatter_key, rewrite_frontmatter, rewrite_frontmatter_list, split_frontmatter,
    today,
};
use std::fs;
use std::path::{Path, PathBuf};

/// Files the documented layout says every project has. `README.md` leads
/// because it is the stated entry point for agents; `_index.md` is where the
/// repo link lives.
const REQUIRED_FILES: &[&str] = &["README.md", "prd.md", "roadmap.md", "links.md", "_index.md"];

/// A missing one of these is worth a warning rather than a note: without them
/// an agent told to "read the README first" has nothing to read, and the repo
/// link has nowhere to live.
const CRITICAL_FILES: &[&str] = &["README.md", "_index.md"];

/// Subfolders the documented layout names, in the order CLAUDE.md lists them.
const KNOWN_DIRS: &[&str] = &[
    "specs",
    "backlog",
    "research",
    "dev-notes",
    "deliverables",
    "schedules",
    "mindmaps",
    "shared",
    "attachments",
];

/// Where a project records the team knowledge bases that live outside the
/// vault. One note per place; the folder is the registry (T-0239).
const SHARED_DIR: &str = "shared";

/// What a shared-space note means when it does not say which way material may
/// flow. A place someone else's team owns is read-only until the owner says
/// otherwise, so the missing value and the unrecognised one both land here.
const DEFAULT_DIRECTION: &str = "read-only";

/// Where the repo link is read from and written to. `_index.md` is the
/// project's machine-readable index, which is what a repo link is.
const INDEX_FILE: &str = "_index.md";

/// How deep the mtime walk descends. Projects are shallow by construction; the
/// bound is there so a stray `node_modules` someone parked in `attachments/`
/// cannot turn a list refresh into a full-disk scan.
const MTIME_DEPTH: usize = 3;

/// Longest README excerpt kept for the list row.
const SUMMARY_CHARS: usize = 180;

pub fn archive_projects_dir(vault: &Path) -> PathBuf {
    vault.join("archive").join("projects")
}

fn project_dir(vault: &Path, slug: &str, archived: bool) -> PathBuf {
    let root = if archived {
        archive_projects_dir(vault)
    } else {
        projects_dir(vault)
    };
    root.join(slug)
}

/// Rejects anything that would let a slug escape the projects folder. Every
/// entry point that joins a caller-supplied slug onto a path goes through here.
fn check_slug(slug: &str) -> Result<&str, String> {
    let slug = slug.trim();
    if slug.is_empty() {
        return Err("a project slug is required".into());
    }
    if slug == ".." || slug.contains(['/', '\\']) {
        return Err("a project slug cannot contain path separators".into());
    }
    Ok(slug)
}

/// Every project in the vault, active first and archived after when asked for.
///
/// Reads each project's folder rather than an index: the whole point of the
/// tab is to show what is *actually* on disk, and an index that is out of date
/// is one of the things it is meant to catch.
pub fn list_projects(vault: &Path, include_archived: bool) -> Result<Vec<VaultProject>, String> {
    let mut out = Vec::new();
    scan_root(&projects_dir(vault), false, &mut out)?;
    if include_archived {
        scan_root(&archive_projects_dir(vault), true, &mut out)?;
    }
    sort_projects(&mut out);
    Ok(out)
}

/// The list order the Projects tab shows, and the one the reorder writes
/// back against (T-0231):
///
/// 1. active before archived — an archived project is out of the way, and is
///    never a drag target;
/// 2. pinned before the rest, which is the whole point of a pin;
/// 3. `order` ascending, with an unordered project after every ordered one —
///    a project nobody has dragged yet has no opinion about where it goes;
/// 4. slug, so the order is stable and alphabetical until someone drags.
///
/// Ordering happens here rather than in the view because the same order has
/// to hold for the midpoint arithmetic on the front end, and two independent
/// sorts would eventually disagree.
pub fn sort_projects(projects: &mut [VaultProject]) {
    projects.sort_by(|a, b| {
        a.archived
            .cmp(&b.archived)
            .then(b.pinned.cmp(&a.pinned))
            .then(order_key(a.order).total_cmp(&order_key(b.order)))
            .then(a.slug.to_lowercase().cmp(&b.slug.to_lowercase()))
    });
}

/// An absent `order` sorts after every present one. `total_cmp` needs a real
/// float, so "last" is spelled as infinity rather than as an Option compare.
fn order_key(order: Option<f64>) -> f64 {
    order.unwrap_or(f64::INFINITY)
}

fn scan_root(root: &Path, archived: bool, out: &mut Vec<VaultProject>) -> Result<(), String> {
    if !root.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let slug = entry.file_name().to_string_lossy().to_string();
        // Same rule as the note pickers: `_`/`.` folders are zone machinery,
        // not projects, so a project created there could never be picked.
        if slug.starts_with('_') || slug.starts_with('.') {
            continue;
        }
        out.push(inspect(&entry.path(), &slug, archived));
    }
    Ok(())
}

/// Reads one project folder into a summary. Never fails: an unreadable
/// subfolder produces a project with fewer findings, not a Projects tab that
/// refuses to open.
fn inspect(dir: &Path, slug: &str, archived: bool) -> VaultProject {
    let readme = read_note(&dir.join("README.md"));
    let index = read_note(&dir.join(INDEX_FILE));
    let name = match readme.as_ref().map(|n| frontmatter_value(&n.0, "title")) {
        Some(t) if !t.trim().is_empty() => t,
        _ => slug.to_string(),
    };
    let status = readme
        .as_ref()
        .map(|n| frontmatter_value(&n.0, "status"))
        .unwrap_or_default();
    // `_index.md` owns the link; README is read as a fallback so a project
    // that recorded it by hand in the more obvious place still shows up linked.
    // The legacy single `repo:` key is deliberately not read: the migration to
    // `repos:` is a one-time rewrite, and a fallback would leave two spellings
    // of the same link alive indefinitely (T-0216).
    let repos = index
        .as_ref()
        .map(|n| frontmatter_list(&n.0, "repos"))
        .filter(|r| !r.is_empty())
        .or_else(|| {
            readme
                .as_ref()
                .map(|n| frontmatter_list(&n.0, "repos"))
                .filter(|r| !r.is_empty())
        })
        .unwrap_or_default();
    let description = readme
        .as_ref()
        .map(|n| frontmatter_value(&n.0, "description"))
        .unwrap_or_default();
    let summary = if !description.trim().is_empty() {
        description.trim().to_string()
    } else {
        readme.as_ref().map(|n| excerpt(&n.1)).unwrap_or_default()
    };

    // Pin and manual order live in `_index.md` beside the repo link, and are
    // not read from README: unlike `repos:`, they were never written by hand
    // before the app grew the feature, so there is no older spelling to
    // support (T-0231).
    let pinned = index
        .as_ref()
        .map(|n| frontmatter_value(&n.0, "pinned"))
        .map(|v| v.trim().eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    let order = index
        .as_ref()
        .map(|n| frontmatter_value(&n.0, "order"))
        .and_then(|v| v.trim().parse::<f64>().ok())
        .filter(|v| v.is_finite());

    let (folders, mut issues) = inspect_folders(dir);
    for file in REQUIRED_FILES {
        if !dir.join(file).is_file() {
            issues.push(VaultProjectIssue {
                kind: "missing-file".into(),
                severity: severity(CRITICAL_FILES.contains(file)),
                target: (*file).to_string(),
            });
        }
    }
    for name in misfiled_deliverables(dir) {
        issues.push(VaultProjectIssue {
            kind: "misfiled-deliverable".into(),
            severity: "warn".into(),
            target: name,
        });
    }

    VaultProject {
        slug: slug.to_string(),
        name,
        path: norm_path(dir),
        status: status.trim().to_string(),
        repos: repos.iter().map(|r| r.trim().to_string()).collect(),
        summary,
        updated: newest_mtime(dir, MTIME_DEPTH),
        folders,
        issues,
        archived,
        pinned,
        order,
        shared: read_shared_spaces(dir),
    }
}

fn severity(critical: bool) -> String {
    if critical { "warn" } else { "info" }.to_string()
}

/// Frontmatter block and body of a note, or `None` when it is missing or has
/// no frontmatter.
fn read_note(path: &Path) -> Option<(String, String)> {
    let content = fs::read_to_string(path).ok()?;
    split_frontmatter(&content)
}

/// First prose paragraph of a README body — headings, blockquotes (the
/// scaffold's "AI agents: read this first" callout), tables, embeds and list
/// markers are all skipped, because none of them says what the project *is*.
fn excerpt(body: &str) -> String {
    for line in body.lines() {
        let line = line.trim();
        if line.is_empty()
            || line.starts_with('#')
            || line.starts_with('>')
            || line.starts_with('|')
            || line.starts_with('-')
            || line.starts_with('!')
        {
            continue;
        }
        let mut text: String = line.chars().take(SUMMARY_CHARS).collect();
        if line.chars().count() > SUMMARY_CHARS {
            text.push('…');
        }
        return text;
    }
    String::new()
}

/// The shared spaces a project has registered, read from the notes in
/// `shared/` (T-0239).
///
/// Only the frontmatter is read: the rules in the body are prose meant for a
/// person or an agent, and summarising them here would be guessing at what
/// matters. The scan stays report-only, exactly like the rest of this module —
/// nothing about a shared space is written from the app.
///
/// Sorted by title so the list does not reshuffle when a note is edited; the
/// file stem breaks ties, so two places sharing a title still have a stable
/// order.
fn read_shared_spaces(dir: &Path) -> Vec<SharedSpace> {
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(dir.join(SHARED_DIR)) else {
        return out;
    };
    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let name = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        // Same convention as every other note folder: `_`/`.` files are
        // machinery (a Base, a template), not entries.
        if name.starts_with('_') || name.starts_with('.') {
            continue;
        }
        let Some((front, _)) = read_note(&path) else {
            continue;
        };
        let title = match frontmatter_value(&front, "title") {
            t if !t.trim().is_empty() => t.trim().to_string(),
            _ => name.clone(),
        };
        out.push(SharedSpace {
            name,
            path: norm_path(&path),
            title,
            kind: frontmatter_value(&front, "kind").trim().to_string(),
            location: frontmatter_value(&front, "location").trim().to_string(),
            access: frontmatter_value(&front, "access").trim().to_string(),
            direction: direction(&frontmatter_value(&front, "direction")),
            surveyed: frontmatter_value(&front, "surveyed").trim().to_string(),
        });
    }
    out.sort_by(|a, b| {
        a.title
            .to_lowercase()
            .cmp(&b.title.to_lowercase())
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    out
}

/// Normalises a note's `direction:`. Anything the vocabulary does not name —
/// a typo, a blank, a value from some future spelling — becomes `read-only`,
/// because the failure mode of guessing `export-ok` is writing into a place
/// the owner never said could be written to.
fn direction(raw: &str) -> String {
    match raw.trim().to_lowercase().as_str() {
        "export-ok" => "export-ok".to_string(),
        _ => DEFAULT_DIRECTION.to_string(),
    }
}

/// Counts what each subfolder holds and reports the two folder-level findings:
/// a documented folder that is missing, and a folder nobody documented.
fn inspect_folders(dir: &Path) -> (Vec<VaultProjectFolder>, Vec<VaultProjectIssue>) {
    let mut folders = Vec::new();
    let mut issues = Vec::new();

    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let known = KNOWN_DIRS.contains(&name.as_str());
            if !known {
                issues.push(VaultProjectIssue {
                    kind: "unknown-folder".into(),
                    severity: "info".into(),
                    target: format!("{name}/"),
                });
            }
            // `attachments/` holds images and binaries; everywhere else a note
            // is what counts, and counting the `.gitkeep` would make an empty
            // folder look occupied.
            let count = if name == "attachments" {
                count_files(&entry.path(), None)
            } else {
                count_files(&entry.path(), Some("md"))
            };
            folders.push(VaultProjectFolder { name, count, known });
        }
    }
    for known in KNOWN_DIRS {
        if !folders.iter().any(|f| f.name == *known) {
            issues.push(VaultProjectIssue {
                kind: "missing-folder".into(),
                severity: "info".into(),
                target: format!("{known}/"),
            });
        }
    }
    // Documented order first (it is the order CLAUDE.md lists them in, which is
    // the order the user reads them in), then anything undocumented.
    folders.sort_by_key(|f| {
        (
            KNOWN_DIRS
                .iter()
                .position(|k| *k == f.name)
                .unwrap_or(usize::MAX),
            f.name.to_lowercase(),
        )
    });
    (folders, issues)
}

fn count_files(dir: &Path, ext: Option<&str>) -> usize {
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name.starts_with('_') {
                return false;
            }
            match ext {
                Some(want) => e.path().extension().and_then(|x| x.to_str()) == Some(want),
                None => true,
            }
        })
        .count()
}

/// Task deliverable notes (`T-XXXX-…`) sitting in the project root instead of
/// `deliverables/`. This is the single most common drift in the owner's vault
/// — the workhub project alone has 26 — and it is mechanically detectable,
/// which is exactly the kind of check worth automating.
fn misfiled_deliverables(dir: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<String> = entries
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|name| name.ends_with(".md") && is_task_note(name))
        .collect();
    out.sort();
    out
}

/// `T-` followed by digits and then a separator — the naming the vault's
/// deliverable notes use. Matched by hand rather than with a regex crate: it
/// is four lines, and the shape is fixed by the task id format.
fn is_task_note(name: &str) -> bool {
    let Some(rest) = name.strip_prefix("T-") else {
        return false;
    };
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return false;
    }
    matches!(rest[digits.len()..].chars().next(), Some('-') | Some(' '))
}

/// Newest mtime anywhere under `dir`, bounded by `depth`. "Last touched" has
/// to include the notes inside the folder: a project judged by its folder
/// mtime alone would look untouched forever after its first week.
fn newest_mtime(dir: &Path, depth: usize) -> u64 {
    let mut newest = crate::vault_note::mtime_secs(dir);
    if depth == 0 {
        return newest;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return newest;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        let secs = if path.is_dir() {
            newest_mtime(&path, depth - 1)
        } else {
            crate::vault_note::mtime_secs(&path)
        };
        newest = newest.max(secs);
    }
    newest
}

// ---------------------------------------------------------------------
// archive / restore
// ---------------------------------------------------------------------

/// Moves `projects/<slug>/` to `archive/projects/<slug>/`.
///
/// Under `archive/projects/` rather than `archive/<slug>/` so the folder's
/// provenance survives the move: a year later, `archive/workhub/` says nothing
/// about what kind of thing it was. This adds one convention to the vault, and
/// it is written down in CLAUDE.md alongside the rest of the layout.
pub fn archive_project(vault: &Path, slug: &str) -> Result<String, String> {
    let slug = check_slug(slug)?;
    let from = project_dir(vault, slug, false);
    if !from.is_dir() {
        return Err(format!("no project named '{slug}' is in projects/"));
    }
    let to = project_dir(vault, slug, true);
    if to.exists() {
        return Err(format!(
            "archive/projects/{slug}/ already exists — rename or remove it first"
        ));
    }
    move_dir(&from, &to)?;
    Ok(norm_path(&to))
}

/// The exact inverse of `archive_project`, so archiving is never a one-way
/// door.
pub fn restore_project(vault: &Path, slug: &str) -> Result<String, String> {
    let slug = check_slug(slug)?;
    let from = project_dir(vault, slug, true);
    if !from.is_dir() {
        return Err(format!("no project named '{slug}' is in archive/projects/"));
    }
    let to = project_dir(vault, slug, false);
    if to.exists() {
        return Err(format!(
            "projects/{slug}/ already exists — rename or remove it first"
        ));
    }
    move_dir(&from, &to)?;
    Ok(norm_path(&to))
}

/// `fs::rename` with a copy-then-delete fallback, because the vault's
/// `archive/` can sit on a different volume from `projects/` (a synced or
/// junctioned folder), where a rename fails outright.
fn move_dir(from: &Path, to: &Path) -> Result<(), String> {
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if fs::rename(from, to).is_ok() {
        return Ok(());
    }
    copy_dir(from, to)?;
    fs::remove_dir_all(from).map_err(|e| e.to_string())
}

fn copy_dir(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(from).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let target = to.join(entry.file_name());
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            copy_dir(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------
// repo link
// ---------------------------------------------------------------------

/// Records which registered repositories a project belongs to, in
/// `_index.md`'s frontmatter, in the order given — the first entry is the
/// project's default repository (T-0216).
///
/// The link is stored rather than inferred because inferring it is what is
/// broken today: the vault's `multi-agent-ff15` is the repo
/// `multi-agent-ff15-vscode`, and no name match finds that. An empty list
/// clears the link.
///
/// Every write also drops the pre-T-0216 `repo:` key, so a note that predates
/// the migration cannot end up carrying both spellings of the same link.
///
/// `_index.md` is created from the scaffold when the project predates it —
/// additive, and the alternative is refusing to link the vault's oldest
/// projects at all.
pub fn set_project_repos(vault: &Path, slug: &str, repos: &[String]) -> Result<(), String> {
    let slug = check_slug(slug)?;
    let dir = project_dir(vault, slug, false);
    if !dir.is_dir() {
        return Err(format!("no project named '{slug}' is in projects/"));
    }
    let name = read_note(&dir.join("README.md"))
        .map(|n| frontmatter_value(&n.0, "title"))
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| slug.to_string());
    let path = ensure_scaffold_file(vault, slug, &name, INDEX_FILE)?;
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let (front, body) = split_frontmatter(&content)
        .ok_or_else(|| format!("{INDEX_FILE} has no frontmatter block"))?;
    let now = today();
    let front = remove_frontmatter_key(&front, "repo");
    let front = rewrite_frontmatter(&front, &[("updated", &now)]);
    let front = rewrite_frontmatter_list(&front, "repos", repos);
    fs::write(&path, format!("---\n{front}---\n{body}")).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------
// pin / manual order
// ---------------------------------------------------------------------

/// Renders an `order` float without a trailing `.0` for whole numbers, so a
/// hand-edited note stays tidy (`order: 3`, not `order: 3.0`). Same rule as
/// `tasks::render_order` — a project's order and a task's order are the same
/// mechanism and should not look different in the vault.
fn render_order(order: f64) -> String {
    if order.fract() == 0.0 && order.abs() < 1e15 {
        format!("{}", order as i64)
    } else {
        format!("{order}")
    }
}

/// Records a project's pin and its manual sort position in `_index.md`
/// (T-0231).
///
/// Both live in the vault rather than in `~/.workhub/config.json`, unlike the
/// Repos tab's `favorite`: a repository path is machine-specific, but a
/// project *is* the vault's content, so cloning the vault on a second PC
/// should bring its pins and its order along.
///
/// `order: None` drops the key, which puts the project back at the end of its
/// group — the state every project starts in. The order is a float so that
/// dragging one project rewrites one note; see `sort_projects`.
///
/// Archived projects are refused: they sort last unconditionally and the tab
/// does not offer them as a drag target, so an order written against one
/// would be a value nothing ever reads.
pub fn set_project_order(
    vault: &Path,
    slug: &str,
    pinned: bool,
    order: Option<f64>,
) -> Result<(), String> {
    let slug = check_slug(slug)?;
    let dir = project_dir(vault, slug, false);
    if !dir.is_dir() {
        return Err(format!("no project named '{slug}' is in projects/"));
    }
    if let Some(v) = order {
        if !v.is_finite() {
            return Err("a project order must be a finite number".into());
        }
    }
    let name = read_note(&dir.join("README.md"))
        .map(|n| frontmatter_value(&n.0, "title"))
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| slug.to_string());
    let path = ensure_scaffold_file(vault, slug, &name, INDEX_FILE)?;
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let (front, body) = split_frontmatter(&content)
        .ok_or_else(|| format!("{INDEX_FILE} has no frontmatter block"))?;
    // `updated:` is deliberately not touched here. A pin is a view preference,
    // not an edit to the project, and stamping it would make every reordering
    // look like the project had been worked on.
    let front = match order {
        Some(v) => rewrite_frontmatter(&front, &[("order", &render_order(v))]),
        None => remove_frontmatter_key(&front, "order"),
    };
    let front = if pinned {
        rewrite_frontmatter(&front, &[("pinned", "true")])
    } else {
        remove_frontmatter_key(&front, "pinned")
    };
    fs::write(&path, format!("---\n{front}---\n{body}")).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------
// name / description
// ---------------------------------------------------------------------

/// Collapses any whitespace (including newlines) so a description can live
/// on one frontmatter line. YAML in these notes is flat scalars; a raw
/// newline would close the block.
fn one_line(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Writes the project's display name and description into README.md
/// frontmatter (`title` / `description`).
///
/// The folder slug is not renamed: tasks name a project by slug in
/// `project:`, and renaming the folder would silently orphan them. The
/// body of the README is left untouched — the Overview section is the
/// human-written spec, and this command is not a licence to rewrite it.
/// An empty `summary` clears `description`; the next scan then falls back
/// to the README excerpt, which is how projects without a dedicated blurb
/// already look.
pub fn set_project_details(
    vault: &Path,
    slug: &str,
    name: &str,
    summary: &str,
) -> Result<(), String> {
    let slug = check_slug(slug)?;
    let name = one_line(name);
    if name.is_empty() {
        return Err("a project name is required".into());
    }
    let dir = project_dir(vault, slug, false);
    if !dir.is_dir() {
        return Err(format!("no project named '{slug}' is in projects/"));
    }
    let path = ensure_scaffold_file(vault, slug, &name, "README.md")?;
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let (front, body) = split_frontmatter(&content)
        .ok_or_else(|| "README.md has no frontmatter block".to_string())?;
    let now = today();
    let description = one_line(summary);
    let front = rewrite_frontmatter(
        &front,
        &[
            ("title", &name),
            ("description", &description),
            ("updated", &now),
        ],
    );
    fs::write(&path, format!("---\n{front}---\n{body}")).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_vault(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("workhub-vault-project-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("projects")).unwrap();
        dir
    }

    fn write(path: PathBuf, content: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    #[test]
    fn scan_reports_the_gap_between_the_layout_and_the_folder() {
        let vault = temp_vault("scan");
        let dir = vault.join("projects").join("demo");
        write(
            dir.join("README.md"),
            "---\ntitle: Demo\nstatus: active\n---\n\n# Demo\n\n> agents read this\n\nA demo project.\n",
        );
        write(dir.join("T-0042-a-deliverable.md"), "note\n");
        write(dir.join("deliverables").join("T-0001-done.md"), "note\n");
        write(dir.join("pbl").join("scratch.md"), "note\n");

        let projects = list_projects(&vault, false).unwrap();
        assert_eq!(projects.len(), 1);
        let p = &projects[0];
        assert_eq!(p.name, "Demo");
        assert_eq!(p.status, "active");
        assert_eq!(p.summary, "A demo project.");
        assert!(!p.archived);

        let targets = |kind: &str| -> Vec<String> {
            p.issues
                .iter()
                .filter(|i| i.kind == kind)
                .map(|i| i.target.clone())
                .collect()
        };
        assert_eq!(targets("misfiled-deliverable"), ["T-0042-a-deliverable.md"]);
        assert_eq!(targets("unknown-folder"), ["pbl/"]);
        assert!(targets("missing-file").contains(&"prd.md".to_string()));
        assert!(targets("missing-folder").contains(&"specs/".to_string()));

        let deliverables = p.folders.iter().find(|f| f.name == "deliverables").unwrap();
        assert_eq!(deliverables.count, 1);
        assert!(deliverables.known);
        assert!(!p.folders.iter().find(|f| f.name == "pbl").unwrap().known);
    }

    /// `shared/` is read as a registry of notes, and a note that does not say
    /// which way material may flow is read as read-only (T-0239).
    #[test]
    fn shared_spaces_are_read_from_the_folder_and_default_to_read_only() {
        let vault = temp_vault("shared");
        let dir = vault.join("projects").join("demo");
        write(dir.join("README.md"), "---\ntitle: Demo\n---\n");
        write(
            dir.join("shared").join("design-share.md"),
            "---\ntype: shared-space\ntitle: Design team share\nkind: network-drive\nlocation: //fileserver/design\naccess: mapped to Z:\ndirection: export-ok\nsurveyed: 2026-09-05\n---\n\n## Rules\n\n- one folder per release (stated)\n",
        );
        // No `direction:` at all, and a title the frontmatter does not give.
        write(
            dir.join("shared").join("vendor-drive.md"),
            "---\ntype: shared-space\nkind: google-drive\nlocation: https://drive.google.com/drive/folders/x\n---\n",
        );
        // Machinery, not an entry.
        write(dir.join("shared").join("_shared.base"), "views: []\n");
        write(dir.join("shared").join("_template.md"), "---\n---\n");

        let p = &list_projects(&vault, false).unwrap()[0];
        assert_eq!(p.shared.len(), 2);

        // Sorted by title, so "Design team share" comes before "vendor-drive".
        let first = &p.shared[0];
        assert_eq!(first.name, "design-share");
        assert_eq!(first.title, "Design team share");
        assert_eq!(first.kind, "network-drive");
        assert_eq!(first.location, "//fileserver/design");
        assert_eq!(first.access, "mapped to Z:");
        assert_eq!(first.direction, "export-ok");
        assert_eq!(first.surveyed, "2026-09-05");
        assert!(first.path.ends_with("shared/design-share.md"));

        let second = &p.shared[1];
        assert_eq!(second.title, "vendor-drive", "falls back to the file stem");
        assert_eq!(second.direction, "read-only", "an unstated direction");
        assert!(second.surveyed.is_empty());

        // The folder is documented, so holding notes is not a finding.
        assert!(!p
            .issues
            .iter()
            .any(|i| i.kind == "unknown-folder" && i.target == "shared/"));
    }

    /// A project with no `shared/` folder simply has no shared spaces — the
    /// absence is an info-level finding, never an error.
    #[test]
    fn a_project_without_the_folder_has_no_shared_spaces() {
        let vault = temp_vault("shared-absent");
        let dir = vault.join("projects").join("demo");
        write(dir.join("README.md"), "---\ntitle: Demo\n---\n");

        let p = &list_projects(&vault, false).unwrap()[0];
        assert!(p.shared.is_empty());
        assert!(p
            .issues
            .iter()
            .any(|i| i.kind == "missing-folder" && i.target == "shared/"));
    }

    /// An unrecognised `direction:` is not trusted: it reads as read-only,
    /// because guessing `export-ok` would write into someone else's place.
    #[test]
    fn an_unrecognised_direction_reads_as_read_only() {
        assert_eq!(direction("export-ok"), "export-ok");
        assert_eq!(direction("  EXPORT-OK  "), "export-ok");
        assert_eq!(direction("read-only"), "read-only");
        assert_eq!(direction("writable"), "read-only");
        assert_eq!(direction(""), "read-only");
    }

    #[test]
    fn the_pin_and_the_manual_order_round_trip_through_the_index_note() {
        let vault = temp_vault("pin-order");
        write(
            vault.join("projects").join("demo").join("README.md"),
            "---\ntitle: Demo\n---\n",
        );

        // Nothing recorded yet: no pin, no opinion about position.
        let p = &list_projects(&vault, false).unwrap()[0];
        assert!(!p.pinned);
        assert_eq!(p.order, None);

        set_project_order(&vault, "demo", true, Some(2.5)).unwrap();
        let p = &list_projects(&vault, false).unwrap()[0];
        assert!(p.pinned);
        assert_eq!(p.order, Some(2.5));

        // A whole number is written without its `.0`, like a task's order.
        set_project_order(&vault, "demo", true, Some(3.0)).unwrap();
        let index =
            fs::read_to_string(vault.join("projects").join("demo").join("_index.md")).unwrap();
        assert!(index.contains("order: 3\n"), "{index}");

        // Clearing drops both keys rather than writing falsy values.
        set_project_order(&vault, "demo", false, None).unwrap();
        let index =
            fs::read_to_string(vault.join("projects").join("demo").join("_index.md")).unwrap();
        assert!(!index.contains("pinned"), "{index}");
        assert!(!index.contains("order:"), "{index}");
        let p = &list_projects(&vault, false).unwrap()[0];
        assert!(!p.pinned);
        assert_eq!(p.order, None);
    }

    /// Pinned first, then by `order`, with an unordered project after every
    /// ordered one and archived projects last regardless of either.
    #[test]
    fn the_list_order_puts_pins_first_and_the_unordered_last() {
        let vault = temp_vault("pin-sort");
        for slug in ["alpha", "beta", "gamma"] {
            write(
                vault.join("projects").join(slug).join("README.md"),
                "---\ntitle: x\n---\n",
            );
        }
        write(
            vault
                .join("archive")
                .join("projects")
                .join("aardvark")
                .join("README.md"),
            "---\ntitle: x\n---\n",
        );

        // gamma is pinned; beta has a position; alpha has neither.
        set_project_order(&vault, "gamma", true, None).unwrap();
        set_project_order(&vault, "beta", false, Some(1.0)).unwrap();

        let slugs: Vec<String> = list_projects(&vault, true)
            .unwrap()
            .into_iter()
            .map(|p| p.slug)
            .collect();
        assert_eq!(slugs, ["gamma", "beta", "alpha", "aardvark"]);
    }

    #[test]
    fn archive_and_restore_are_inverses() {
        let vault = temp_vault("archive");
        write(
            vault.join("projects").join("demo").join("README.md"),
            "---\ntitle: Demo\n---\n",
        );

        archive_project(&vault, "demo").unwrap();
        assert!(!vault.join("projects").join("demo").exists());
        assert!(vault
            .join("archive")
            .join("projects")
            .join("demo")
            .join("README.md")
            .is_file());
        assert!(list_projects(&vault, false).unwrap().is_empty());
        let all = list_projects(&vault, true).unwrap();
        assert_eq!(all.len(), 1);
        assert!(all[0].archived);

        restore_project(&vault, "demo").unwrap();
        assert!(vault
            .join("projects")
            .join("demo")
            .join("README.md")
            .is_file());
        assert!(!vault.join("archive").join("projects").join("demo").exists());
    }

    #[test]
    fn archive_refuses_to_merge_onto_an_existing_folder() {
        let vault = temp_vault("archive-clash");
        write(
            vault.join("projects").join("demo").join("README.md"),
            "---\ntitle: new\n---\n",
        );
        write(
            vault
                .join("archive")
                .join("projects")
                .join("demo")
                .join("README.md"),
            "---\ntitle: old\n---\n",
        );
        assert!(archive_project(&vault, "demo").is_err());
        // Neither side moved.
        assert!(vault
            .join("projects")
            .join("demo")
            .join("README.md")
            .is_file());
    }

    #[test]
    fn a_slug_cannot_escape_the_projects_folder() {
        let vault = temp_vault("escape");
        assert!(archive_project(&vault, "../tasks").is_err());
        assert!(restore_project(&vault, "..").is_err());
        assert!(set_project_repos(&vault, "a/b", &["x".to_string()]).is_err());
    }

    #[test]
    fn the_repo_link_round_trips_through_the_index_note() {
        let vault = temp_vault("repo-link");
        let dir = vault.join("projects").join("demo");
        write(dir.join("README.md"), "---\ntitle: Demo\n---\n");
        write(
            dir.join(INDEX_FILE),
            "---\ntitle: Demo index\ntype: index\n---\n\n# Demo index\n",
        );

        set_project_repos(&vault, "demo", &["C:/repos/demo-app".to_string()]).unwrap();
        let p = &list_projects(&vault, false).unwrap()[0];
        assert_eq!(p.repos, vec!["C:/repos/demo-app".to_string()]);

        // The note's own content survives the rewrite.
        let content = fs::read_to_string(dir.join(INDEX_FILE)).unwrap();
        assert!(content.contains("type: index"));
        assert!(content.contains("# Demo index"));

        set_project_repos(&vault, "demo", &[]).unwrap();
        assert!(list_projects(&vault, false).unwrap()[0].repos.is_empty());
    }

    /// Several repositories, in order, with the pre-T-0216 `repo:` key retired
    /// on the way — a note carrying both spellings would read as linked to
    /// whichever one the next reader happened to look for.
    #[test]
    fn several_repos_round_trip_and_retire_the_old_key() {
        let vault = temp_vault("repos-link");
        let dir = vault.join("projects").join("demo");
        write(dir.join("README.md"), "---\ntitle: Demo\n---\n");
        write(
            dir.join(INDEX_FILE),
            "---\ntitle: Demo index\ntype: index\ntags:\n  - index\nrepo: C:/repos/demo-app\n---\n\n# Demo index\n",
        );

        // The legacy key alone reads as no link at all: the migration is a
        // one-time rewrite, not a fallback.
        assert!(list_projects(&vault, false).unwrap()[0].repos.is_empty());

        let wanted = vec!["C:/repos/demo-app".to_string(), "demo-vault".to_string()];
        set_project_repos(&vault, "demo", &wanted).unwrap();
        assert_eq!(list_projects(&vault, false).unwrap()[0].repos, wanted);

        let content = fs::read_to_string(dir.join(INDEX_FILE)).unwrap();
        assert!(!content.contains("repo: C:/repos/demo-app"));
        assert!(content.contains("repos:\n  - C:/repos/demo-app\n  - demo-vault\n"));
        // The unrelated block list above it is untouched.
        assert!(content.contains("tags:\n  - index\n"));
    }

    #[test]
    fn name_and_description_round_trip_through_the_readme() {
        let vault = temp_vault("details");
        let dir = vault.join("projects").join("demo");
        write(
            dir.join("README.md"),
            "---\ntitle: Demo\nstatus: active\n---\n\n# Demo\n\n> agents read this\n\nA demo project.\n",
        );

        set_project_details(&vault, "demo", "Renamed", "A short blurb.").unwrap();
        let p = &list_projects(&vault, false).unwrap()[0];
        assert_eq!(p.name, "Renamed");
        assert_eq!(p.summary, "A short blurb.");

        let content = fs::read_to_string(dir.join("README.md")).unwrap();
        assert!(content.contains("title: Renamed"));
        assert!(content.contains("description: A short blurb."));
        assert!(content.contains("status: active"));
        assert!(content.contains("# Demo"));
        assert!(content.contains("A demo project."));
    }

    #[test]
    fn empty_description_falls_back_to_the_readme_excerpt() {
        let vault = temp_vault("details-excerpt");
        let dir = vault.join("projects").join("demo");
        write(
            dir.join("README.md"),
            "---\ntitle: Demo\n---\n\n# Demo\n\n> agents read this\n\nA demo project.\n",
        );

        set_project_details(&vault, "demo", "Demo", "line one\nline two").unwrap();
        assert_eq!(
            list_projects(&vault, false).unwrap()[0].summary,
            "line one line two"
        );

        set_project_details(&vault, "demo", "Demo", "  ").unwrap();
        assert_eq!(
            list_projects(&vault, false).unwrap()[0].summary,
            "A demo project."
        );
    }

    #[test]
    fn an_empty_name_is_rejected() {
        let vault = temp_vault("details-empty-name");
        write(
            vault.join("projects").join("demo").join("README.md"),
            "---\ntitle: Demo\n---\n",
        );
        assert!(set_project_details(&vault, "demo", "  ", "x").is_err());
        assert_eq!(list_projects(&vault, false).unwrap()[0].name, "Demo");
    }

    #[test]
    fn details_cannot_escape_the_projects_folder() {
        let vault = temp_vault("details-escape");
        assert!(set_project_details(&vault, "../tasks", "x", "y").is_err());
        assert!(set_project_details(&vault, "missing", "x", "y").is_err());
    }

    #[test]
    fn task_note_names_are_recognised() {
        assert!(is_task_note("T-0042-title.md"));
        assert!(is_task_note("T-0042 title.md"));
        assert!(!is_task_note("T-title.md"));
        assert!(!is_task_note("README.md"));
    }
}
