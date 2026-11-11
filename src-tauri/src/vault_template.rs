//! Vault init and template sync: the `vault-template/` tree embedded in the
//! binary, the per-file baselines in `_ai/template-manifest.json`, and the
//! 3-way compare / apply / orphan handling built on them.
//!
//! Moved out of `tasks.rs` (T-1220); the behaviour is unchanged.

use crate::tasks::{norm_path, split_frontmatter};
use serde::Serialize;
use similar::TextDiff;
use std::collections::HashMap;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------
// vault init + template sync (vault-template/, embedded in the binary)
// ---------------------------------------------------------------------
//
// The template used to be copied from a filesystem path and kept in sync via
// an HTML-comment marker in each managed file (`workhub-template: version=N`).
// That broke down in practice: the marker version never advanced past the
// files that first shipped it, JSON files can't carry an HTML comment, and a
// packaged single-exe build has no filesystem copy of `vault-template/` to
// diff against.
//
// The replacement: `vault-template/` is embedded into the binary at compile
// time (`include_dir!`), and a `_ai/template-manifest.json` file records, per
// relative path, the sha256 of the template content that was last applied to
// this vault (the "baseline"). `check_vault_template` does a 3-way compare of
// (current vault content, baseline, new template content) to classify each
// file; `apply_vault_template` applies a caller-chosen subset and updates the
// baseline to match.

use include_dir::{include_dir, Dir};
use sha2::{Digest, Sha256};
use std::borrow::Cow;

static VAULT_TEMPLATE: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../vault-template");

/// Location of the project scaffold inside the embedded template.
pub(crate) const PROJECT_TEMPLATE_DIR: &str = "templates/project";

/// The embedded `templates/project/` subtree, for scaffolding a new vault
/// project from the Schedule view (T-0178). `None` only in a build where the
/// template folder was removed — the caller turns that into an error.
pub(crate) fn project_template() -> Option<&'static Dir<'static>> {
    VAULT_TEMPLATE.get_dir(PROJECT_TEMPLATE_DIR)
}

/// Name of the data-driven classification file living at the template root.
/// Never copied into a vault (see `walk_template_files`).
const TEMPLATE_POLICY_FILE: &str = ".template-policy.json";

/// Bumped whenever the manifest's meaning changes in a way that makes
/// previously written `files` baselines untrustworthy. See `load_manifest`.
const MANIFEST_SCHEMA_VERSION: u32 = 1;

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

/// `bytes` with every CRLF turned into LF when it is UTF-8 text, and
/// unchanged otherwise.
///
/// Template sync compares content, not line endings (T-0448). The embedded
/// template carries whatever endings the build's checkout had — CRLF on a
/// Windows checkout with `core.autocrlf` — while a copy in the vault can hold
/// the same text with LF, and a byte-exact comparison reported that as a
/// hand edit. The two conflicts that surfaced were project `_backlog.base`
/// copies with no baseline yet, identical to the template but for endings.
fn normalize_eol(bytes: &[u8]) -> Cow<'_, [u8]> {
    match std::str::from_utf8(bytes) {
        Ok(text) if text.contains("\r\n") => Cow::Owned(text.replace("\r\n", "\n").into_bytes()),
        _ => Cow::Borrowed(bytes),
    }
}

/// The hash template sync records and compares: sha256 of the content with
/// its line endings normalized (see [`normalize_eol`]).
fn content_hash(bytes: &[u8]) -> String {
    sha256_hex(&normalize_eol(bytes))
}

/// True when `a` and `b` hold the same content, line endings aside.
fn same_content(a: &[u8], b: &[u8]) -> bool {
    normalize_eol(a) == normalize_eol(b)
}

/// True when `bytes` is the content a manifest `baseline` recorded.
///
/// Baselines written before T-0448 are sha256 of the raw template bytes,
/// which a hash cannot be normalized after the fact, so for those the content
/// is hashed in both spellings a template ships — all-LF and all-CRLF — as
/// well as raw. Accepting them keeps every existing manifest meaningful
/// without a schema bump; bumping it would drop every baseline, and a managed
/// file the owner edited while the template stayed put would then start
/// reporting `Conflict`.
fn matches_baseline(bytes: &[u8], baseline: &str) -> bool {
    let lf = normalize_eol(bytes);
    if sha256_hex(&lf) == baseline || sha256_hex(bytes) == baseline {
        return true;
    }
    match std::str::from_utf8(&lf) {
        Ok(text) => sha256_hex(text.replace('\n', "\r\n").as_bytes()) == baseline,
        Err(_) => false,
    }
}

/// Recursively collects every embedded template file, skipping `node_modules`
/// directories and files that are never actually part of a vault's copy of
/// the template: the per-vault `.claude-plugin-sync-manifest.json` and the
/// template's own classification file (`.template-policy.json`).
fn walk_template_files<'a>(dir: &'a Dir<'a>, out: &mut Vec<&'a include_dir::File<'a>>) {
    for file in dir.files() {
        let name = file.path().file_name().and_then(|n| n.to_str());
        if name == Some(".claude-plugin-sync-manifest.json") || name == Some(TEMPLATE_POLICY_FILE) {
            continue;
        }
        out.push(file);
    }
    for sub in dir.dirs() {
        if sub.path().file_name().and_then(|n| n.to_str()) == Some("node_modules") {
            continue;
        }
        walk_template_files(sub, out);
    }
}

/// Data-driven replacement for the old `INITIAL_ONLY_PATHS` const, plus the
/// opt-in list of scaffold files whose per-project copies take part in
/// template sync.
///
/// `seed_only` holds paths (repo-relative to the template root) that are
/// seeded into a vault only when missing and are otherwise excluded from the
/// manifest and every `TemplateDiff` — there is nothing to "update" about
/// them, so they can never be silently overwritten by a template sync.
///
/// `project_sync` holds paths relative to `templates/project/`. A project
/// scaffold file is copied into `projects/<slug>/` when the project is
/// created and then lives its own life: a later template update never reached
/// the copies, which is how every project's `backlog/_backlog.base` sat on a
/// dead filter for weeks (T-0263, T-0272). Listing a path here brings each
/// project's copy into the same 3-way diff as any other managed file. It is
/// opt-in because most of the scaffold is prose a project is *meant* to
/// rewrite: listing `README.md` would report a permanent conflict for every
/// project.
#[derive(Debug, Default, serde::Deserialize)]
struct TemplatePolicy {
    #[serde(default)]
    seed_only: HashSet<String>,
    #[serde(default)]
    project_sync: Vec<String>,
}

/// The safe fallback for when the policy file is missing or unparseable:
/// every template file seed-only, so a sync can only ever add a missing file
/// and never overwrite an existing one, and no per-project sync at all.
fn fallback_template_policy(template: &Dir) -> TemplatePolicy {
    let mut files = Vec::new();
    walk_template_files(template, &mut files);
    TemplatePolicy {
        seed_only: files.into_iter().map(|f| norm_path(f.path())).collect(),
        project_sync: Vec::new(),
    }
}

/// Loads `.template-policy.json` from the template root. Missing or
/// unparseable policy data falls back to [`fallback_template_policy`] (the
/// safe direction — never overwrite) and logs the reason to stderr.
fn load_template_policy(template: &Dir) -> TemplatePolicy {
    let Some(file) = template.get_file(TEMPLATE_POLICY_FILE) else {
        crate::diag!(
            "workhub: {TEMPLATE_POLICY_FILE} not found in template; treating every \
             template file as seed-only (safe default)"
        );
        return fallback_template_policy(template);
    };

    let parsed = std::str::from_utf8(file.contents())
        .ok()
        .and_then(|s| serde_json::from_str::<TemplatePolicy>(s).ok());

    match parsed {
        Some(policy) => policy,
        None => {
            crate::diag!(
                "workhub: {TEMPLATE_POLICY_FILE} is unparseable; treating every \
                 template file as seed-only (safe default)"
            );
            fallback_template_policy(template)
        }
    }
}

/// Every per-project copy that takes part in template sync, paired with the
/// scaffold content rendered for that project.
///
/// A project scaffold file is not shareable: `_backlog.base` has to filter on
/// `project == "<slug>"`, so the "same" file is different bytes in every
/// project (T-0272). The comparison template sync needs is therefore not
/// "does the copy match the template" but "does it match the template with
/// this project's placeholders filled in", which is what the rendering here
/// produces.
///
/// Two things are deliberately never done:
///
/// - **No folder is created.** A copy is offered only where its parent
///   directory already exists, so a project that keeps no `backlog/` does not
///   grow one because a Base was added to the scaffold.
/// - **A file carrying `{{DATE}}` is skipped**, with a note to stderr. Its
///   rendering changes every day, so it could never compare equal to what is
///   on disk and would report a conflict forever.
fn project_copies(vault: &Path, template: &Dir, policy: &TemplatePolicy) -> Vec<(String, Vec<u8>)> {
    if policy.project_sync.is_empty() {
        return Vec::new();
    }
    let Some(scaffold) = template.get_dir(PROJECT_TEMPLATE_DIR) else {
        return Vec::new();
    };
    let Ok(slugs) = crate::vault_note::list_projects(vault) else {
        return Vec::new();
    };

    let prefix = format!("{PROJECT_TEMPLATE_DIR}/");
    let mut scaffold_files = Vec::new();
    crate::vault_note::walk_project_template(scaffold, &mut scaffold_files);

    let mut out = Vec::new();
    for rel in &policy.project_sync {
        let Some(file) = scaffold_files
            .iter()
            .find(|f| norm_path(f.path()).strip_prefix(&prefix) == Some(rel.as_str()))
        else {
            crate::diag!(
                "workhub: project_sync lists '{rel}', which is not in the project scaffold"
            );
            continue;
        };
        let Ok(text) = std::str::from_utf8(file.contents()) else {
            crate::diag!("workhub: project_sync lists '{rel}', which is not a text template");
            continue;
        };
        if text.contains("{{DATE}}") {
            crate::diag!(
                "workhub: project_sync skips '{rel}': a template carrying {{{{DATE}}}} renders                  differently every day and can never compare equal to a project's copy"
            );
            continue;
        }

        for slug in &slugs {
            // Resolved by slug rather than joined directly (T-0278): the
            // project's folder may carry a `NNNN-` sort prefix, and a copy
            // written at the bare slug would land beside the real folder
            // instead of inside it.
            let Ok(Some(project_dir)) = crate::vault_note::resolve_project_dir(
                &crate::vault_note::projects_dir(vault),
                slug,
            ) else {
                continue;
            };
            let dst = project_dir.join(rel);
            match dst.parent() {
                Some(parent) if parent.is_dir() => {}
                _ => continue,
            }
            // The scaffold's `<project-slug>` placeholder always renders to
            // the *stripped* slug — the identity `_backlog.base` filters on —
            // never the numbered folder name.
            let name = project_display_name(&project_dir);
            let rendered = crate::vault_note::render_project_scaffold(text, slug, &name);
            let rel_path = dst.strip_prefix(vault).unwrap_or(&dst);
            out.push((norm_path(rel_path), rendered.into_bytes()));
        }
    }
    out
}

