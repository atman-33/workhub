//! plugins — the state behind the Plugins tab: which of the workhub
//! marketplace's plugins this machine has, at which version, and whether the
//! ones a vault cannot work without are actually switched on.
//!
//! Everything is read from local Claude Code state; nothing here touches the
//! network. The same four files the `claude-tooling` plugin's
//! `check-plugin-updates.mjs` hook reads, for the same reason:
//!
//!   `<config>/plugins/installed_plugins.json`      installed version, per scope
//!   `<config>/plugins/known_marketplaces.json`     where a marketplace is cloned
//!   `<clone>/.claude-plugin/marketplace.json`      plugin name -> source subdir
//!   `<clone>/<source>/.claude-plugin/plugin.json`  the authoritative version
//!
//! The version is taken from each plugin's `plugin.json`, never from the
//! marketplace entry: `plugin.json` is the single source of that metadata
//! (T-0221), and the marketplace entries carry `name` + `source` only.
//!
//! Two more files decide what the owner actually sees:
//!
//!   `<clone>/.claude-plugin/catalog.json`  each plugin's tier, and its scope —
//!                                          workhub's own metadata, which
//!                                          Claude Code itself never reads
//!   `enabledPlugins` in the vault's `.claude/settings.json` (project scope)
//!                    and `<config>/settings.json` (user scope)
//!
//! This module only collects facts. Deciding what each row *means* (ok /
//! outdated / a required plugin that is off) is done in `src/lib/plugins.ts`,
//! where it is a pure function under test.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// The marketplace the app manages. Other marketplaces a machine has
/// registered are none of this tab's business — it answers "is my workhub
/// harness complete and current", not "manage every plugin I own".
pub const MARKETPLACE: &str = "workhub-marketplace";

/// One installation of a plugin, as `installed_plugins.json` records it. The
/// same plugin can legitimately appear twice — once at user scope and once for
/// a project — so these are kept as a list rather than collapsed.
#[derive(Debug, Clone, Serialize)]
pub struct PluginInstall {
    /// `user` | `project` | `local` | `managed`
    pub scope: String,
    pub version: String,
    /// Project this install belongs to; empty for a user-scope install.
    pub project_path: String,
    /// Where Claude Code unpacked this install. The plugin's actual contents
    /// live here — the marketplace clone only carries what the *latest*
    /// version would be, which is not what a session is running.
    pub install_path: String,
}

