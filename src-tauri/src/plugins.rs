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

/// The marketplace the app is *about*: the only one with a `catalog.json`, so
/// the only one that can say a plugin is required and missing.
///
/// It is no longer the only one read (T-0238). Every marketplace the machine
/// has registered gets rows too — but only for plugins actually installed or
/// switched on, never the whole catalogue a marketplace offers. Listing what
/// is on offer would be a plugin store: `claude-plugins-official` alone
/// carries some 500 entries against the two of them this machine uses.
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

/// One registered marketplace, and what the app could read of it.
///
/// The per-marketplace facts used to sit on `PluginsState`, back when there
/// was only one. They move here rather than being dropped: a stale clone makes
/// every "latest version" from it stale, and that is worth saying per
/// marketplace, not once for all of them.
#[derive(Debug, Clone, Serialize)]
pub struct MarketplaceInfo {
    pub name: String,
    pub clone_path: String,
    pub clone_found: bool,
    /// True only for a marketplace that ships `.claude-plugin/catalog.json` —
    /// in practice workhub's own. Without it there is no tier and no scope, so
    /// nothing can be called required, missing or recommended.
    pub catalog_found: bool,
    /// When Claude Code last refreshed the clone (ISO-8601); empty if unknown.
    pub marketplace_updated: String,
}

/// One plugin, with everything known about it from every source.
#[derive(Debug, Clone, Serialize)]
pub struct PluginRow {
    pub name: String,
    /// Marketplace this row belongs to — the second half of `<name>@<market>`.
    pub marketplace: String,
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
    /// The marketplace the tab is about — the one with the catalog.
    pub marketplace: String,
    /// Every registered marketplace, `marketplace` first and the rest by name.
    pub marketplaces: Vec<MarketplaceInfo>,
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
fn qualified(name: &str, marketplace: &str) -> String {
    format!("{name}@{marketplace}")
}

/// Split `<name>@<marketplace>`. An id with no `@` belongs to no marketplace
/// this app can act on, so it is dropped rather than guessed at.
fn split_id(id: &str) -> Option<(&str, &str)> {
    let (name, marketplace) = id.rsplit_once('@')?;
    (!name.is_empty() && !marketplace.is_empty()).then_some((name, marketplace))
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

/// The order the marketplaces are read and shown in: workhub's own first,
/// then the rest alphabetically. It leads because it is the one the app is
/// about — the others are there so the owner can see what else a session
/// loads.
fn marketplace_order(known: &BTreeMap<String, KnownMarketplace>) -> Vec<String> {
    let mut order: Vec<String> = known.keys().cloned().collect();
    order.sort_by_key(|name| (name != MARKETPLACE, name.clone()));
    order
}

/// Which plugins of one marketplace get a row.
///
/// A catalogued marketplace leads with its catalog, in the catalog's own
/// order, because a plugin the vault requires has to appear even when it is
/// switched off — "required and missing" is the thing that list exists to
/// say. Anything installed or enabled follows.
///
/// A marketplace with no catalog gets only what is installed or enabled. It
/// makes no claim about what the owner ought to have, and its full offering
/// can run to hundreds of plugins.
fn plugin_names_for<'a>(
    marketplace: &str,
    catalog: &[CatalogEntry],
    ids: impl Iterator<Item = &'a String>,
) -> Vec<String> {
    let mut names: Vec<String> = catalog.iter().map(|c| c.name.clone()).collect();
    for id in ids {
        if let Some((plugin, market)) = split_id(id) {
            if market == marketplace && !names.iter().any(|n| n == plugin) {
                names.push(plugin.to_string());
            }
        }
    }
    names
}

/// Plugins installed or enabled from a marketplace the machine no longer has
/// registered, as `(plugin, marketplace)` pairs, each listed once.
///
/// They still get rows: a session loads them every day, whatever
/// `known_marketplaces.json` says, and a tab that quietly omitted them would
/// be denying something that is demonstrably running.
fn orphan_ids<'a>(
    known: &BTreeMap<String, KnownMarketplace>,
    ids: impl Iterator<Item = &'a String>,
) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    for id in ids {
        let Some((plugin, market)) = split_id(id) else {
            continue;
        };
        if known.contains_key(market) {
            continue;
        }
        if !out.iter().any(|(p, m)| p == plugin && m == market) {
            out.push((plugin.to_string(), market.to_string()));
        }
    }
    out
}

/// Collect everything the Plugins tab renders. Missing files are not errors:
/// a machine that has never installed a plugin reads as "nothing installed",
/// which is exactly what the tab should say.
/// `plugin name -> version` from every `plugin.json` in one marketplace clone.
/// This is what "latest" means: the version a `claude plugin update` would
/// install, which is only as current as the last `marketplace update`.
fn latest_versions(clone: &Path) -> BTreeMap<String, String> {
    let mut latest = BTreeMap::new();
    let Some(file) =
        read_json::<MarketplaceFile>(&clone.join(".claude-plugin").join("marketplace.json"))
    else {
        return latest;
    };
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
    latest
}