/// The project's `title:`, which is what `<Project name>` renders to. Read
/// from `README.md` because that is where the Projects tab reads a project's
/// display name from; the folder's stripped slug stands in when there is
/// none. Takes the project's already-resolved directory rather than its slug,
/// since the caller has typically just resolved one to build `dst` anyway
/// (T-0278).
fn project_display_name(project_dir: &Path) -> String {
    let slug = project_dir
        .file_name()
        .and_then(|n| n.to_str())
        .map(|folder| {
            crate::vault_note::parse_project_folder(folder)
                .1
                .to_string()
        })
        .unwrap_or_default();
    let readme = project_dir.join("README.md");
    let Ok(text) = fs::read_to_string(readme) else {
        return slug;
    };
    let Ok((front, _)) = split_frontmatter(&text) else {
        return slug;
    };
    let title = crate::vault_note::frontmatter_value(&front, "title");
    if title.trim().is_empty() {
        slug
    } else {
        title
    }
}

/// Every path template sync tracks, paired with the content the template says
/// that path should hold: the non-seed-only files of the template itself,
/// then the per-project copies of the scaffold files listed in
/// `project_sync`.
///
/// Diffing, applying and baseline adoption all work off this one list, so a
/// per-project copy is handled by exactly the same code as any other managed
/// file — including the `Conflict` rule that refuses to overwrite something
/// the owner edited by hand.
fn tracked_files(vault: &Path, template: &Dir) -> Vec<(String, Vec<u8>)> {
    let policy = load_template_policy(template);

    let mut files = Vec::new();
    walk_template_files(template, &mut files);

    let mut out: Vec<(String, Vec<u8>)> = files
        .into_iter()
        .map(|f| (norm_path(f.path()), f.contents().to_vec()))
        .filter(|(rel, _)| !policy.seed_only.contains(rel))
        .collect();
    out.extend(project_copies(vault, template, &policy));
    out
}

/// How a tracked path the template no longer ships should be treated.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OrphanKind {
    /// The vault does not have the file either. Nothing to remove; the
    /// manifest entry is stale bookkeeping and can be dropped silently.
    GoneAlready,
    /// The vault still has it, byte-identical to what the template shipped.
    /// Offerable for removal, never removed on its own.
    Untouched,
    /// The vault has it and the owner changed it. The template relinquishes
    /// its claim: the baseline is dropped and the file is left alone,
    /// forever, and it is not even listed.
    Edited,
}

/// Classifies every manifest path the template no longer ships.
///
/// Template sync had only ever looked at what the template *has*, so a path
/// it dropped stayed in the vault and in the manifest indefinitely — the
/// other half of the problem T-0265 fixed (T-0274). Removing the old
/// `templates/project/{deliverables,specs,research}/` left three manifest
/// entries behind, and the pre-`profile/` layout left a pristine
/// `knowledge/profile/decision-policy.md` sitting beside the real one.
///
/// The manifest is what makes this decidable. A path with a baseline is one
/// the template provably put there; a vault file with no baseline is the
/// owner's, and guessing otherwise is how an agent deletes someone's notes.
fn orphan_paths(vault: &Path, template: &Dir) -> Result<Vec<(String, OrphanKind)>, String> {
    let manifest = load_manifest(vault);
    let shipped: HashSet<String> = tracked_files(vault, template)
        .into_iter()
        .map(|(rel, _)| rel)
        .collect();

    let mut out = Vec::new();
    for (rel, baseline) in &manifest.files {
        if shipped.contains(rel) {
            continue;
        }
        let dst_path = vault.join(rel);
        let kind = if !dst_path.exists() {
            OrphanKind::GoneAlready
        } else if matches_baseline(&fs::read(&dst_path).map_err(|e| e.to_string())?, baseline) {
            OrphanKind::Untouched
        } else {
            OrphanKind::Edited
        };
        out.push((rel.clone(), kind));
    }
    // `HashMap` iteration order is arbitrary; the dialog lists these.
    out.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(out)
}

fn manifest_path(vault: &Path) -> PathBuf {
    vault.join("_ai").join("template-manifest.json")
}

#[derive(Debug, Default, Serialize, serde::Deserialize)]
struct TemplateManifest {
    #[serde(default)]
    schema_version: u32,
    app_version: String,
    files: HashMap<String, String>,
}

/// Loads the manifest, discarding recorded baselines from schema versions
/// older than [`MANIFEST_SCHEMA_VERSION`] (including the implicit version 0
/// of a manifest with no `schema_version` field at all, written by <= 0.49.0
/// — see the `init_from` doc comment for why those baselines cannot be
/// trusted). Dropping `files` makes `diff_against` fall into its "no
/// baseline" branch, which is the safe outcome: a file that actually
/// diverged from the template reports `Conflict` instead of a clean
/// `Updatable` overwrite.
fn load_manifest(vault: &Path) -> TemplateManifest {
    let manifest: TemplateManifest = fs::read_to_string(manifest_path(vault))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    if manifest.schema_version < MANIFEST_SCHEMA_VERSION {
        TemplateManifest {
            schema_version: MANIFEST_SCHEMA_VERSION,
            app_version: manifest.app_version,
            files: HashMap::new(),
        }
    } else {
        manifest
    }
}

fn write_manifest(vault: &Path, manifest: &TemplateManifest) -> Result<(), String> {
    let path = manifest_path(vault);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let body = serde_json::to_string_pretty(manifest).map_err(|e| e.to_string())?;
    fs::write(&path, body).map_err(|e| e.to_string())
}

/// Per-file classification produced by [`check_vault_template`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TemplateFileState {
    /// Not present in the vault; safe to add.
    Added,
    /// Vault content matches the recorded baseline and the template changed;
    /// safe to overwrite.
    Updatable,
    /// Vault content diverged from the baseline (hand-edited) and the
    /// template also changed; do not auto-apply.
    Conflict,
    /// No effective change to apply.
    UpToDate,
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct TemplateFileDiff {
    pub path: String,
    pub state: TemplateFileState,
}