/// One plugin, with everything known about it from every source.
#[derive(Debug, Clone, Serialize)]
pub struct PluginRow {
    pub name: String,
    /// False for a plugin that is installed or enabled but absent from
    /// `catalog.json` — a leftover, or a catalog that was not kept up to date.
    pub in_catalog: bool,
    /// `required` | `recommended` | `optional`, or empty for an uncatalogued
    /// row. Decided by what breaks without the plugin — see `catalog.json`.
    pub tier: String,
    /// `project` | `user` | `either`, or empty when the catalog does not say.
    pub scope: String,
    pub summary: String,
    /// Version from the marketplace clone's `plugin.json`; empty when the
    /// clone is missing or does not carry this plugin.
    pub latest_version: String,
    pub installs: Vec<PluginInstall>,
    /// `enabledPlugins` in the vault's `.claude/settings.json`.
    pub enabled_project: bool,
    /// `enabledPlugins` in `<config>/settings.json`.
    pub enabled_user: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct PluginsState {
    pub marketplace: String,
    pub clone_path: String,
    pub clone_found: bool,
    /// When the clone predates `catalog.json`, every row reads as uncatalogued
    /// — worth saying out loud rather than showing an empty required list.
    pub catalog_found: bool,
    /// When the marketplace clone was last refreshed (ISO-8601 as Claude Code
    /// wrote it); empty when unknown. A stale clone makes every "latest"
    /// version stale with it.
    pub marketplace_updated: String,
    /// Vault `.claude/settings.json`; empty when no vault is configured.
    pub project_settings_path: String,
    pub user_settings_path: String,
    pub rows: Vec<PluginRow>,
}

// ---------------------------------------------------------------- file shapes

#[derive(Debug, Deserialize)]
struct InstalledFile {
    #[serde(default)]
    plugins: BTreeMap<String, Vec<InstalledEntry>>,
}

#[derive(Debug, Deserialize)]
struct InstalledEntry {
    #[serde(default)]
    scope: String,
    #[serde(default)]
    version: String,
    #[serde(default, rename = "projectPath")]
    project_path: String,
    #[serde(default, rename = "installPath")]
    install_path: String,
}

#[derive(Debug, Deserialize)]
struct KnownMarketplace {
    #[serde(default, rename = "installLocation")]
    install_location: String,
    #[serde(default, rename = "lastUpdated")]
    last_updated: String,
}

#[derive(Debug, Deserialize)]
struct MarketplaceFile {
    #[serde(default)]
    plugins: Vec<MarketplaceEntry>,
}

#[derive(Debug, Deserialize)]
struct MarketplaceEntry {
    name: String,
    #[serde(default)]
    source: String,
}

#[derive(Debug, Deserialize)]
struct PluginManifest {
    #[serde(default)]
    version: String,
}

#[derive(Debug, Deserialize)]
struct CatalogFile {
    #[serde(default)]
    plugins: Vec<CatalogEntry>,
}

#[derive(Debug, Clone, Deserialize)]
struct CatalogEntry {
    name: String,
    #[serde(default)]
    tier: String,
    #[serde(default)]
    scope: String,
    #[serde(default)]
    summary: String,
}

/// `enabledPlugins` out of a settings file. Everything else in the file is
/// preserved on write, so a write re-reads it as generic JSON instead.
#[derive(Debug, Deserialize)]
struct SettingsEnabled {
    #[serde(default, rename = "enabledPlugins")]
    enabled_plugins: BTreeMap<String, bool>,
}

// ---------------------------------------------------------------- reading

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Option<T> {
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn plugins_dir() -> PathBuf {
    crate::persona::claude_dir().join("plugins")
}

/// Qualified plugin id as it appears in `enabledPlugins` and
/// `installed_plugins.json`: `<name>@<marketplace>`.
fn qualified(name: &str) -> String {
    format!("{name}@{MARKETPLACE}")
}

/// Split `<name>@<marketplace>`, keeping only ids from our marketplace.
fn plugin_name_of(id: &str) -> Option<&str> {
    let (name, marketplace) = id.rsplit_once('@')?;
    (marketplace == MARKETPLACE).then_some(name)
}

fn read_enabled(path: &Path) -> BTreeMap<String, bool> {
    read_json::<SettingsEnabled>(path)
        .map(|s| s.enabled_plugins)
        .unwrap_or_default()
}

/// Vault `.claude/settings.json`, or `None` when no vault is configured.
fn project_settings_path(vault_path: &str) -> Option<PathBuf> {
    let vault = vault_path.trim();
    (!vault.is_empty()).then(|| Path::new(vault).join(".claude").join("settings.json"))
}

fn user_settings_path() -> PathBuf {
    crate::persona::claude_dir().join("settings.json")
}

/// Collect everything the Plugins tab renders. Missing files are not errors:
/// a machine that has never installed a plugin reads as "nothing installed",
/// which is exactly what the tab should say.
pub fn read_state(vault_path: &str) -> PluginsState {
    let dir = plugins_dir();
    let known: BTreeMap<String, KnownMarketplace> =
        read_json(&dir.join("known_marketplaces.json")).unwrap_or_default();
    let entry = known.get(MARKETPLACE);
    let clone_path = entry
        .map(|m| m.install_location.clone())
        .unwrap_or_default();
    let marketplace_updated = entry.map(|m| m.last_updated.clone()).unwrap_or_default();
    let clone = PathBuf::from(&clone_path);
    let clone_found = !clone_path.is_empty() && clone.is_dir();

    // name -> latest version, from each plugin's own manifest in the clone.
    let mut latest: BTreeMap<String, String> = BTreeMap::new();
    if clone_found {
        if let Some(file) =
            read_json::<MarketplaceFile>(&clone.join(".claude-plugin").join("marketplace.json"))
        {
            for entry in file.plugins {
                let source = entry.source.trim_start_matches("./");
                let manifest = clone
                    .join(source)
                    .join(".claude-plugin")
                    .join("plugin.json");
                let version = read_json::<PluginManifest>(&manifest)
                    .map(|m| m.version)
                    .unwrap_or_default();
                latest.insert(entry.name, version);
            }
        }
    }

    let catalog: Vec<CatalogEntry> = if clone_found {
        read_json::<CatalogFile>(&clone.join(".claude-plugin").join("catalog.json"))
            .map(|c| c.plugins)
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    let catalog_found = !catalog.is_empty();

    let installed: BTreeMap<String, Vec<InstalledEntry>> =
        read_json::<InstalledFile>(&dir.join("installed_plugins.json"))
            .map(|f| f.plugins)
            .unwrap_or_default();

    let user_settings = user_settings_path();
    let project_settings = project_settings_path(vault_path);
    let enabled_user = read_enabled(&user_settings);
    let enabled_project = project_settings
        .as_deref()
        .map(read_enabled)
        .unwrap_or_default();

    // Every plugin name worth a row: the catalog first (it decides the order),
    // then anything installed or switched on that the catalog does not list.
    let mut names: Vec<String> = catalog.iter().map(|c| c.name.clone()).collect();
    for id in installed
        .keys()
        .chain(enabled_user.keys())
        .chain(enabled_project.keys())
    {
        if let Some(name) = plugin_name_of(id) {
            if !names.iter().any(|n| n == name) {
                names.push(name.to_string());
            }
        }
    }

    let rows = names
        .into_iter()
        .map(|name| {
            let cat = catalog.iter().find(|c| c.name == name);
            let id = qualified(&name);
            let installs = installed
                .get(&id)
                .map(|entries| {
                    entries
                        .iter()
                        .map(|e| PluginInstall {
                            scope: e.scope.clone(),
                            version: e.version.clone(),
                            project_path: e.project_path.clone(),
                            install_path: e.install_path.clone(),
                        })
                        .collect()
                })
                .unwrap_or_default();
            PluginRow {
                in_catalog: cat.is_some(),
                tier: cat.map(|c| c.tier.clone()).unwrap_or_default(),
                scope: cat.map(|c| c.scope.clone()).unwrap_or_default(),
                summary: cat.map(|c| c.summary.clone()).unwrap_or_default(),
                latest_version: latest.get(&name).cloned().unwrap_or_default(),
                installs,
                enabled_project: *enabled_project.get(&id).unwrap_or(&false),
                enabled_user: *enabled_user.get(&id).unwrap_or(&false),
                name,
            }
        })
        .collect();

    PluginsState {
        marketplace: MARKETPLACE.to_string(),
        clone_path,
        clone_found,
        catalog_found,
        marketplace_updated,
        project_settings_path: project_settings
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default(),
        user_settings_path: user_settings.to_string_lossy().into_owned(),
        rows,
    }
}

// ---------------------------------------------------------------- contents

/// One skill, agent or command a plugin ships. All three are a Markdown file
/// with a YAML frontmatter block, so one shape describes them all.
#[derive(Debug, Clone, Default, Serialize)]
pub struct PluginEntry {
    /// `name` from the frontmatter, falling back to the file (or folder) name
    /// when it says nothing — which is what Claude Code itself does.
    pub name: String,
    pub description: String,
    /// `model` from an agent's frontmatter; empty for everything else.
    pub model: String,
    /// Path on disk, so the owner can open the thing they are reading about.
    pub path: String,
}

/// The hooks one event has registered, in the order `hooks.json` lists them.
#[derive(Debug, Clone, Serialize)]
pub struct PluginHookEvent {
    /// `SessionStart`, `UserPromptSubmit`, `Stop`, …
    pub event: String,
    /// Each hook's command, as written — `${CLAUDE_PLUGIN_ROOT}` and all.
    /// Paraphrasing it would hide which script actually runs.
    pub commands: Vec<String>,
}

/// What a plugin is made of, read from the version that is actually installed.
#[derive(Debug, Clone, Default, Serialize)]
pub struct PluginDetails {
    pub name: String,
    pub version: String,
    /// `description` / `author.name` from `.claude-plugin/plugin.json`.
    pub description: String,
    pub author: String,
    /// Root of the install these contents were read from; empty when the
    /// plugin is enabled but not installed yet.
    pub install_path: String,
    /// False when there is no install to read — the tab says so rather than
    /// showing an empty plugin.
    pub installed: bool,
    pub skills: Vec<PluginEntry>,
    pub agents: Vec<PluginEntry>,
    pub commands: Vec<PluginEntry>,
    pub hooks: Vec<PluginHookEvent>,
}

/// Pull `key: value` pairs out of a leading `---` frontmatter block.
///
/// Deliberately not a YAML parser: skill and agent frontmatter is a handful of
/// flat scalars, and the only thing done with the values here is to display
/// them. A malformed block reads as "no frontmatter" rather than an error,
/// because a plugin the owner did not write is not theirs to fix.
fn parse_frontmatter(text: &str) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    let mut lines = text.lines();
    if lines.next().map(str::trim_end) != Some("---") {
        return out;
    }
    for line in lines {
        if line.trim_end() == "---" {
            break;
        }
        // Continuation and list lines belong to a key this reader does not
        // need; skipping them keeps a multi-line value out of the next key.
        if line.starts_with(' ') || line.starts_with('\t') || line.trim_start().starts_with('-') {
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let value = value.trim();
        let value = value
            .strip_prefix('"')
            .and_then(|v| v.strip_suffix('"'))
            .or_else(|| value.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')))
            .unwrap_or(value);
        out.insert(key.trim().to_string(), value.to_string());
    }
    out
}

/// Read one skill/agent/command Markdown file into an entry.
fn read_entry(path: &Path, fallback_name: &str) -> PluginEntry {
    let front = fs::read_to_string(path)
        .map(|text| parse_frontmatter(&text))
        .unwrap_or_default();
    PluginEntry {
        name: front
            .get("name")
            .filter(|n| !n.is_empty())
            .cloned()
            .unwrap_or_else(|| fallback_name.to_string()),
        description: front.get("description").cloned().unwrap_or_default(),
        model: front.get("model").cloned().unwrap_or_default(),
        path: path.to_string_lossy().replace('\\', "/"),
    }
}

/// Entries sorted by name, so the list reads the same on every machine —
/// directory order is whatever the filesystem happens to hand back.
fn sorted(mut entries: Vec<PluginEntry>) -> Vec<PluginEntry> {
    entries.sort_by_key(|e| e.name.to_lowercase());
    entries
}

/// `skills/<name>/SKILL.md` — a skill is a folder, and the folder name is the
/// fallback when its frontmatter carries no `name`.
fn read_skills(root: &Path) -> Vec<PluginEntry> {
    let Ok(dir) = fs::read_dir(root.join("skills")) else {
        return Vec::new();
    };
    let entries = dir
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let file = e.path().join("SKILL.md");
            file.is_file().then(|| {
                let folder = e.file_name().to_string_lossy().into_owned();
                read_entry(&file, &folder)
            })
        })
        .collect();
    sorted(entries)
}

/// `agents/*.md` and `commands/*.md` — one file each, named by its stem.
fn read_markdown_dir(root: &Path, sub: &str) -> Vec<PluginEntry> {
    let Ok(dir) = fs::read_dir(root.join(sub)) else {
        return Vec::new();
    };
    let entries = dir
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file() && p.extension().is_some_and(|x| x == "md"))
        .map(|p| {
            let stem = p
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            read_entry(&p, &stem)
        })
        .collect();
    sorted(entries)
}

/// `hooks/hooks.json`, flattened to "which event runs which commands".
///
/// The file nests matchers inside events inside a `hooks` object; the tab only
/// answers "what does this plugin do to my session", so the matchers collapse
/// and the commands are kept verbatim.
fn read_hooks(root: &Path) -> Vec<PluginHookEvent> {
    let Some(file) = read_json::<serde_json::Value>(&root.join("hooks").join("hooks.json")) else {
        return Vec::new();
    };
    let Some(events) = file.get("hooks").and_then(|h| h.as_object()) else {
        return Vec::new();
    };
    let mut out: Vec<PluginHookEvent> = events
        .iter()
        .map(|(event, matchers)| {
            let commands = matchers
                .as_array()
                .map(|list| {
                    list.iter()
                        .filter_map(|m| m.get("hooks").and_then(|h| h.as_array()))
                        .flatten()
                        .filter_map(|h| h.get("command").and_then(|c| c.as_str()))
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default();
            PluginHookEvent {
                event: event.clone(),
                commands,
            }
        })
        .filter(|e| !e.commands.is_empty())
        .collect();
    out.sort_by(|a, b| a.event.cmp(&b.event));
    out
}

/// What the installed copy of a plugin actually contains.
///
/// Read from `installPath` rather than the marketplace clone: the clone holds
/// whatever the last `marketplace update` fetched, which is the version the
/// owner *could* be running. What a session loads is what is installed.
///
/// `scope` picks between two installs of the same plugin; the first install is
/// used when it does not match, since a plugin on disk at another scope is
/// still the same files.
pub fn read_details(vault_path: &str, name: &str, scope: &str) -> PluginDetails {
    let state = read_state(vault_path);
    let row = state.rows.iter().find(|r| r.name == name);
    let install = row.and_then(|r| {
        r.installs
            .iter()
            .find(|i| i.scope == scope)
            .or_else(|| r.installs.first())
    });
    let mut details = PluginDetails {
        name: name.to_string(),
        description: row.map(|r| r.summary.clone()).unwrap_or_default(),
        ..Default::default()
    };
    let Some(install) = install.filter(|i| !i.install_path.is_empty()) else {
        return details;
    };
    let root = PathBuf::from(&install.install_path);
    if !root.is_dir() {
        return details;
    }
    details.installed = true;
    details.install_path = install.install_path.replace('\\', "/");
    details.version = install.version.clone();

    // `plugin.json` is the authoritative metadata (T-0221); the catalog summary
    // above is workhub's own one-liner and only stands in when it is missing.
    if let Some(manifest) =
        read_json::<serde_json::Value>(&root.join(".claude-plugin").join("plugin.json"))
    {
        if let Some(d) = manifest
            .get("description")
            .and_then(|d| d.as_str())
            .filter(|d| !d.is_empty())
        {
            details.description = d.to_string();
        }
        // `author` is either a string or an object with a `name`.
        details.author = manifest
            .get("author")
            .and_then(|a| {
                a.as_str()
                    .map(str::to_string)
                    .or_else(|| a.get("name").and_then(|n| n.as_str()).map(str::to_string))
            })
            .unwrap_or_default();
    }
    details.skills = read_skills(&root);
    details.agents = read_markdown_dir(&root, "agents");
    details.commands = read_markdown_dir(&root, "commands");
    details.hooks = read_hooks(&root);
    details
}

// ---------------------------------------------------------------- writing

/// Turn a plugin on or off by editing `enabledPlugins` in one settings file.
///
/// The file is re-read and re-serialized as generic JSON so that every other
/// key — hooks, statusLine, marketplaces, whatever the owner has put there —
/// survives untouched. Only the one key changes, which is what makes this
/// reversible enough to do without a confirmation.
///
/// Takes effect in the *next* Claude Code session, like every other change to
/// `settings.json`; the tab says so.
pub fn set_enabled(
    vault_path: &str,
    name: &str,
    scope: &str,
    enabled: bool,
) -> Result<PluginsState, String> {
    let path = match scope {
        "project" => project_settings_path(vault_path).ok_or_else(|| {
            "no vault is configured, so there is no project settings file".to_string()
        })?,
        "user" => user_settings_path(),
        other => return Err(format!("unknown scope: {other}")),
    };

    let mut root: serde_json::Value = match fs::read_to_string(&path) {
        Ok(text) if !text.trim().is_empty() => serde_json::from_str(&text)
            .map_err(|e| format!("{} is not valid JSON: {e}", path.display()))?,
        // A machine that has never written user settings simply has no file.
        _ => serde_json::json!({}),
    };
    let map = root
        .as_object_mut()
        .ok_or_else(|| format!("{} is not a JSON object", path.display()))?;
    let entry = map
        .entry("enabledPlugins")
        .or_insert_with(|| serde_json::json!({}));
    let plugins = entry
        .as_object_mut()
        .ok_or_else(|| format!("enabledPlugins in {} is not an object", path.display()))?;
    if enabled {
        plugins.insert(qualified(name), serde_json::Value::Bool(true));
    } else {
        // Removed rather than set to false: absent is the shape Claude Code and
        // the vault template both write, and a `false` left behind reads as a
        // deliberate opt-out nobody made.
        plugins.remove(&qualified(name));
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create {}: {e}", parent.display()))?;
    }
    let text = serde_json::to_string_pretty(&root)
        .map_err(|e| format!("failed to serialize {}: {e}", path.display()))?;
    fs::write(&path, format!("{text}\n"))
        .map_err(|e| format!("failed to write {}: {e}", path.display()))?;
    Ok(read_state(vault_path))
}

// ---------------------------------------------------------------- claude CLI

/// Result of one `claude plugin …` run, shown verbatim in the tab: these
/// commands are the owner's own tooling, and paraphrasing their output would
/// only hide what actually happened.
#[derive(Debug, Clone, Serialize)]
pub struct PluginCommandResult {
    pub command: String,
    pub ok: bool,
    pub output: String,
}

fn run_claude(vault_path: &str, args: &[&str]) -> Result<PluginCommandResult, String> {
    let mut cmd = Command::new("claude");
    cmd.arg("plugin").args(args);
    // Project-scope operations are resolved against the working directory, so
    // they have to run inside the vault.
    let vault = vault_path.trim();
    if !vault.is_empty() && Path::new(vault).is_dir() {
        cmd.current_dir(vault);
    }
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let out = cmd.output().map_err(|e| {
        format!("failed to run `claude plugin`: {e}. Is the Claude Code CLI on PATH?")
    })?;
    let mut output = String::from_utf8_lossy(&out.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&out.stderr);
    if !stderr.trim().is_empty() {
        if !output.is_empty() && !output.ends_with('\n') {
            output.push('\n');
        }
        output.push_str(&stderr);
    }
    Ok(PluginCommandResult {
        command: format!("claude plugin {}", args.join(" ")),
        ok: out.status.success(),
        output: output.trim_end().to_string(),
    })
}

/// Refresh the marketplace clone, which is where every "latest version" here
/// comes from. Without it the tab compares against whatever was cloned last.
pub fn update_marketplace(vault_path: &str) -> Result<PluginCommandResult, String> {
    run_claude(vault_path, &["marketplace", "update", MARKETPLACE])
}

/// `claude plugin update <name>@<marketplace> --scope <scope>`.
///
/// `--yes` is required because the CLI refuses to prompt when stdout is not a
/// TTY, which it never is here.
pub fn update_plugin(
    vault_path: &str,
    name: &str,
    scope: &str,
) -> Result<PluginCommandResult, String> {
    if !matches!(scope, "user" | "project" | "local" | "managed") {
        return Err(format!("unknown scope: {scope}"));
    }
    let id = qualified(name);
    run_claude(vault_path, &["update", &id, "--scope", scope, "--yes"])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qualifies_and_splits_plugin_ids() {
        assert_eq!(qualified("workhub"), "workhub@workhub-marketplace");
        assert_eq!(
            plugin_name_of("workhub@workhub-marketplace"),
            Some("workhub")
        );
        // Other marketplaces are not this tab's business.
        assert_eq!(plugin_name_of("pyright-lsp@claude-plugins-official"), None);
        assert_eq!(plugin_name_of("no-marketplace"), None);
    }

    #[test]
    fn project_settings_need_a_vault() {
        assert!(project_settings_path("   ").is_none());
        assert!(project_settings_path("C:/vault")
            .unwrap()
            .ends_with("settings.json"));
    }

    /// A scratch directory, named the way the other modules' tests name theirs.
    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("workhub-plugins-{tag}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A throwaway plugin tree, since the real ones live outside the repo.
    fn plugin_fixture(tag: &str) -> PathBuf {
        let root = temp_dir(tag);
        let root = root.as_path();
        let write = |rel: &str, body: &str| {
            let path = root.join(rel);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, body).unwrap();
        };
        write(
            ".claude-plugin/plugin.json",
            r#"{"name":"demo","version":"1.2.3","description":"a demo plugin",
                "author":{"name":"atman-33"}}"#,
        );
        write(
            "skills/zebra/SKILL.md",
            "---\nname: zebra\ndescription: last alphabetically\n---\n\nbody\n",
        );
        // No `name` in the frontmatter: the folder name stands in.
        write(
            "skills/alpha/SKILL.md",
            "---\ndescription: from the folder\n---\n",
        );
        // A folder without a SKILL.md is not a skill.
        fs::create_dir_all(root.join("skills/not-a-skill")).unwrap();
        write(
            "agents/reviewer.md",
            "---\nname: reviewer\ndescription: reviews\nmodel: haiku\ntools: Read, Grep\n---\n",
        );
        write("commands/ship.md", "---\ndescription: ships it\n---\n");
        write("README.md", "not an agent\n");
        write(
            "hooks/hooks.json",
            r#"{"hooks":{
                 "SessionStart":[{"hooks":[{"type":"command","command":"node a.mjs"},
                                           {"type":"command","command":"node b.mjs"}]}],
                 "Stop":[{"hooks":[{"type":"command","command":"node c.mjs"}]}],
                 "Empty":[]
               }}"#,
        );
        root.to_path_buf()
    }