/// Collect everything the Plugins tab renders. Missing files are not errors:
/// a machine that has never installed a plugin reads as "nothing installed",
/// which is exactly what the tab should say.
///
/// Every registered marketplace is read, but they are not read the same way
/// (T-0238). The workhub marketplace has a catalog, so its rows come from the
/// catalog — a required plugin has to appear even when it is switched off,
/// since "required and missing" is the whole point of that list. Every other
/// marketplace has no catalog to make such a claim, so its rows are exactly
/// what this machine has installed or switched on. The alternative — listing
/// each marketplace's whole offering — would put some 500 rows on screen for
/// the two `claude-plugins-official` plugins actually in use, and that is a
/// plugin store, not this tab.
pub fn read_state(vault_path: &str) -> PluginsState {
    let dir = plugins_dir();
    let known: BTreeMap<String, KnownMarketplace> =
        read_json(&dir.join("known_marketplaces.json")).unwrap_or_default();

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

    let order = marketplace_order(&known);

    let mut marketplaces = Vec::new();
    let mut rows = Vec::new();

    for name in &order {
        let entry = &known[name];
        let clone = PathBuf::from(&entry.install_location);
        let clone_found = !entry.install_location.is_empty() && clone.is_dir();
        let latest = if clone_found {
            latest_versions(&clone)
        } else {
            BTreeMap::new()
        };
        let catalog: Vec<CatalogEntry> = if clone_found {
            read_json::<CatalogFile>(&clone.join(".claude-plugin").join("catalog.json"))
                .map(|c| c.plugins)
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        marketplaces.push(MarketplaceInfo {
            name: name.clone(),
            clone_path: entry.install_location.clone(),
            clone_found,
            catalog_found: !catalog.is_empty(),
            marketplace_updated: entry.last_updated.clone(),
        });

        let names = plugin_names_for(
            name,
            &catalog,
            installed
                .keys()
                .chain(enabled_user.keys())
                .chain(enabled_project.keys()),
        );

        rows.extend(names.into_iter().map(|plugin| {
            let cat = catalog.iter().find(|c| c.name == plugin);
            let id = qualified(&plugin, name);
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
                marketplace: name.clone(),
                in_catalog: cat.is_some(),
                tier: cat.map(|c| c.tier.clone()).unwrap_or_default(),
                scope: cat.map(|c| c.scope.clone()).unwrap_or_default(),
                summary: cat.map(|c| c.summary.clone()).unwrap_or_default(),
                latest_version: latest.get(&plugin).cloned().unwrap_or_default(),
                installs,
                enabled_project: *enabled_project.get(&id).unwrap_or(&false),
                enabled_user: *enabled_user.get(&id).unwrap_or(&false),
                name: plugin,
            }
        }));
    }

    for (plugin, market) in orphan_ids(
        &known,
        installed
            .keys()
            .chain(enabled_user.keys())
            .chain(enabled_project.keys()),
    ) {
        let id = qualified(&plugin, &market);
        if !marketplaces.iter().any(|m| m.name == market) {
            marketplaces.push(MarketplaceInfo {
                name: market.clone(),
                clone_path: String::new(),
                clone_found: false,
                catalog_found: false,
                marketplace_updated: String::new(),
            });
        }
        rows.push(PluginRow {
            name: plugin,
            marketplace: market,
            in_catalog: false,
            tier: String::new(),
            scope: String::new(),
            summary: String::new(),
            latest_version: String::new(),
            installs: installed
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
                .unwrap_or_default(),
            enabled_project: *enabled_project.get(&id).unwrap_or(&false),
            enabled_user: *enabled_user.get(&id).unwrap_or(&false),
        });
    }

    PluginsState {
        marketplace: MARKETPLACE.to_string(),
        marketplaces,
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
pub fn read_details(vault_path: &str, name: &str, marketplace: &str, scope: &str) -> PluginDetails {
    let state = read_state(vault_path);
    let row = state
        .rows
        .iter()
        .find(|r| r.name == name && r.marketplace == marketplace);
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
    marketplace: &str,
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
        plugins.insert(qualified(name, marketplace), serde_json::Value::Bool(true));
    } else {
        // Removed rather than set to false: absent is the shape Claude Code and
        // the vault template both write, and a `false` left behind reads as a
        // deliberate opt-out nobody made.
        plugins.remove(&qualified(name, marketplace));
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
pub fn update_marketplace(
    vault_path: &str,
    marketplace: &str,
) -> Result<PluginCommandResult, String> {
    run_claude(vault_path, &["marketplace", "update", marketplace])
}

/// `claude plugin update <name>@<marketplace> --scope <scope>`.
///
/// `--yes` is required because the CLI refuses to prompt when stdout is not a
/// TTY, which it never is here.
pub fn update_plugin(
    vault_path: &str,
    name: &str,
    marketplace: &str,
    scope: &str,
) -> Result<PluginCommandResult, String> {
    if !matches!(scope, "user" | "project" | "local" | "managed") {
        return Err(format!("unknown scope: {scope}"));
    }
    let id = qualified(name, marketplace);
    run_claude(vault_path, &["update", &id, "--scope", scope, "--yes"])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qualifies_and_splits_plugin_ids() {
        assert_eq!(
            qualified("workhub", MARKETPLACE),
            "workhub@workhub-marketplace"
        );
        assert_eq!(
            split_id("workhub@workhub-marketplace"),
            Some(("workhub", "workhub-marketplace"))
        );
        // Every marketplace is read now (T-0238), not just workhub's.
        assert_eq!(
            split_id("pyright-lsp@claude-plugins-official"),
            Some(("pyright-lsp", "claude-plugins-official"))
        );
        // An id naming no marketplace cannot be acted on.
        assert_eq!(split_id("no-marketplace"), None);
        assert_eq!(split_id("@nothing"), None);
        assert_eq!(split_id("nothing@"), None);
    }

    fn catalog(names: &[&str]) -> Vec<CatalogEntry> {
        names
            .iter()
            .map(|n| CatalogEntry {
                name: (*n).to_string(),
                tier: "required".into(),
                scope: "user".into(),
                summary: String::new(),
            })
            .collect()
    }

    fn known_of(names: &[&str]) -> BTreeMap<String, KnownMarketplace> {
        names
            .iter()
            .map(|n| {
                (
                    (*n).to_string(),
                    KnownMarketplace {
                        install_location: String::new(),
                        last_updated: String::new(),
                    },
                )
            })
            .collect()
    }

    #[test]
    fn workhubs_marketplace_is_read_first() {
        let known = known_of(&["superpowers-dev", "claude-plugins-official", MARKETPLACE]);
        assert_eq!(
            marketplace_order(&known),
            [MARKETPLACE, "claude-plugins-official", "superpowers-dev"],
            "workhub's own leads; the rest are alphabetical"
        );
        assert!(marketplace_order(&BTreeMap::new()).is_empty());
    }

    #[test]
    fn a_catalogued_marketplace_lists_its_catalog_even_when_nothing_is_installed() {
        let ids = [
            "workhub@workhub-marketplace".to_string(),
            // Another marketplace's plugin must not leak into this one's rows.
            "pyright-lsp@claude-plugins-official".to_string(),
            "leftover@workhub-marketplace".to_string(),
        ];
        assert_eq!(
            plugin_names_for(
                MARKETPLACE,
                &catalog(&["workhub", "engineering"]),
                ids.iter()
            ),
            ["workhub", "engineering", "leftover"],
            "catalog order first, then what is installed or enabled but uncatalogued"
        );
    }

    // The whole point of T-0238: a marketplace with no catalog makes no claim
    // about what the owner should have, and `claude-plugins-official` alone
    // offers some 500 plugins against the two in use here.
    #[test]
    fn an_uncatalogued_marketplace_lists_only_what_is_installed_or_enabled() {
        let ids = [
            "pyright-lsp@claude-plugins-official".to_string(),
            "rust-analyzer-lsp@claude-plugins-official".to_string(),
            "workhub@workhub-marketplace".to_string(),
            "malformed-id".to_string(),
        ];
        assert_eq!(
            plugin_names_for("claude-plugins-official", &[], ids.iter()),
            ["pyright-lsp", "rust-analyzer-lsp"]
        );
        // Nothing installed from it at all: no rows, not an error.
        assert!(plugin_names_for("genshijin", &[], ids.iter()).is_empty());
    }

    #[test]
    fn a_plugin_is_listed_once_however_many_scopes_hold_it() {
        // The same id legitimately appears in installed_plugins.json and in
        // both settings files; three sightings are still one plugin.
        let ids = [
            "workhub@workhub-marketplace".to_string(),
            "workhub@workhub-marketplace".to_string(),
        ];
        assert_eq!(
            plugin_names_for(MARKETPLACE, &catalog(&["workhub"]), ids.iter()),
            ["workhub"]
        );
    }

    #[test]
    fn plugins_from_a_deregistered_marketplace_still_get_a_row() {
        let known = known_of(&[MARKETPLACE]);
        let ids = [
            "workhub@workhub-marketplace".to_string(),
            "superpowers@superpowers-dev".to_string(),
            // The same orphan seen again (installed *and* enabled) is one row.
            "superpowers@superpowers-dev".to_string(),
            "malformed-id".to_string(),
        ];
        assert_eq!(
            orphan_ids(&known, ids.iter()),
            [("superpowers".to_string(), "superpowers-dev".to_string())]
        );
        // Nothing is orphaned when every marketplace is still registered.
        let all = known_of(&[MARKETPLACE, "superpowers-dev"]);
        assert!(orphan_ids(&all, ids.iter()).is_empty());
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
        let details = read_details("", "nonexistent-plugin", MARKETPLACE, "user");
        assert!(!details.installed);
        assert!(details.install_path.is_empty());
        assert!(details.skills.is_empty());
    }

    #[test]
    fn rejects_an_unknown_scope() {
        assert!(update_plugin("", "workhub", MARKETPLACE, "nonsense").is_err());
        assert!(set_enabled("", "workhub", MARKETPLACE, "nonsense", true).is_err());
    }
}