/// One path the manifest tracks that the template no longer ships, and whose
/// vault copy is still there and still byte-identical to what the template
/// shipped — so removing it loses nothing that cannot be regenerated.
///
/// Kept out of [`TemplateFileState`] on purpose: removing a file is the
/// opposite operation from writing template content into one, and folding it
/// into that enum would make `apply_vault_template` do two opposite things
/// under one name. Removal has its own command
/// ([`remove_template_orphans`]), and is never part of the silent path.
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct TemplateRemoval {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct TemplateDiff {
    pub files: Vec<TemplateFileDiff>,
    /// Files the template dropped that the vault still has, untouched. Never
    /// applied automatically — the update dialog offers them, unchecked.
    #[serde(default)]
    pub removed: Vec<TemplateRemoval>,
}

/// Copies the embedded `vault-template/` into `vault`, creating directories as
/// needed, then writes `_ai/template-manifest.json` recording a baseline for
/// every non-seed-only file whose on-disk content is confirmed to match the
/// template.
///
/// Existing files are never overwritten by this call — re-running it against
/// an already-initialized vault only fills in files that are still missing.
/// A pre-existing file whose content differs from the just-embedded template
/// (e.g. a user-customized `.claude/project-context.json`) intentionally gets
/// **no** baseline recorded: recording the on-disk content as the baseline
/// would make `diff_against` see `current == baseline` on the next check and
/// misclassify the next upstream template change as a clean `Updatable`
/// overwrite, silently destroying the user's edits (see `CHANGELOG.md`, the
/// data-loss incident this guarded against). Leaving the baseline absent
/// instead falls into `diff_against`'s "no baseline" branch, which correctly
/// reports `Conflict` for a file that differs from the template.
pub fn init_vault(vault: &Path) -> Result<(), String> {
    init_from(vault, &VAULT_TEMPLATE)
}

fn init_from(vault: &Path, template: &Dir) -> Result<(), String> {
    fs::create_dir_all(vault).map_err(|e| e.to_string())?;

    let mut files = Vec::new();
    walk_template_files(template, &mut files);
    let policy = load_template_policy(template);

    let mut manifest = TemplateManifest {
        schema_version: MANIFEST_SCHEMA_VERSION,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        files: HashMap::new(),
    };

    for file in files {
        let rel = norm_path(file.path());
        let dst_path = vault.join(file.path());
        if let Some(parent) = dst_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let existed_before = dst_path.exists();
        if !existed_before {
            fs::write(&dst_path, file.contents()).map_err(|e| e.to_string())?;
        }

        if policy.seed_only.contains(&rel) {
            continue;
        }

        if existed_before {
            // Only record a baseline when the pre-existing file actually
            // matches the template — never when it merely happens to be
            // whatever was already on disk (see the doc comment above).
            let on_disk = fs::read(&dst_path).map_err(|e| e.to_string())?;
            if same_content(&on_disk, file.contents()) {
                manifest.files.insert(rel, content_hash(&on_disk));
            }
        } else {
            // Freshly created: on-disk content is exactly the template's, so
            // recording it as the baseline is always safe.
            manifest.files.insert(rel, content_hash(file.contents()));
        }
    }

    write_manifest(vault, &manifest)
}

/// 3-way compares every non-seed-only template file against the vault's
/// current content and the last-applied baseline recorded in the manifest.
///
/// - `Added`: the vault does not have this file at all.
/// - Otherwise, compare `current` (on disk), `baseline` (manifest), `new`
///   (embedded template):
///   - no baseline recorded: `UpToDate` if `current == new`, else `Conflict`
///     (safer default for a vault that predates the manifest).
///   - `new == baseline`: nothing changed upstream — `UpToDate`.
///   - `current == baseline`: only the template changed — `Updatable`.
///   - otherwise: both diverged — `Conflict`.
///
/// "Equal" ignores line endings throughout (see [`normalize_eol`]).
pub fn check_vault_template(vault: &Path) -> Result<TemplateDiff, String> {
    diff_against(vault, &VAULT_TEMPLATE)
}

fn diff_against(vault: &Path, template: &Dir) -> Result<TemplateDiff, String> {
    let manifest = load_manifest(vault);

    let mut entries = Vec::new();
    for (rel, content) in tracked_files(vault, template) {
        let dst_path = vault.join(&rel);

        // Every comparison here ignores line endings (T-0448): a copy that
        // differs from the template only in CRLF vs LF is not a hand edit.
        let state = if !dst_path.exists() {
            TemplateFileState::Added
        } else {
            let current = fs::read(&dst_path).map_err(|e| e.to_string())?;
            match manifest.files.get(&rel) {
                None => {
                    if same_content(&current, &content) {
                        TemplateFileState::UpToDate
                    } else {
                        TemplateFileState::Conflict
                    }
                }
                Some(baseline_hash) => {
                    if matches_baseline(&content, baseline_hash) {
                        TemplateFileState::UpToDate
                    } else if matches_baseline(&current, baseline_hash) {
                        TemplateFileState::Updatable
                    } else {
                        TemplateFileState::Conflict
                    }
                }
            }
        };

        entries.push(TemplateFileDiff { path: rel, state });
    }

    let removed = orphan_paths(vault, template)?
        .into_iter()
        .filter(|(_, kind)| *kind == OrphanKind::Untouched)
        .map(|(path, _)| TemplateRemoval { path })
        .collect();

    Ok(TemplateDiff {
        files: entries,
        removed,
    })
}

/// Applies the embedded template content for exactly the given relative
/// paths. A path currently in `Conflict` that the caller did NOT list in
/// `overwrite` keeps the vault's file untouched and only advances that
/// path's manifest baseline to the new template hash (dismiss-this-version:
/// the next check reports `UpToDate` until the template changes again, at
/// which point it reports `Conflict` again). A path listed in `overwrite`
/// is the user's explicit choice to discard local edits: the current
/// on-disk content is first saved beside the original as `<name>.bak`
/// (overwriting any previous `.bak`), then the template content is
/// written in place like any other path. Every other requested path is
/// overwritten/created in place with no backup — an `Added` path has no
/// prior content and an `Updatable` one still matches the baseline, so
/// neither can lose user edits. Unknown paths (not part of the template,
/// or seed-only) are silently skipped.
pub fn apply_vault_template(
    vault: &Path,
    paths: &[String],
    overwrite: &[String],
) -> Result<(), String> {
    apply_from(vault, &VAULT_TEMPLATE, paths, overwrite)
}

fn apply_from(
    vault: &Path,
    template: &Dir,
    paths: &[String],
    overwrite: &[String],
) -> Result<(), String> {
    let diff = diff_against(vault, template)?;
    let states: HashMap<&str, TemplateFileState> = diff
        .files
        .iter()
        .map(|f| (f.path.as_str(), f.state))
        .collect();

    // Per-project copies are not files of the template — they are the
    // template rendered for one project — so the content to write comes from
    // `tracked_files`, which covers both kinds under one key space.
    let contents: HashMap<String, Vec<u8>> = tracked_files(vault, template).into_iter().collect();

    let mut manifest = load_manifest(vault);
    manifest.schema_version = MANIFEST_SCHEMA_VERSION;
    manifest.app_version = env!("CARGO_PKG_VERSION").to_string();

    for rel in paths {
        let Some(state) = states.get(rel.as_str()).copied() else {
            continue;
        };
        let Some(content) = contents.get(rel) else {
            continue;
        };

        let dst_path = vault.join(rel);
        if let Some(parent) = dst_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        if state == TemplateFileState::Conflict && !overwrite.iter().any(|p| p == rel) {
            // Dismiss-this-version: the vault's file stays exactly as the
            // owner left it; only the baseline moves to the new template
            // hash, so this path stays quiet until the template changes
            // again. No side file is written.
            manifest.files.insert(rel.clone(), content_hash(content));
            continue;
        }

        if state == TemplateFileState::Conflict {
            // Explicit overwrite of a hand-edited file: keep a single
            // recoverable copy of what the owner had before replacing it.
            if dst_path.exists() {
                let current = fs::read(&dst_path).map_err(|e| e.to_string())?;
                if !same_content(&current, content) {
                    let backup_name = format!(
                        "{}.bak",
                        dst_path
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("template")
                    );
                    fs::write(dst_path.with_file_name(backup_name), &current)
                        .map_err(|e| e.to_string())?;
                }
            }
        }

        fs::write(&dst_path, content).map_err(|e| e.to_string())?;
        manifest.files.insert(rel.clone(), content_hash(content));
    }

    write_manifest(vault, &manifest)
}

/// Applies every template update that provably cannot destroy user content:
/// the files the vault is missing (`Added`) and the ones whose vault copy
/// still matches the recorded baseline byte-for-byte (`Updatable`). A file in
/// `Conflict` is never touched — the user hand-edited it, so resolving it
/// stays an explicit choice made in the update dialog.
///
/// This is what lets the app roll a new template out silently (T-0196):
/// prompting for changes that cannot lose anything was pure friction, while
/// the conflict case still asks.
///
/// It also seeds any seed-only file the vault is missing, so a file added to
/// the template after a vault was created still reaches it.
///
/// Returns the relative paths that were written, in template walk order.
pub fn apply_safe_template_updates(vault: &Path) -> Result<Vec<String>, String> {
    apply_safe_from(vault, &VAULT_TEMPLATE)
}

fn apply_safe_from(vault: &Path, template: &Dir) -> Result<Vec<String>, String> {
    // Seed-only files are excluded from every diff, so a seed-only file added
    // to the template after a vault was initialized would otherwise never
    // reach that vault — `init_vault` runs once, at creation. Creating a file
    // the vault does not have cannot destroy anything, so it belongs in the
    // silent path. Like `init_from`, this records no baseline for them: they
    // are never compared again.
    let mut written = seed_missing_files(vault, template)?;

    // A vault that predates the manifest — or a file the owner brought into
    // line with the template by hand — has no baseline recorded, which makes
    // every future template change report `Conflict` for it. Adopting a
    // baseline where the content already matches fixes that, and is the case
    // this task turns on: the seven project Bases were hand-corrected in
    // T-0263/T-0272 and would otherwise never take another update quietly.
    adopt_matching_baselines(vault, template)?;
    // Bookkeeping only: a stale entry for a file that is already gone, and a
    // baseline the template has no further claim to. No file is deleted here
    // — a destructive step never rides the silent path.
    drop_stale_baselines(vault, template)?;

    let diff = diff_against(vault, template)?;
    let safe: Vec<String> = diff
        .files
        .iter()
        .filter(|f| {
            matches!(
                f.state,
                TemplateFileState::Added | TemplateFileState::Updatable
            )
        })
        .map(|f| f.path.clone())
        .collect();

    if !safe.is_empty() {
        // `overwrite` stays empty: none of these paths is a Conflict, so there
        // is nothing for it to authorize.
        apply_from(vault, template, &safe, &[])?;
        written.extend(safe);
    }

    Ok(written)
}

/// Records a baseline for every tracked path with no baseline yet whose
/// on-disk content already equals what the template says it should hold.
///
/// This cannot lose anything. The recorded hash is the hash of content that
/// is byte-for-byte on disk right now, so the next check sees
/// `current == baseline` and classifies an upstream change as `Updatable` —
/// which is the truth: the owner has not diverged from the template. It is
/// the same argument that lets `init_from` record a baseline for a file it
/// just wrote. A path whose content differs is left alone and keeps
/// reporting `Conflict`, which is also the truth.
fn adopt_matching_baselines(vault: &Path, template: &Dir) -> Result<(), String> {
    let mut manifest = load_manifest(vault);
    let mut changed = false;

    for (rel, content) in tracked_files(vault, template) {
        if manifest.files.contains_key(&rel) {
            continue;
        }
        let dst_path = vault.join(&rel);
        if !dst_path.exists() {
            continue;
        }
        if !same_content(&fs::read(&dst_path).map_err(|e| e.to_string())?, &content) {
            continue;
        }
        manifest.files.insert(rel, content_hash(&content));
        changed = true;
    }

    if changed {
        manifest.schema_version = MANIFEST_SCHEMA_VERSION;
        manifest.app_version = env!("CARGO_PKG_VERSION").to_string();
        write_manifest(vault, &manifest)?;
    }
    Ok(())
}

/// Drops the manifest baselines that no longer mean anything: a path the
/// template stopped shipping whose vault copy is already gone, and one the
/// owner has since edited.
///
/// Neither case deletes a file. The first is pure bookkeeping. The second is
/// the template letting go: once the owner has changed a file the template no
/// longer ships, it is theirs, and keeping a baseline for it only invites a
/// later version of this code to think it has a say. Dropping it is also the
/// safe direction — if the template ever ships that path again, no baseline
/// means `Conflict`, not a silent overwrite.
fn drop_stale_baselines(vault: &Path, template: &Dir) -> Result<(), String> {
    let orphans = orphan_paths(vault, template)?;
    if orphans.is_empty() {
        return Ok(());
    }

    let mut manifest = load_manifest(vault);
    let mut changed = false;
    for (rel, kind) in orphans {
        match kind {
            OrphanKind::Untouched => continue,
            OrphanKind::Edited => crate::diag!(
                "workhub: '{rel}' is no longer in the template and was edited here;                  leaving it alone and dropping its baseline"
            ),
            OrphanKind::GoneAlready => {}
        }
        manifest.files.remove(&rel);
        changed = true;
    }

    if changed {
        manifest.schema_version = MANIFEST_SCHEMA_VERSION;
        manifest.app_version = env!("CARGO_PKG_VERSION").to_string();
        write_manifest(vault, &manifest)?;
    }
    Ok(())
}

/// Removes exactly the listed files the template no longer ships, and drops
/// their manifest entries.
///
/// Every path is re-classified here rather than trusted from the caller: the
/// dialog's list can be minutes old, and the file may have been edited since.
/// A path that is not `Untouched` at this instant is skipped, so the worst a
/// stale selection can do is nothing. Returns the paths actually removed.
///
/// **Directories are never removed**, only files. An emptied folder is
/// harmless, while deciding a folder is "empty enough" to delete is how a
/// cleanup step reaches somewhere it was never asked to go.
pub fn remove_template_orphans(vault: &Path, paths: &[String]) -> Result<Vec<String>, String> {
    remove_orphans_from(vault, &VAULT_TEMPLATE, paths)
}

fn remove_orphans_from(
    vault: &Path,
    template: &Dir,
    paths: &[String],
) -> Result<Vec<String>, String> {
    let removable: HashSet<String> = orphan_paths(vault, template)?
        .into_iter()
        .filter(|(_, kind)| *kind == OrphanKind::Untouched)
        .map(|(rel, _)| rel)
        .collect();

    let mut manifest = load_manifest(vault);
    let mut removed = Vec::new();
    for rel in paths {
        if !removable.contains(rel) {
            crate::diag!("workhub: not removing '{rel}': it is not an untouched template leftover");
            continue;
        }
        fs::remove_file(vault.join(rel)).map_err(|e| e.to_string())?;
        manifest.files.remove(rel);
        removed.push(rel.clone());
    }

    if !removed.is_empty() {
        manifest.schema_version = MANIFEST_SCHEMA_VERSION;
        manifest.app_version = env!("CARGO_PKG_VERSION").to_string();
        write_manifest(vault, &manifest)?;
    }
    Ok(removed)
}

/// Keeps exactly the listed files the template no longer ships, and drops
/// their manifest entries so they are never offered for removal again.
///
/// This is the persistent counterpart to leaving an orphan unchecked in the
/// update dialog (which only dismisses the banner for the session): the
/// file stays exactly as it is, and the template relinquishes its claim to
/// it — the same thing that happens automatically for an orphan the owner
/// has edited (see `drop_stale_baselines`).
///
/// Every path is re-classified here rather than trusted from the caller.
/// A path that no longer has a manifest entry, or that the template ships
/// again, is skipped. Returns the paths actually retained. No file is
/// written or deleted.
pub fn retain_template_orphans(vault: &Path, paths: &[String]) -> Result<Vec<String>, String> {
    retain_orphans_from(vault, &VAULT_TEMPLATE, paths)
}

fn retain_orphans_from(
    vault: &Path,
    template: &Dir,
    paths: &[String],
) -> Result<Vec<String>, String> {
    let orphans: HashMap<String, OrphanKind> = orphan_paths(vault, template)?.into_iter().collect();

    let mut manifest = load_manifest(vault);
    let mut retained = Vec::new();
    for rel in paths {
        match orphans.get(rel) {
            Some(OrphanKind::Untouched)
            | Some(OrphanKind::Edited)
            | Some(OrphanKind::GoneAlready) => {
                manifest.files.remove(rel);
                retained.push(rel.clone());
            }
            None => {
                crate::diag!("workhub: not retaining '{rel}': it is not a known template leftover");
            }
        }
    }

    if !retained.is_empty() {
        manifest.schema_version = MANIFEST_SCHEMA_VERSION;
        manifest.app_version = env!("CARGO_PKG_VERSION").to_string();
        write_manifest(vault, &manifest)?;
    }
    Ok(retained)
}

/// Writes the seed-only template files the vault is missing, leaving every
/// existing file untouched. Returns the paths actually created.
fn seed_missing_files(vault: &Path, template: &Dir) -> Result<Vec<String>, String> {
    let mut files = Vec::new();
    walk_template_files(template, &mut files);
    let policy = load_template_policy(template);

    let mut created = Vec::new();
    for file in files {
        let rel = norm_path(file.path());
        if !policy.seed_only.contains(&rel) {
            continue;
        }
        let dst_path = vault.join(file.path());
        if dst_path.exists() {
            continue;
        }
        if let Some(parent) = dst_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&dst_path, file.contents()).map_err(|e| e.to_string())?;
        created.push(rel);
    }
    Ok(created)
}