    #[test]
    fn frontmatter_reads_flat_scalars_only() {
        let front = parse_frontmatter(
            "---\nname: demo\ndescription: \"quoted, with a comma\"\nlist:\n  - one\n  - two\nmodel: haiku\n---\nbody: not frontmatter\n",
        );
        assert_eq!(front.get("name").unwrap(), "demo");
        assert_eq!(front.get("description").unwrap(), "quoted, with a comma");
        assert_eq!(front.get("model").unwrap(), "haiku");
        // The list items must not leak in as keys, and the body is not read.
        assert!(!front.contains_key("one"));
        assert!(!front.contains_key("body"));
    }

    #[test]
    fn a_file_without_frontmatter_reads_as_empty() {
        assert!(parse_frontmatter("# just a heading\n").is_empty());
        assert!(parse_frontmatter("").is_empty());
    }

    #[test]
    fn reads_skills_agents_and_commands_from_an_install() {
        let root = plugin_fixture("contents");
        let root = root.as_path();

        let skills = read_skills(root);
        assert_eq!(
            skills.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(),
            ["alpha", "zebra"],
            "sorted by name, and a folder with no SKILL.md is not a skill"
        );
        assert_eq!(skills[0].description, "from the folder");

        let agents = read_markdown_dir(root, "agents");
        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0].model, "haiku");

        let commands = read_markdown_dir(root, "commands");
        assert_eq!(commands.len(), 1);
        // No `name` in the frontmatter, so the file stem stands in.
        assert_eq!(commands[0].name, "ship");

        // A plugin that ships none of these reads as empty, not as an error.
        let empty = temp_dir("empty");
        assert!(read_skills(&empty).is_empty());
        assert!(read_markdown_dir(&empty, "agents").is_empty());
    }

    #[test]
    fn flattens_hooks_by_event() {
        let root = plugin_fixture("hooks");
        let hooks = read_hooks(&root);
        assert_eq!(
            hooks.iter().map(|h| h.event.as_str()).collect::<Vec<_>>(),
            ["SessionStart", "Stop"],
            "an event with no commands is dropped"
        );
        assert_eq!(hooks[0].commands, ["node a.mjs", "node b.mjs"]);
        assert!(read_hooks(&temp_dir("no-hooks")).is_empty());
    }

    #[test]
    fn a_plugin_with_no_install_reads_as_not_installed() {
        // Nothing is installed under a vault path that does not exist, so this
        // is the "enabled but not installed yet" case the tab has to explain.
        let details = read_details("", "nonexistent-plugin", "user");
        assert!(!details.installed);
        assert!(details.install_path.is_empty());
        assert!(details.skills.is_empty());
    }

    #[test]
    fn rejects_an_unknown_scope() {
        assert!(update_plugin("", "workhub", "nonsense").is_err());
        assert!(set_enabled("", "workhub", "nonsense", true).is_err());
    }
}
