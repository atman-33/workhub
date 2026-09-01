#!/usr/bin/env node
// @ts-check
/**
 * SessionStart hook: notify when an installed Claude Code plugin has a newer
 * version available in its marketplace's local clone.
 *
 * Reads only local Claude config state (no network):
 *   - <config>/plugins/installed_plugins.json   -> installed version per scope
 *   - <config>/plugins/known_marketplaces.json  -> each marketplace's clone path
 *   - <clone>/.claude-plugin/marketplace.json    -> plugin name -> source subdir
 *   - <clone>/<source>/.claude-plugin/plugin.json-> authoritative latest version
 *
 * Why read plugin.json (not marketplace.json's version field): the version that
 * actually gets resolved at install time comes from each plugin's plugin.json,
 * while marketplace.json `version` fields are frequently left stale. So the
 * marketplace.json is used only to map a plugin name to its source folder.
 *
 * When one or more installed plugins are outdated, emit a <plugin-updates>
 * block (as both systemMessage and additionalContext) listing the current ->
 * latest version and the exact `claude plugin update` command per scope.
 *
 * Spam suppression: a small state file records the latest version we last
 * notified for each "<id>#<scope>" so the same new version is announced only
 * once. A newer version re-triggers the notice.
 *
 * Always exits 0 (SessionStart cannot block and hooks must be failure-tolerant);
 * on any error or when nothing is outdated it injects nothing.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, isAbsolute, resolve } from "node:path";

/** Read all of stdin (the SessionStart payload). Returns "" if none. */
function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/** Escape a string for use in XML text or a double-quoted attribute. */
function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Print a SessionStart hook result and exit 0. When there is content, the same
 * text is surfaced to the user via `systemMessage` (display-only) and to Claude
 * via `additionalContext`.
 */
function emit(additionalContext) {
  const payload = additionalContext
    ? {
        systemMessage: additionalContext,
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext,
        },
      }
    : {};
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

/** Read and JSON-parse a file, or return null on any failure. */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** Resolve the Claude config directory (CLAUDE_CONFIG_DIR or ~/.claude). */
function resolveConfigDir() {
  const fromEnv = process.env.CLAUDE_CONFIG_DIR;
  if (fromEnv && fromEnv.trim()) {
    return fromEnv.trim();
  }
  return join(homedir(), ".claude");
}

/**
 * Compare two dotted numeric version strings (e.g. "0.5.0").
 * Returns 1 if a > b, -1 if a < b, 0 if equal. Non-numeric / pre-release
 * suffixes are ignored conservatively (only the leading numeric core counts).
 */
function compareVersions(a, b) {
  const parse = (v) =>
    String(v)
      .split("-")[0] // drop any pre-release suffix
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/** Resolve a marketplace `source` (often "./plugins/x") against the clone root. */
function resolveSourcePath(cloneRoot, source) {
  if (typeof source !== "string" || !source.trim()) return null;
  const s = source.trim();
  return isAbsolute(s) ? s : resolve(cloneRoot, s);
}

/**
 * Build a map of plugin-name -> latest version for one marketplace clone, by
 * reading the clone's marketplace.json for each plugin's source folder and then
 * that plugin's plugin.json for the authoritative version.
 */
function readMarketplaceLatest(cloneRoot) {
  const manifest = readJson(join(cloneRoot, ".claude-plugin", "marketplace.json"));
  const latest = {};
  if (!manifest || !Array.isArray(manifest.plugins)) return latest;
  for (const entry of manifest.plugins) {
    if (!entry || typeof entry.name !== "string") continue;
    const sourcePath = resolveSourcePath(cloneRoot, entry.source);
    if (!sourcePath) continue;
    const pluginJson = readJson(join(sourcePath, ".claude-plugin", "plugin.json"));
    const version =
      pluginJson && typeof pluginJson.version === "string"
        ? pluginJson.version.trim()
        : null;
    if (version) latest[entry.name] = version;
  }
  return latest;
}

function main() {
  readStdin(); // drain payload; we don't need its contents
  const configDir = resolveConfigDir();
  const pluginsDir = join(configDir, "plugins");

  const installed = readJson(join(pluginsDir, "installed_plugins.json"));
  const marketplaces = readJson(join(pluginsDir, "known_marketplaces.json"));
  if (!installed || !installed.plugins || !marketplaces) {
    emit(null);
    return;
  }

  // marketplaceName -> { pluginName -> latestVersion }, lazily cached per clone.
  const latestByMarketplace = {};
  function latestFor(marketplaceName, pluginName) {
    if (!(marketplaceName in latestByMarketplace)) {
      const mp = marketplaces[marketplaceName];
      const installLocation = mp && typeof mp.installLocation === "string" ? mp.installLocation : null;
      latestByMarketplace[marketplaceName] = installLocation
        ? readMarketplaceLatest(installLocation)
        : {};
    }
    return latestByMarketplace[marketplaceName][pluginName] || null;
  }

  const stateFile = join(pluginsDir, ".update-notify-state.json");
  const state = readJson(stateFile) || {};
  const newState = { ...state };

  /** @type {{id:string,name:string,marketplace:string,scope:string,projectPath?:string,from:string,to:string}[]} */
  const updates = [];

  for (const [id, records] of Object.entries(installed.plugins)) {
    if (!Array.isArray(records)) continue;
    const atIdx = id.lastIndexOf("@");
    if (atIdx <= 0) continue;
    const name = id.slice(0, atIdx);
    const marketplace = id.slice(atIdx + 1);
    const latest = latestFor(marketplace, name);
    if (!latest) continue;

    for (const rec of records) {
      if (!rec || typeof rec.version !== "string") continue;
      const scope = typeof rec.scope === "string" ? rec.scope : "user";
      if (compareVersions(latest, rec.version) !== 1) continue; // not newer

      const stateKey = `${id}#${scope}`;
      if (state[stateKey] === latest) continue; // already notified this version

      updates.push({
        id,
        name,
        marketplace,
        scope,
        projectPath: typeof rec.projectPath === "string" ? rec.projectPath : undefined,
        from: rec.version,
        to: latest,
      });
      newState[stateKey] = latest;
    }
  }

  if (updates.length === 0) {
    emit(null);
    return;
  }

  // Persist suppression state (best-effort; failure must not break the hook).
  try {
    writeFileSync(stateFile, JSON.stringify(newState, null, 2));
  } catch {
    // ignore
  }

  const lines = ["<plugin-updates>"];
  lines.push(
    "  Newer versions are available for installed plugins. Updates require a Claude Code restart to apply."
  );
  for (const u of updates) {
    const scopeAttr = u.scope === "project" && u.projectPath ? ` projectPath="${xmlEscape(u.projectPath)}"` : "";
    lines.push(
      `  <update id="${xmlEscape(u.id)}" scope="${xmlEscape(u.scope)}"${scopeAttr} from="${xmlEscape(u.from)}" to="${xmlEscape(u.to)}">`
    );
    lines.push(`    claude plugin update ${xmlEscape(u.id)} --scope ${xmlEscape(u.scope)}`);
    lines.push("  </update>");
  }
  lines.push("</plugin-updates>");

  emit(lines.join("\n"));
}

main();