/// Renders a unified diff between the vault's current copy of `path` and the
/// embedded template's version of it, so the update dialog can show what an
/// overwrite would actually change before the user discards local edits.
///
/// The vault side is empty when the file does not exist yet (an `Added`
/// path), which renders as a pure addition. Returns an error for a path that
/// is not part of the template, or whose vault copy is not valid UTF-8.
pub fn template_file_diff(vault: &Path, path: &str) -> Result<String, String> {
    template_file_diff_from(vault, &VAULT_TEMPLATE, path)
}

fn template_file_diff_from(vault: &Path, template: &Dir, path: &str) -> Result<String, String> {
    // Tracked first, so a per-project copy diffs against its *rendered*
    // content rather than the placeholder text. A seed-only path is not
    // tracked but is still a real template file, so it falls back.
    let content = tracked_files(vault, template)
        .into_iter()
        .find(|(rel, _)| rel == path)
        .map(|(_, content)| content)
        .or_else(|| template.get_file(path).map(|f| f.contents().to_vec()))
        .ok_or_else(|| format!("{path} is not part of the vault template"))?;
    let new = std::str::from_utf8(&content).map_err(|_| format!("{path} is not a text file"))?;

    let dst_path = vault.join(path);
    let current = if dst_path.exists() {
        fs::read_to_string(&dst_path).map_err(|_| format!("{path} is not a text file"))?
    } else {
        String::new()
    };

    // Line endings are not compared anywhere in template sync (T-0448), so
    // the diff does not show them either — a CRLF copy of LF text would
    // otherwise render as every line changed.
    let current = current.replace("\r\n", "\n");
    let new = new.replace("\r\n", "\n");

    let mut out = format!("--- {path} (vault)\n+++ {path} (template)\n");
    for hunk in TextDiff::from_lines(current.as_str(), new.as_str())
        .unified_diff()
        .iter_hunks()
    {
        out.push_str(&hunk.to_string());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------
    // template sync (init_vault / check_vault_template / apply_vault_template)
    // -------------------------------------------------------------------
    //
    // `include_dir::Dir` and `File` are `const fn`-constructible, so tests
    // build a small synthetic template tree instead of exercising the real
    // (large, fast-moving) `vault-template/`. The `*_from`/`*_against`
    // internals take the template `Dir` as a parameter for exactly this
    // reason — the public `init_vault`/`check_vault_template`/
    // `apply_vault_template` just plug in the real embedded `VAULT_TEMPLATE`.

    use include_dir::{Dir, DirEntry, File};

    static TEST_TEMPLATE: Dir<'_> = Dir::new(
        "",
        &[
            DirEntry::File(File::new("added.md", b"added-content")),
            DirEntry::File(File::new("stable.md", b"stable-content")),
            DirEntry::File(File::new("changed.md", b"changed-content-v2")),
            DirEntry::File(File::new("home.md", b"home-content")),
            DirEntry::File(File::new(
                ".template-policy.json",
                br#"{"seed_only": ["home.md"]}"#,
            )),
        ],
    );

    fn temp_test_vault(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("workhub-template-test-{name}-{nanos}"))
    }

    fn diff_state(diff: &TemplateDiff, path: &str) -> Option<TemplateFileState> {
        diff.files.iter().find(|f| f.path == path).map(|f| f.state)
    }

    // A second synthetic template carrying a project scaffold, for the
    // per-project copy sync (T-0265). `dated.md` exists to prove a template
    // carrying `{{DATE}}` is refused: its rendering changes daily, so it
    // could never compare equal to a copy on disk.
    static PROJECT_TEST_TEMPLATE: Dir<'_> = Dir::new(
        "",
        &[
            DirEntry::File(File::new(
                ".template-policy.json",
                br#"{"seed_only": [], "project_sync": ["backlog/_backlog.base", "dated.md"]}"#,
            )),
            DirEntry::Dir(Dir::new(
                "templates",
                &[DirEntry::Dir(Dir::new(
                    "templates/project",
                    &[
                        DirEntry::File(File::new(
                            "templates/project/dated.md",
                            b"created: {{DATE}}",
                        )),
                        DirEntry::Dir(Dir::new(
                            "templates/project/backlog",
                            &[DirEntry::File(File::new(
                                "templates/project/backlog/_backlog.base",
                                b"filter: project == '<project-slug>' v2",
                            ))],
                        )),
                    ],
                ))],
            )),
        ],
    );

    const COPY_PATH: &str = "projects/alpha/backlog/_backlog.base";

    /// Creates `projects/<slug>/`, optionally with the `backlog/` folder a
    /// synced copy needs as its parent.
    fn make_project(vault: &Path, slug: &str, with_backlog: bool) {
        let dir = vault.join("projects").join(slug);
        fs::create_dir_all(&dir).unwrap();
        if with_backlog {
            fs::create_dir_all(dir.join("backlog")).unwrap();
        }
    }

    #[test]
    fn project_copy_is_updatable_when_it_still_matches_its_baseline() {
        let vault = temp_test_vault("copy-updatable");
        make_project(&vault, "alpha", true);
        fs::write(vault.join(COPY_PATH), "filter: project == 'alpha' v1").unwrap();
        let mut manifest = TemplateManifest {
            schema_version: MANIFEST_SCHEMA_VERSION,
            app_version: "test".into(),
            files: HashMap::new(),
        };
        manifest.files.insert(
            COPY_PATH.into(),
            sha256_hex(b"filter: project == 'alpha' v1"),
        );
        write_manifest(&vault, &manifest).unwrap();

        let diff = diff_against(&vault, &PROJECT_TEST_TEMPLATE).unwrap();

        assert_eq!(
            diff_state(&diff, COPY_PATH),
            Some(TemplateFileState::Updatable)
        );

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn project_copy_is_a_conflict_once_it_was_hand_edited() {
        let vault = temp_test_vault("copy-conflict");
        make_project(&vault, "alpha", true);
        fs::write(vault.join(COPY_PATH), "hand-edited by the owner").unwrap();
        let mut manifest = TemplateManifest {
            schema_version: MANIFEST_SCHEMA_VERSION,
            app_version: "test".into(),
            files: HashMap::new(),
        };
        manifest.files.insert(
            COPY_PATH.into(),
            sha256_hex(b"filter: project == 'alpha' v1"),
        );
        write_manifest(&vault, &manifest).unwrap();

        let diff = diff_against(&vault, &PROJECT_TEST_TEMPLATE).unwrap();

        assert_eq!(
            diff_state(&diff, COPY_PATH),
            Some(TemplateFileState::Conflict)
        );
        // And applying it leaves the owner's file alone.
        apply_from(
            &vault,
            &PROJECT_TEST_TEMPLATE,
            &[COPY_PATH.to_string()],
            &[],
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(vault.join(COPY_PATH)).unwrap(),
            "hand-edited by the owner"
        );

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn applying_a_project_copy_renders_that_project_s_slug() {
        let vault = temp_test_vault("copy-renders-slug");
        make_project(&vault, "alpha", true);

        let diff = diff_against(&vault, &PROJECT_TEST_TEMPLATE).unwrap();
        assert_eq!(diff_state(&diff, COPY_PATH), Some(TemplateFileState::Added));

        apply_from(
            &vault,
            &PROJECT_TEST_TEMPLATE,
            &[COPY_PATH.to_string()],
            &[],
        )
        .unwrap();

        let written = fs::read_to_string(vault.join(COPY_PATH)).unwrap();
        assert_eq!(written, "filter: project == 'alpha' v2");
        assert!(
            !written.contains("<project-slug>"),
            "the placeholder must not survive into the copy"
        );

        fs::remove_dir_all(&vault).ok();
    }

    /// A project folder carrying a `NNNN-` sort prefix (T-0278) still renders
    /// its *stripped* slug into the copy — `_backlog.base`'s filter has to
    /// read `project == "alpha"`, never `project == "0010-alpha"`, since a
    /// task's own `project:` is always the stripped form.
    #[test]
    fn applying_a_project_copy_renders_the_stripped_slug_for_a_numbered_folder() {
        let vault = temp_test_vault("copy-renders-numbered-slug");
        fs::create_dir_all(vault.join("projects/0010-alpha/backlog")).unwrap();
        let copy_path = "projects/0010-alpha/backlog/_backlog.base";

        let diff = diff_against(&vault, &PROJECT_TEST_TEMPLATE).unwrap();
        assert_eq!(diff_state(&diff, copy_path), Some(TemplateFileState::Added));

        apply_from(
            &vault,
            &PROJECT_TEST_TEMPLATE,
            &[copy_path.to_string()],
            &[],
        )
        .unwrap();

        let written = fs::read_to_string(vault.join(copy_path)).unwrap();
        assert_eq!(written, "filter: project == 'alpha' v2");

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn a_project_without_the_parent_folder_never_grows_the_copy() {
        let vault = temp_test_vault("copy-no-folder");
        make_project(&vault, "beta", false);

        let diff = diff_against(&vault, &PROJECT_TEST_TEMPLATE).unwrap();

        assert_eq!(
            diff_state(&diff, "projects/beta/backlog/_backlog.base"),
            None,
            "a project that keeps no backlog/ must not be offered one"
        );
        apply_safe_from(&vault, &PROJECT_TEST_TEMPLATE).unwrap();
        assert!(!vault.join("projects/beta/backlog").exists());

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn project_sync_refuses_a_template_carrying_a_date_placeholder() {
        let vault = temp_test_vault("copy-dated");
        make_project(&vault, "alpha", true);

        let diff = diff_against(&vault, &PROJECT_TEST_TEMPLATE).unwrap();

        assert_eq!(
            diff_state(&diff, "projects/alpha/dated.md"),
            None,
            "a daily-changing rendering could never compare equal"
        );

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn apply_safe_adopts_a_baseline_when_the_copy_already_matches() {
        let vault = temp_test_vault("copy-adopt");
        make_project(&vault, "alpha", true);
        // The owner already brought this copy into line by hand (T-0263), so
        // it matches the template but has no baseline recorded.
        fs::write(vault.join(COPY_PATH), "filter: project == 'alpha' v2").unwrap();
        assert!(!load_manifest(&vault).files.contains_key(COPY_PATH));

        apply_safe_from(&vault, &PROJECT_TEST_TEMPLATE).unwrap();

        assert_eq!(
            load_manifest(&vault).files.get(COPY_PATH),
            Some(&sha256_hex(b"filter: project == 'alpha' v2")),
            "a matching copy must record a baseline so the next update is quiet"
        );

        fs::remove_dir_all(&vault).ok();
    }

    // -------------------------------------------------------------------
    // template leftovers (T-0274)
    // -------------------------------------------------------------------

    /// Records a baseline for `rel` as if the template had once shipped
    /// `content` there, which is what makes a path an *orphan* rather than
    /// just a file the app has never seen.
    fn seed_baseline(vault: &Path, rel: &str, content: &[u8]) {
        let mut manifest = load_manifest(vault);
        manifest.schema_version = MANIFEST_SCHEMA_VERSION;
        manifest.files.insert(rel.into(), sha256_hex(content));
        write_manifest(vault, &manifest).unwrap();
    }

    const GONE: &str = "dropped/old.md";

    #[test]
    fn an_untouched_leftover_is_offered_for_removal() {
        let vault = temp_test_vault("orphan-untouched");
        fs::create_dir_all(vault.join("dropped")).unwrap();
        fs::write(vault.join(GONE), "shipped-content").unwrap();
        seed_baseline(&vault, GONE, b"shipped-content");

        let diff = diff_against(&vault, &TEST_TEMPLATE).unwrap();

        assert_eq!(
            diff.removed
                .iter()
                .map(|r| r.path.as_str())
                .collect::<Vec<_>>(),
            vec![GONE]
        );
        // Offered, but never removed by the silent path.
        apply_safe_from(&vault, &TEST_TEMPLATE).unwrap();
        assert!(
            vault.join(GONE).exists(),
            "the silent path must never delete"
        );

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn an_edited_leftover_is_never_listed_and_never_removed() {
        let vault = temp_test_vault("orphan-edited");
        fs::create_dir_all(vault.join("dropped")).unwrap();
        fs::write(vault.join(GONE), "the owner rewrote this").unwrap();
        seed_baseline(&vault, GONE, b"shipped-content");

        let diff = diff_against(&vault, &TEST_TEMPLATE).unwrap();
        assert!(
            diff.removed.is_empty(),
            "an edited leftover is the owner's file"
        );

        // Even asked for by name, it is refused.
        let removed = remove_orphans_from(&vault, &TEST_TEMPLATE, &[GONE.to_string()]).unwrap();
        assert!(removed.is_empty());
        assert_eq!(
            fs::read_to_string(vault.join(GONE)).unwrap(),
            "the owner rewrote this"
        );
        // The template lets go of it: the baseline is dropped, the file stays.
        apply_safe_from(&vault, &TEST_TEMPLATE).unwrap();
        assert!(!load_manifest(&vault).files.contains_key(GONE));
        assert!(vault.join(GONE).exists());

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn a_baseline_for_a_file_that_is_already_gone_is_dropped_silently() {
        let vault = temp_test_vault("orphan-bookkeeping");
        fs::create_dir_all(&vault).unwrap();
        seed_baseline(&vault, GONE, b"shipped-content");

        let diff = diff_against(&vault, &TEST_TEMPLATE).unwrap();
        assert!(diff.removed.is_empty(), "there is no file to offer");

        apply_safe_from(&vault, &TEST_TEMPLATE).unwrap();

        assert!(!load_manifest(&vault).files.contains_key(GONE));

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn removing_a_leftover_drops_its_baseline_but_keeps_the_folder() {
        let vault = temp_test_vault("orphan-remove");
        fs::create_dir_all(vault.join("dropped")).unwrap();
        fs::write(vault.join(GONE), "shipped-content").unwrap();
        seed_baseline(&vault, GONE, b"shipped-content");

        let removed = remove_orphans_from(&vault, &TEST_TEMPLATE, &[GONE.to_string()]).unwrap();

        assert_eq!(removed, vec![GONE.to_string()]);
        assert!(!vault.join(GONE).exists());
        assert!(!load_manifest(&vault).files.contains_key(GONE));
        assert!(
            vault.join("dropped").is_dir(),
            "directories are never removed, only files"
        );

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn retaining_a_leftover_keeps_the_file_and_drops_its_baseline() {
        let vault = temp_test_vault("orphan-retain");
        fs::create_dir_all(vault.join("dropped")).unwrap();
        fs::write(vault.join(GONE), "shipped-content").unwrap();
        seed_baseline(&vault, GONE, b"shipped-content");

        let retained = retain_orphans_from(&vault, &TEST_TEMPLATE, &[GONE.to_string()]).unwrap();

        assert_eq!(retained, vec![GONE.to_string()]);
        assert_eq!(
            fs::read_to_string(vault.join(GONE)).unwrap(),
            "shipped-content",
            "retaining must not touch the file"
        );
        assert!(!load_manifest(&vault).files.contains_key(GONE));
        // Never offered again.
        let diff = diff_against(&vault, &TEST_TEMPLATE).unwrap();
        assert!(
            diff.removed.iter().all(|r| r.path != GONE),
            "a retained leftover must vanish from the removal offer"
        );

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn retaining_an_unknown_path_retains_nothing() {
        let vault = temp_test_vault("orphan-retain-unknown");
        fs::create_dir_all(&vault).unwrap();

        let retained =
            retain_orphans_from(&vault, &TEST_TEMPLATE, &["nope.md".to_string()]).unwrap();

        assert!(retained.is_empty());

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn a_stale_selection_removes_nothing_once_the_file_has_changed() {
        let vault = temp_test_vault("orphan-stale");
        fs::create_dir_all(vault.join("dropped")).unwrap();
        fs::write(vault.join(GONE), "shipped-content").unwrap();
        seed_baseline(&vault, GONE, b"shipped-content");
        // The dialog listed it, then the owner edited it before confirming.
        fs::write(vault.join(GONE), "edited after the dialog opened").unwrap();

        let removed = remove_orphans_from(&vault, &TEST_TEMPLATE, &[GONE.to_string()]).unwrap();

        assert!(removed.is_empty());
        assert_eq!(
            fs::read_to_string(vault.join(GONE)).unwrap(),
            "edited after the dialog opened"
        );

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn a_file_the_template_still_ships_is_never_a_leftover() {
        let vault = temp_test_vault("orphan-not");
        fs::create_dir_all(&vault).unwrap();
        init_from(&vault, &TEST_TEMPLATE).unwrap();

        let diff = diff_against(&vault, &TEST_TEMPLATE).unwrap();

        assert!(diff.removed.is_empty());
        apply_safe_from(&vault, &TEST_TEMPLATE).unwrap();
        assert!(vault.join("stable.md").exists());
        assert!(load_manifest(&vault).files.contains_key("stable.md"));

        fs::remove_dir_all(&vault).ok();
    }

    /// Guards the real `.template-policy.json` rather than a synthetic one: a
    /// typo in `project_sync` has no visible symptom — the feature simply
    /// does nothing, which is the exact failure mode T-0265 exists to end.
    #[test]
    fn every_real_project_sync_path_is_a_usable_scaffold_file() {
        let policy = load_template_policy(&VAULT_TEMPLATE);
        let scaffold = project_template().expect("the project scaffold is embedded");
        let prefix = format!("{PROJECT_TEMPLATE_DIR}/");
        let mut files = Vec::new();
        crate::vault_note::walk_project_template(scaffold, &mut files);

        assert!(
            !policy.project_sync.is_empty(),
            "project_sync is what carries a scaffold change to existing projects"
        );
        for rel in &policy.project_sync {
            let file = files
                .iter()
                .find(|f| norm_path(f.path()).strip_prefix(&prefix) == Some(rel.as_str()))
                .unwrap_or_else(|| panic!("project_sync lists '{rel}', not in templates/project/"));
            let text = std::str::from_utf8(file.contents())
                .unwrap_or_else(|_| panic!("project_sync lists '{rel}', which is not text"));
            assert!(
                !text.contains("{{DATE}}"),
                "'{rel}' renders differently every day, so it can never be synced"
            );
        }
    }

    #[test]
    fn an_empty_project_sync_list_adds_no_project_paths() {
        let vault = temp_test_vault("copy-opt-out");
        make_project(&vault, "alpha", true);

        let diff = diff_against(&vault, &TEST_TEMPLATE).unwrap();

        assert!(
            !diff.files.iter().any(|f| f.path.starts_with("projects/")),
            "a template that opts out must behave exactly as before"
        );

        fs::remove_dir_all(&vault).ok();
    }

    // Line endings are not content (T-0448). The embedded template carries
    // CRLF when it was built from a Windows checkout with `core.autocrlf`,
    // while the vault's copy can hold the same text with LF.
    static CRLF_TEMPLATE: Dir<'_> = Dir::new(
        "",
        &[
            DirEntry::File(File::new("note.md", b"line one\r\nline two\r\n")),
            DirEntry::File(File::new(".template-policy.json", br#"{"seed_only": []}"#)),
        ],
    );

    static CRLF_TEMPLATE_V2: Dir<'_> = Dir::new(
        "",
        &[
            DirEntry::File(File::new("note.md", b"line one\r\nline two v2\r\n")),
            DirEntry::File(File::new(".template-policy.json", br#"{"seed_only": []}"#)),
        ],
    );

    fn write_baseline(vault: &Path, rel: &str, hash: String) {
        let mut manifest = TemplateManifest {
            schema_version: MANIFEST_SCHEMA_VERSION,
            app_version: "test".into(),
            files: HashMap::new(),
        };
        manifest.files.insert(rel.into(), hash);
        write_manifest(vault, &manifest).unwrap();
    }

    #[test]
    fn a_copy_differing_only_in_line_endings_is_up_to_date_without_a_baseline() {
        let vault = temp_test_vault("eol-no-baseline");
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("note.md"), "line one\nline two\n").unwrap();

        let diff = diff_against(&vault, &CRLF_TEMPLATE).unwrap();

        assert_eq!(
            diff_state(&diff, "note.md"),
            Some(TemplateFileState::UpToDate),
            "LF vs CRLF is not a hand edit"
        );

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn a_crlf_copy_of_an_lf_template_is_up_to_date_without_a_baseline() {
        static LF_TEMPLATE: Dir<'_> = Dir::new(
            "",
            &[
                DirEntry::File(File::new("note.md", b"line one\nline two\n")),
                DirEntry::File(File::new(".template-policy.json", br#"{"seed_only": []}"#)),
            ],
        );
        let vault = temp_test_vault("eol-reverse");
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("note.md"), "line one\r\nline two\r\n").unwrap();

        let diff = diff_against(&vault, &LF_TEMPLATE).unwrap();

        assert_eq!(
            diff_state(&diff, "note.md"),
            Some(TemplateFileState::UpToDate)
        );

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn apply_safe_adopts_a_baseline_for_a_copy_differing_only_in_line_endings() {
        let vault = temp_test_vault("eol-adopt");
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("note.md"), "line one\nline two\n").unwrap();

        apply_safe_from(&vault, &CRLF_TEMPLATE).unwrap();

        assert_eq!(
            fs::read_to_string(vault.join("note.md")).unwrap(),
            "line one\nline two\n",
            "adopting a baseline must not rewrite the file"
        );
        assert_eq!(
            load_manifest(&vault).files.get("note.md"),
            Some(&content_hash(b"line one\nline two\n"))
        );
        // With the baseline adopted, the next template change is a quiet update.
        let diff = diff_against(&vault, &CRLF_TEMPLATE_V2).unwrap();
        assert_eq!(
            diff_state(&diff, "note.md"),
            Some(TemplateFileState::Updatable)
        );

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn a_raw_hash_baseline_from_before_eol_normalization_still_matches() {
        let vault = temp_test_vault("eol-legacy-baseline");
        fs::create_dir_all(&vault).unwrap();
        // The copy was rewritten with LF after a CRLF template was applied,
        // and the manifest holds the raw CRLF hash an older build recorded.
        fs::write(vault.join("note.md"), "line one\nline two\n").unwrap();
        write_baseline(&vault, "note.md", sha256_hex(b"line one\r\nline two\r\n"));

        let diff = diff_against(&vault, &CRLF_TEMPLATE).unwrap();
        assert_eq!(
            diff_state(&diff, "note.md"),
            Some(TemplateFileState::UpToDate)
        );
        let diff = diff_against(&vault, &CRLF_TEMPLATE_V2).unwrap();
        assert_eq!(
            diff_state(&diff, "note.md"),
            Some(TemplateFileState::Updatable),
            "the owner changed nothing but the endings, so the update is safe"
        );

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn a_real_edit_is_still_a_conflict_whatever_its_line_endings() {
        let vault = temp_test_vault("eol-real-edit");
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("note.md"), "line one\nmy own line\n").unwrap();
        write_baseline(&vault, "note.md", sha256_hex(b"line one\r\nline two\r\n"));

        let diff = diff_against(&vault, &CRLF_TEMPLATE_V2).unwrap();

        assert_eq!(
            diff_state(&diff, "note.md"),
            Some(TemplateFileState::Conflict)
        );

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn the_template_diff_ignores_line_endings() {
        let vault = temp_test_vault("eol-diff");
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("note.md"), "line one\nline two\n").unwrap();

        let diff = template_file_diff_from(&vault, &CRLF_TEMPLATE, "note.md").unwrap();

        assert_eq!(diff, "--- note.md (vault)\n+++ note.md (template)\n");

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn init_writes_files_and_baseline_manifest() {
        let vault = temp_test_vault("init");

        init_from(&vault, &TEST_TEMPLATE).unwrap();

        assert!(vault.join("added.md").exists());
        assert!(vault.join("home.md").exists());
        let manifest = load_manifest(&vault);
        assert_eq!(
            manifest.files.get("stable.md").unwrap(),
            &sha256_hex(b"stable-content")
        );
        // Initial-only files are copied but excluded from the manifest.
        assert!(!manifest.files.contains_key("home.md"));

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn init_never_overwrites_existing_files() {
        let vault = temp_test_vault("init-preserve");
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("home.md"), "hand-written home").unwrap();

        init_from(&vault, &TEST_TEMPLATE).unwrap();

        assert_eq!(
            fs::read_to_string(vault.join("home.md")).unwrap(),
            "hand-written home"
        );

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn diff_reports_added_for_missing_file() {
        let vault = temp_test_vault("diff-added");
        fs::create_dir_all(&vault).unwrap();

        let diff = diff_against(&vault, &TEST_TEMPLATE).unwrap();

        assert_eq!(
            diff_state(&diff, "added.md"),
            Some(TemplateFileState::Added)
        );
    }

    #[test]
    fn diff_reports_updatable_when_vault_matches_baseline_but_template_changed() {
        let vault = temp_test_vault("diff-updatable");
        fs::create_dir_all(&vault).unwrap();
        // Vault has the *old* content, matching the recorded baseline.
        fs::write(vault.join("changed.md"), "changed-content-v1").unwrap();
        let mut manifest = TemplateManifest {
            schema_version: MANIFEST_SCHEMA_VERSION,
            ..Default::default()
        };
        manifest
            .files
            .insert("changed.md".into(), sha256_hex(b"changed-content-v1"));
        write_manifest(&vault, &manifest).unwrap();

        let diff = diff_against(&vault, &TEST_TEMPLATE).unwrap();

        assert_eq!(
            diff_state(&diff, "changed.md"),
            Some(TemplateFileState::Updatable)
        );
    }

    #[test]
    fn diff_reports_conflict_when_vault_and_template_both_diverged_from_baseline() {
        let vault = temp_test_vault("diff-conflict");
        fs::create_dir_all(&vault).unwrap();
        // Vault was hand-edited away from the old baseline.
        fs::write(vault.join("changed.md"), "hand-edited content").unwrap();
        let mut manifest = TemplateManifest {
            schema_version: MANIFEST_SCHEMA_VERSION,
            ..Default::default()
        };
        manifest
            .files
            .insert("changed.md".into(), sha256_hex(b"changed-content-v1"));
        write_manifest(&vault, &manifest).unwrap();

        let diff = diff_against(&vault, &TEST_TEMPLATE).unwrap();

        assert_eq!(
            diff_state(&diff, "changed.md"),
            Some(TemplateFileState::Conflict)
        );
    }

    #[test]
    fn diff_reports_up_to_date_when_nothing_changed() {
        let vault = temp_test_vault("diff-uptodate");
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("stable.md"), "stable-content").unwrap();
        let mut manifest = TemplateManifest {
            schema_version: MANIFEST_SCHEMA_VERSION,
            ..Default::default()
        };
        manifest
            .files
            .insert("stable.md".into(), sha256_hex(b"stable-content"));
        write_manifest(&vault, &manifest).unwrap();

        let diff = diff_against(&vault, &TEST_TEMPLATE).unwrap();

        assert_eq!(
            diff_state(&diff, "stable.md"),
            Some(TemplateFileState::UpToDate)
        );
    }

    #[test]
    fn diff_with_no_baseline_falls_back_to_content_comparison() {
        let vault = temp_test_vault("diff-no-baseline");
        fs::create_dir_all(&vault).unwrap();
        // No manifest at all (a vault that predates the manifest mechanism).
        fs::write(vault.join("stable.md"), "stable-content").unwrap();
        fs::write(
            vault.join("changed.md"),
            "hand-edited, no baseline on record",
        )
        .unwrap();

        let diff = diff_against(&vault, &TEST_TEMPLATE).unwrap();

        assert_eq!(
            diff_state(&diff, "stable.md"),
            Some(TemplateFileState::UpToDate),
            "content-equal with no baseline is UpToDate"
        );
        assert_eq!(
            diff_state(&diff, "changed.md"),
            Some(TemplateFileState::Conflict),
            "content-divergent with no baseline defaults to Conflict, not silently overwritten"
        );
    }

    #[test]
    fn initial_only_files_are_excluded_from_the_diff() {
        let vault = temp_test_vault("diff-initial-only");
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("home.md"), "hand-written home").unwrap();

        let diff = diff_against(&vault, &TEST_TEMPLATE).unwrap();

        assert!(diff_state(&diff, "home.md").is_none());
    }

    #[test]
    fn apply_safe_applies_added_and_updatable_but_never_a_conflict() {
        let vault = temp_test_vault("apply-safe");
        fs::create_dir_all(&vault).unwrap();
        // `stable.md` is untouched since the last apply -> Updatable once the
        // baseline points at an older template revision.
        fs::write(vault.join("stable.md"), "stable-content-v1").unwrap();
        // `changed.md` was hand-edited -> Conflict.
        fs::write(vault.join("changed.md"), "hand-edited content").unwrap();
        // `added.md` is simply missing -> Added.
        let mut manifest = TemplateManifest {
            schema_version: MANIFEST_SCHEMA_VERSION,
            ..Default::default()
        };
        manifest
            .files
            .insert("stable.md".into(), sha256_hex(b"stable-content-v1"));
        manifest
            .files
            .insert("changed.md".into(), sha256_hex(b"changed-content-v1"));
        write_manifest(&vault, &manifest).unwrap();

        let applied = apply_safe_from(&vault, &TEST_TEMPLATE).unwrap();

        assert!(applied.contains(&"added.md".to_string()));
        assert!(applied.contains(&"stable.md".to_string()));
        assert!(
            !applied.contains(&"changed.md".to_string()),
            "a conflict must never be applied without the user's choice"
        );
        assert_eq!(
            fs::read_to_string(vault.join("added.md")).unwrap(),
            "added-content"
        );
        assert_eq!(
            fs::read_to_string(vault.join("stable.md")).unwrap(),
            "stable-content"
        );
        assert_eq!(
            fs::read_to_string(vault.join("changed.md")).unwrap(),
            "hand-edited content",
            "the conflicting file must be left exactly as the user wrote it"
        );
        assert!(
            !vault.join("changed.md.new").exists(),
            "a safe apply must not even write the .new side file"
        );

        // Baselines advance for what was written, and only for that.
        let reloaded = load_manifest(&vault);
        assert_eq!(
            reloaded.files.get("stable.md").unwrap(),
            &sha256_hex(b"stable-content")
        );
        assert_eq!(
            reloaded.files.get("added.md").unwrap(),
            &sha256_hex(b"added-content")
        );
        assert_eq!(
            reloaded.files.get("changed.md").unwrap(),
            &sha256_hex(b"changed-content-v1")
        );

        // The conflict is all that is left to ask about.
        let diff = diff_against(&vault, &TEST_TEMPLATE).unwrap();
        assert_eq!(
            diff_state(&diff, "stable.md"),
            Some(TemplateFileState::UpToDate)
        );
        assert_eq!(
            diff_state(&diff, "added.md"),
            Some(TemplateFileState::UpToDate)
        );
        assert_eq!(
            diff_state(&diff, "changed.md"),
            Some(TemplateFileState::Conflict)
        );

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn apply_safe_seeds_a_seed_only_file_the_vault_is_missing() {
        let vault = temp_test_vault("apply-safe-seed");
        fs::create_dir_all(&vault).unwrap();
        init_from(&vault, &TEST_TEMPLATE).unwrap();
        // The owner deleted the seeded file, or it was added to the template
        // after this vault was created.
        fs::remove_file(vault.join("home.md")).unwrap();

        let applied = apply_safe_from(&vault, &TEST_TEMPLATE).unwrap();

        assert!(applied.contains(&"home.md".to_string()));
        assert_eq!(
            fs::read_to_string(vault.join("home.md")).unwrap(),
            "home-content"
        );
        // Seed-only files stay out of the manifest: they are never compared
        // again, so they must never gain a baseline.
        assert!(!load_manifest(&vault).files.contains_key("home.md"));

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn apply_safe_never_overwrites_an_edited_seed_only_file() {
        let vault = temp_test_vault("apply-safe-seed-edited");
        fs::create_dir_all(&vault).unwrap();
        init_from(&vault, &TEST_TEMPLATE).unwrap();
        fs::write(vault.join("home.md"), "the owner's own home note").unwrap();

        let applied = apply_safe_from(&vault, &TEST_TEMPLATE).unwrap();

        assert!(!applied.contains(&"home.md".to_string()));
        assert_eq!(
            fs::read_to_string(vault.join("home.md")).unwrap(),
            "the owner's own home note"
        );

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn apply_safe_is_a_no_op_when_everything_is_up_to_date_or_conflicting() {
        let vault = temp_test_vault("apply-safe-noop");
        fs::create_dir_all(&vault).unwrap();
        init_from(&vault, &TEST_TEMPLATE).unwrap();
        // Hand-edit one file and roll its baseline back, making it a Conflict.
        fs::write(vault.join("changed.md"), "hand-edited content").unwrap();
        let mut manifest = load_manifest(&vault);
        manifest
            .files
            .insert("changed.md".into(), sha256_hex(b"changed-content-v1"));
        write_manifest(&vault, &manifest).unwrap();

        let applied = apply_safe_from(&vault, &TEST_TEMPLATE).unwrap();

        assert!(applied.is_empty(), "nothing safe was left to apply");
        assert_eq!(
            fs::read_to_string(vault.join("changed.md")).unwrap(),
            "hand-edited content"
        );

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn apply_conflict_keep_dismisses_this_version_and_preserves_original() {
        let vault = temp_test_vault("apply-conflict");
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("changed.md"), "hand-edited content").unwrap();
        let mut manifest = TemplateManifest {
            schema_version: MANIFEST_SCHEMA_VERSION,
            ..Default::default()
        };
        manifest
            .files
            .insert("changed.md".into(), sha256_hex(b"changed-content-v1"));
        write_manifest(&vault, &manifest).unwrap();

        apply_from(&vault, &TEST_TEMPLATE, &["changed.md".to_string()], &[]).unwrap();

        assert_eq!(
            fs::read_to_string(vault.join("changed.md")).unwrap(),
            "hand-edited content",
            "the conflicting original must be left untouched"
        );
        assert!(
            !vault.join("changed.md.new").exists(),
            "no side file is written for a kept conflict"
        );
        assert!(
            !vault.join("changed.md.bak").exists(),
            "no backup is written when nothing was overwritten"
        );
        // The baseline advances to the new template hash, so the next check
        // stays quiet until the template changes again.
        let reloaded = load_manifest(&vault);
        assert_eq!(
            reloaded.files.get("changed.md").unwrap(),
            &sha256_hex(b"changed-content-v2")
        );
        assert_eq!(
            diff_state(&diff_against(&vault, &TEST_TEMPLATE).unwrap(), "changed.md"),
            Some(TemplateFileState::UpToDate)
        );

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn apply_updatable_overwrites_and_advances_the_baseline() {
        let vault = temp_test_vault("apply-updatable");
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("changed.md"), "changed-content-v1").unwrap();
        let mut manifest = TemplateManifest {
            schema_version: MANIFEST_SCHEMA_VERSION,
            ..Default::default()
        };
        manifest
            .files
            .insert("changed.md".into(), sha256_hex(b"changed-content-v1"));
        write_manifest(&vault, &manifest).unwrap();

        apply_from(&vault, &TEST_TEMPLATE, &["changed.md".to_string()], &[]).unwrap();

        assert_eq!(
            fs::read_to_string(vault.join("changed.md")).unwrap(),
            "changed-content-v2"
        );
        assert!(!vault.join("changed.md.new").exists());
        assert!(
            !vault.join("changed.md.bak").exists(),
            "a safe updatable apply loses nothing, so it leaves no backup"
        );
        let reloaded = load_manifest(&vault);
        assert_eq!(
            reloaded.files.get("changed.md").unwrap(),
            &sha256_hex(b"changed-content-v2")
        );
    }

    #[test]
    fn apply_conflict_listed_as_overwrite_replaces_in_place_and_advances_the_baseline() {
        let vault = temp_test_vault("apply-conflict-overwrite");
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("changed.md"), "hand-edited content").unwrap();
        let mut manifest = TemplateManifest {
            schema_version: MANIFEST_SCHEMA_VERSION,
            ..Default::default()
        };
        manifest
            .files
            .insert("changed.md".into(), sha256_hex(b"changed-content-v1"));
        write_manifest(&vault, &manifest).unwrap();

        apply_from(
            &vault,
            &TEST_TEMPLATE,
            &["changed.md".to_string()],
            &["changed.md".to_string()],
        )
        .unwrap();

        assert_eq!(
            fs::read_to_string(vault.join("changed.md")).unwrap(),
            "changed-content-v2",
            "an explicitly chosen overwrite must replace the conflicting file"
        );
        assert_eq!(
            fs::read_to_string(vault.join("changed.md.bak")).unwrap(),
            "hand-edited content",
            "the prior content must survive beside the overwritten file"
        );
        assert!(
            !vault.join("changed.md.new").exists(),
            "no side-by-side file when the user chose to overwrite"
        );
        // The baseline must advance, or the file would report Conflict forever.
        assert_eq!(
            diff_state(&diff_against(&vault, &TEST_TEMPLATE).unwrap(), "changed.md"),
            Some(TemplateFileState::UpToDate)
        );
    }

    #[test]
    fn overwrite_list_does_not_affect_conflicts_that_were_not_listed() {
        let vault = temp_test_vault("apply-conflict-overwrite-other");
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("changed.md"), "hand-edited content").unwrap();
        let mut manifest = TemplateManifest {
            schema_version: MANIFEST_SCHEMA_VERSION,
            ..Default::default()
        };
        manifest
            .files
            .insert("changed.md".into(), sha256_hex(b"changed-content-v1"));
        write_manifest(&vault, &manifest).unwrap();

        apply_from(
            &vault,
            &TEST_TEMPLATE,
            &["changed.md".to_string()],
            &["some/other/path.md".to_string()],
        )
        .unwrap();

        assert_eq!(
            fs::read_to_string(vault.join("changed.md")).unwrap(),
            "hand-edited content"
        );
        assert!(
            !vault.join("changed.md.new").exists(),
            "an unlisted conflict writes no side file"
        );
        assert_eq!(
            diff_state(&diff_against(&vault, &TEST_TEMPLATE).unwrap(), "changed.md"),
            Some(TemplateFileState::UpToDate),
            "a kept conflict is dismissed until the template changes again"
        );

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn template_file_diff_reports_both_sides_of_a_conflict() {
        let vault = temp_test_vault("template-file-diff");
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("changed.md"), "hand-edited content\n").unwrap();

        let diff = template_file_diff_from(&vault, &TEST_TEMPLATE, "changed.md").unwrap();

        assert!(diff.contains("-hand-edited content"), "{diff}");
        assert!(diff.contains("+changed-content-v2"), "{diff}");
    }

    #[test]
    fn template_file_diff_of_a_missing_file_is_a_pure_addition() {
        let vault = temp_test_vault("template-file-diff-added");
        fs::create_dir_all(&vault).unwrap();

        let diff = template_file_diff_from(&vault, &TEST_TEMPLATE, "added.md").unwrap();

        assert!(diff.contains("+added-content"), "{diff}");
        assert!(!diff.contains("\n-"), "nothing to remove: {diff}");
    }

    #[test]
    fn template_file_diff_rejects_a_path_outside_the_template() {
        let vault = temp_test_vault("template-file-diff-unknown");
        fs::create_dir_all(&vault).unwrap();

        assert!(template_file_diff_from(&vault, &TEST_TEMPLATE, "nope.md").is_err());
    }

    #[test]
    fn apply_added_creates_the_missing_file() {
        let vault = temp_test_vault("apply-added");
        fs::create_dir_all(&vault).unwrap();

        apply_from(&vault, &TEST_TEMPLATE, &["added.md".to_string()], &[]).unwrap();

        assert_eq!(
            fs::read_to_string(vault.join("added.md")).unwrap(),
            "added-content"
        );
    }

    #[test]
    fn init_records_no_baseline_for_a_preexisting_file_that_differs_from_the_template() {
        let vault = temp_test_vault("init-preexisting-conflict");
        fs::create_dir_all(&vault).unwrap();
        // The user already has their own content in this file before the
        // template is ever applied (e.g. a hand-customized project-context
        // equivalent). Recording *this* content as the baseline would make
        // the next `diff_against` see `current == baseline` and misreport a
        // future upstream change as a safe `Updatable` overwrite.
        fs::write(vault.join("stable.md"), "user-customized-content").unwrap();

        init_from(&vault, &TEST_TEMPLATE).unwrap();

        let manifest = load_manifest(&vault);
        assert!(
            !manifest.files.contains_key("stable.md"),
            "a pre-existing, template-diverging file must not get a baseline recorded"
        );

        let diff = diff_against(&vault, &TEST_TEMPLATE).unwrap();
        assert_eq!(
            diff_state(&diff, "stable.md"),
            Some(TemplateFileState::Conflict),
            "with no baseline recorded, diverging content must report Conflict, not Updatable"
        );

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn init_records_a_baseline_for_a_preexisting_file_that_matches_the_template() {
        let vault = temp_test_vault("init-preexisting-match");
        fs::create_dir_all(&vault).unwrap();
        // The file already on disk happens to be byte-identical to the
        // template — nothing was customized, so recording a baseline is safe.
        fs::write(vault.join("stable.md"), "stable-content").unwrap();

        init_from(&vault, &TEST_TEMPLATE).unwrap();

        let manifest = load_manifest(&vault);
        assert_eq!(
            manifest.files.get("stable.md").unwrap(),
            &sha256_hex(b"stable-content")
        );

        let diff = diff_against(&vault, &TEST_TEMPLATE).unwrap();
        assert_eq!(
            diff_state(&diff, "stable.md"),
            Some(TemplateFileState::UpToDate)
        );

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn init_records_a_baseline_for_a_newly_created_file() {
        let vault = temp_test_vault("init-newly-created");
        fs::create_dir_all(&vault).unwrap();
        // "stable.md" does not exist yet; init_from creates it, and since the
        // on-disk content is then exactly the embedded template, recording a
        // baseline is always safe.
        assert!(!vault.join("stable.md").exists());

        init_from(&vault, &TEST_TEMPLATE).unwrap();

        let manifest = load_manifest(&vault);
        assert_eq!(
            manifest.files.get("stable.md").unwrap(),
            &sha256_hex(b"stable-content")
        );

        fs::remove_dir_all(&vault).ok();
    }

    #[test]
    fn manifest_without_schema_version_has_its_baselines_discarded() {
        let vault = temp_test_vault("manifest-schema-migration");
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("changed.md"), "hand-edited content").unwrap();
        // Simulate a manifest written by <= 0.49.0: no `schema_version`
        // field at all, but a baseline recorded for the hand-edited file
        // (the very bug this fix addresses).
        let legacy_json = serde_json::json!({
            "app_version": "0.49.0",
            "files": { "changed.md": sha256_hex(b"changed-content-v1") },
        });
        write_manifest(
            &vault,
            &serde_json::from_value(legacy_json).unwrap_or_default(),
        )
        .unwrap();

        let diff = diff_against(&vault, &TEST_TEMPLATE).unwrap();

        assert_eq!(
            diff_state(&diff, "changed.md"),
            Some(TemplateFileState::Conflict),
            "a pre-schema-version manifest's baselines must be discarded, \
             so a diverging file safely reports Conflict instead of Updatable"
        );

        fs::remove_dir_all(&vault).ok();
    }
}

#[cfg(test)]
mod regression_t0065 {
    use super::*;

    /// Reproduces the T-0065 data loss against the REAL embedded template:
    /// a vault whose `.claude/project-context.json` holds the user's own
    /// registered repos must never be reported as a clean `Updatable`.
    #[test]
    fn user_edited_files_are_never_silently_updatable() {
        let vault = std::env::temp_dir().join(format!(
            "wh-t0065-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(vault.join(".claude")).unwrap();
        // The user's real data, as it was before the wipe.
        let user_data = br#"{"projects":[{"name":"workhub","path":"C:/repos/workhub"}],"roleBasedDelegation":true}"#;
        fs::write(vault.join(".claude/project-context.json"), user_data).unwrap();
        // A managed file the user also customised.
        fs::write(vault.join("CLAUDE.md"), b"# my own edited harness notes\n").unwrap();

        init_from(&vault, &VAULT_TEMPLATE).unwrap();

        // Seed-only: must not appear in the diff at all, and must be untouched.
        let diff = diff_against(&vault, &VAULT_TEMPLATE).unwrap();
        assert!(
            !diff
                .files
                .iter()
                .any(|f| f.path == ".claude/project-context.json"),
            "seed-only file must be excluded from the diff entirely"
        );
        assert_eq!(
            fs::read(vault.join(".claude/project-context.json")).unwrap(),
            user_data,
            "seed-only file must be left byte-identical"
        );

        // Managed but user-edited: must be Conflict, never Updatable.
        let claude_md = diff
            .files
            .iter()
            .find(|f| f.path == "CLAUDE.md")
            .expect("CLAUDE.md should be in the diff");
        assert_eq!(
            claude_md.state,
            TemplateFileState::Conflict,
            "a user-edited managed file must be Conflict, not {:?}",
            claude_md.state
        );

        // Applying the conflict without overwrite must not clobber the file
        // and must write no side file — it only dismisses this version.
        apply_from(&vault, &VAULT_TEMPLATE, &["CLAUDE.md".to_string()], &[]).unwrap();
        assert_eq!(
            fs::read(vault.join("CLAUDE.md")).unwrap(),
            b"# my own edited harness notes\n",
            "applying a Conflict must leave the original untouched"
        );
        assert!(
            !vault.join("CLAUDE.md.new").exists(),
            "no .new side file is written anymore"
        );
        assert!(
            !vault.join("CLAUDE.md.bak").exists(),
            "no backup is written when nothing was overwritten"
        );

        fs::remove_dir_all(&vault).ok();
    }
}
