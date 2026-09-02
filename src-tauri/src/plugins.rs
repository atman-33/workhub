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
//!   `<clone>/.claude-plugin/catalog.json`  required vs optional, and scope —
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
}

/// One plugin, with everything known about it from every source.
#[derive(Debug, Clone, Serialize)]
pub struct PluginRow {
    pub name: String,
    /// False for a plugin that is installed or enabled but absent from
    /// `catalog.json` — a leftover, or a catalog that was not kept up to date.
    pub in_catalog: bool,
    pub required: bool,
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
    required: bool,
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
                        })
                        .collect()
                })
                .unwrap_or_default();
            PluginRow {
                in_catalog: cat.is_some(),
                required: cat.map(|c| c.required).unwrap_or(false),
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

    #[test]
    fn rejects_an_unknown_scope() {
        assert!(update_plugin("", "workhub", "nonsense").is_err());
        assert!(set_enabled("", "workhub", "nonsense", true).is_err());
    }
}
