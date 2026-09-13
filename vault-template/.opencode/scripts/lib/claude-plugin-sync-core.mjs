// Shared core for the OpenCode <-> Claude Code plugin sync tooling.
//
// This module is intentionally free of any opencode-specific imports so that it
// can be used from both:
//   - the Node scripts under .opencode/scripts/ (CLI sync + diagnostic)
//   - the TypeScript plugins under .opencode/plugins/ (drift reminder hook)
//
// Responsibilities:
//   1. Discovery: enumerate the source artifacts (skills/commands/agents) that
//      should exist on the OpenCode side, both for the vault-local mirror
//      (.claude/skills + .claude/agents) and for enabled user-scope plugins
//      (`claude plugin list` filtered by the user `enabledPlugins`).
//      Plugins are user-scope only: no project-scope allowlist is consulted.
//   2. Hashing: a stable, recursive directory hash so we can tell whether a
//      source or target artifact's contents have changed since the last sync.
//   3. Manifest: a small JSON file that records, for every artifact copied by a
//      sync run, the plugin it came from plus the source+target hashes at copy
//      time. Without this file the sync tooling cannot distinguish a plugin-derived
//      target from a hand-written one (the harness has both).
//   4. Drift detection: given current sources + manifest, classify each artifact
//      as synced / stale-source / diverged / orphan / missing / silent-user-edit.
//   5. Reminder XML: a human-readable block the reminder plugin injects into the
//      next model turn when drift is detected.
//
// The sync *scripts* ALSO use this module's discovery/hashing/manifest to perform
// the actual copies, so the diagnostic, the reminder plugin, and the sync scripts
// share one source of truth.
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  cpSync,
  copyFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MANIFEST_VERSION = 1;
export const MANIFEST_FILENAME = ".claude-plugin-sync-manifest.json";

// Default TTL for the `claude plugin list` cache used by user-scope discovery.
// The reminder plugin re-runs discovery on every new chat message, so we cache the
// (slow, claude-CLI-dependent) user-scope plugin list in a tmp file between runs.
export const DEFAULT_USER_LIST_CACHE_TTL_MS = 10 * 60_000;

const ENV_USER_CACHE_TTL = "CLAUDE_PLUGIN_SYNC_CACHE_TTL_MS";

// ---------------------------------------------------------------------------
// Types (JSDoc-form for editor hover; the .d.ts companion provides TS types)
// ---------------------------------------------------------------------------

/**
 * @typedef {"skill" | "command"} ArtifactKind
 */

/**
 * @typedef {Object} ArtifactSource
 * @property {ArtifactKind} kind
 * @property {string} pluginRef   e.g. "engineering@workhub-marketplace"
 * @property {string} name        skill/command directory or file name
 * @property {string} sourcePath   absolute path on the source side
 */

/**
 * @typedef {Object} ManifestEntry
 * @property {string} pluginRef
 * @property {ArtifactKind} kind
 * @property {string} name
 * @property {string} sourceHash   source dir/file hash at last copy
 * @property {string} targetHash   target dir/file hash at last copy
 * @property {string} copiedAt     ISO timestamp of the copy
 */

/**
 * @typedef {Object} Manifest
 * @property {number} version
 * @property {Object<string, ManifestEntry>} [projectScope] // keyed `${kind}/${name}`
 * @property {Object<string, ManifestEntry>} [userScope]
 */

/**
 * @typedef {"synced" | "stale-source" | "diverged" | "orphan" | "missing" | "silent-user-edit" | "seeded"} DriftStatus
 */

/**
 * @typedef {Object} DriftItem
 * @property {ArtifactKind} kind
 * @property {string} pluginRef
 * @property {string} name
 * @property {DriftStatus} status
 * @property {string} [note]
 */

/**
 * @typedef {Object} DriftReport
 * The report is scoped to a single (scope, kind) bucket.
 * @property {"project" | "user"} scope
 * @property {string} [bucket] // for user scope: "skills" | "commands"; for project scope: "skills"
 * @property {DriftItem[]} items
 * @property {string[]} warnings
 */

/**
 * @typedef {Object} FullDriftReport
 * @property {DriftReport} projectScope
 * @property {DriftReport[]} userScope // one per bucket (skills, commands)
 * @property {string[]} warnings
 */

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function normalizePath(value) {
  return String(value).replace(/\\/g, "/").replace(/\/+$/, "");
}

export function defaultClaudePluginsRoot() {
  return path.join(os.homedir(), ".claude", "plugins", "marketplaces");
}

export function defaultOpenCodeGlobalRoot() {
  return path.join(os.homedir(), ".config", "opencode");
}

export function defaultProjectManifestPath(cwd) {
  return path.join(cwd, ".opencode", MANIFEST_FILENAME);
}

export function defaultUserManifestPath(openCodeGlobalRoot) {
  return path.join(openCodeGlobalRoot, MANIFEST_FILENAME);
}

export function projectSkillsTargetRoot(cwd) {
  return path.join(cwd, ".opencode", "skills");
}

export function projectAgentsTargetRoot(cwd) {
  return path.join(cwd, ".opencode", "agent");
}

/** Skills authored in the vault itself (not shipped by any plugin). */
export function vaultLocalSkillsRoot(cwd) {
  return path.join(cwd, ".claude", "skills");
}

/** Agents authored in the vault itself. */
export function vaultLocalAgentsRoot(cwd) {
  return path.join(cwd, ".claude", "agents");
}

/** pluginRef used for artifacts that come from the vault rather than a plugin. */
export const VAULT_LOCAL_REF = "(vault-local)";

/**
 * The only plugins the user-scope sync carries into OpenCode: the harness set
 * (required + recommended in `.claude-plugin/catalog.json`). Keep this and the
 * catalog tiers in agreement by hand — a tier change here means a sync-set
 * change. Third-party marketplaces never ride along, whatever they are called.
 */
export const HARNESS_SYNC_PLUGINS = new Set([
  "workhub@workhub-marketplace",
  "engineering@workhub-marketplace",
  "obsidian@workhub-marketplace",
  "persona@workhub-marketplace",
]);

export function userSkillsTargetRoot(openCodeGlobalRoot) {
  return path.join(openCodeGlobalRoot, "skills");
}

export function userCommandsTargetRoot(openCodeGlobalRoot) {
  return path.join(openCodeGlobalRoot, "command");
}

/** Global OpenCode agent directory, mirroring the vault-local `.opencode/agent/`. */
export function userAgentsTargetRoot(openCodeGlobalRoot) {
  return path.join(openCodeGlobalRoot, "agent");
}

export function userListCachePath() {
  return path.join(os.tmpdir(), "opencode-claude-plugin-sync-user-list.json");
}

// ---------------------------------------------------------------------------
// Settings + plugin discovery
// ---------------------------------------------------------------------------

/**
 * Read the enabled plugin refs from <cwd>/.claude/settings.json.
 * Returns an array of { pluginRef, pluginName, marketplace }.
 *
 * No longer used for sync selection (plugins are user-scope only) — kept for
 * tooling that resolves files inside an enabled plugin (e.g. the secretary
 * plugin's comms-cli lookup).
 */
export function readProjectEnabledPlugins(cwd) {
  const settingsPath = path.join(cwd, ".claude", "settings.json");
  if (!existsSync(settingsPath)) {
    return [];
  }
  let settings;
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch (err) {
    throw new Error(
      `Failed to parse ${settingsPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const entries = Object.entries(settings?.enabledPlugins ?? {});
  const enabled = [];
  for (const [key, value] of entries) {
    if (value !== true) continue;
    const match = key.match(/^([^@]+)@(.+)$/);
    if (!match) continue;
    enabled.push({
      pluginRef: key,
      pluginName: match[1],
      marketplace: match[2],
    });
  }
  return enabled;
}

/**
 * Resolve the directory of a project-scope plugin's source artifacts.
 * E.g. engineering@workhub-marketplace -> ~/.claude/plugins/marketplaces/workhub-marketplace/plugins/engineering
 */
export function resolveProjectPluginRoot(plugin, claudePluginsRoot) {
  return path.join(
    claudePluginsRoot,
    plugin.marketplace,
    "plugins",
    plugin.pluginName,
  );
}

/**
 * Path of the user's Claude Code settings file, which carries the user-scope
 * `enabledPlugins`. Overridable via CLAUDE_USER_SETTINGS (e.g. WSL targeting
 * a Windows install, mirroring CLAUDE_PLUGINS_ROOT / OPENCODE_GLOBAL_ROOT).
 */
export function userClaudeSettingsPath() {
  return process.env.CLAUDE_USER_SETTINGS ||
    path.join(os.homedir(), ".claude", "settings.json");
}

/**
 * Read the user-scope enabled plugin refs from the user settings file.
 * Same shape as readProjectEnabledPlugins. A missing or unparseable file
 * means "nothing enabled" (an opencode-only machine) — never an error, so
 * callers degrade to syncing nothing instead of failing the session.
 */
export function readUserEnabledPlugins() {
  const settingsPath = userClaudeSettingsPath();
  if (!existsSync(settingsPath)) {
    return [];
  }
  let settings;
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch {
    return [];
  }
  const entries = Object.entries(settings?.enabledPlugins ?? {});
  const enabled = [];
  for (const [key, value] of entries) {
    if (value !== true) continue;
    const match = key.match(/^([^@]+)@(.+)$/);
    if (!match) continue;
    enabled.push({
      pluginRef: key,
      pluginName: match[1],
      marketplace: match[2],
    });
  }
  return enabled;
}

/**
 * Enumerate the vault's own `.claude/skills` artifacts for the vault-local
 * mirror (`.opencode/skills/`). Plugins are user-scope only, so no plugin
 * allowlist is consulted here — anything beyond the vault's own skills comes
 * through the user-scope sync instead.
 *
 * Manifest bucket key stays "projectScope-skills": existing manifests keep
 * working, and copies whose plugin source is gone surface as orphans for
 * `--prune` to collect during migration.
 */
export function discoverVaultLocalSkillSources(cwd) {
  const targetRoot = projectSkillsTargetRoot(cwd);
  const sources = [];
  const warnings = [];
  appendVaultLocalSources({
    sources,
    warnings,
    dir: vaultLocalSkillsRoot(cwd),
    kind: "skill",
    dirsOnly: true,
  });
  return { sources, warnings, targetRoot };
}

/**
 * Collect the vault's own `.claude/skills` / `.claude/agents` artifacts into a
 * discovery result. `taken` guards against a name resolving to two sources;
 * the vault-local mirror is the only contributor now, so it stays empty, but
 * the guard is kept so a future source cannot silently shadow these.
 */
function appendVaultLocalSources({ sources, warnings, dir, kind, dirsOnly }) {
  if (!existsSync(dir)) return;
  const taken = new Set(sources.map((source) => source.name));
  for (const name of listChildNames(dir, dirsOnly)) {
    if (!dirsOnly && !name.endsWith(".md")) continue;
    if (dirsOnly && !existsSync(path.join(dir, name, "SKILL.md"))) continue;
    if (taken.has(name)) {
      warnings.push(
        `${VAULT_LOCAL_REF} -> ${path.join(dir, name)} (skipped: a plugin already provides "${name}")`,
      );
      continue;
    }
    sources.push({
      kind,
      pluginRef: VAULT_LOCAL_REF,
      name,
      sourcePath: path.join(dir, name),
    });
  }
}

/**
 * Enumerate the vault's own `.claude/agents` definitions for the vault-local
 * mirror (`.opencode/agent/`, converted to OpenCode's frontmatter on the way).
 * Plugin agents come through the user-scope sync instead (see
 * discoverUserScopeSources). Manifest bucket key stays "projectScope-agents"
 * for the same migration reason as the skills bucket above.
 */
export function discoverVaultLocalAgentSources(cwd) {
  const targetRoot = projectAgentsTargetRoot(cwd);
  const sources = [];
  const warnings = [];
  appendVaultLocalSources({
    sources,
    warnings,
    dir: vaultLocalAgentsRoot(cwd),
    kind: "agent",
    dirsOnly: false,
  });
  return { sources, warnings, targetRoot };
}

// ---------------------------------------------------------------------------
// User-scope plugin discovery (relies on `claude plugin list`)
// ---------------------------------------------------------------------------

/**
 * Parse the textual output of `claude plugin list` into structured plugin records.
 * Mirrors the parsing in sync-claude-user-plugins.mjs (now refactored to call this).
 */
export function parseUserScopePluginList(output) {
  const lines = String(output).split(/\r?\n/);
  const plugins = [];
  const warnings = [];
  let current = null;
  for (const line of lines) {
    const pluginMatch = line.match(/^\s*[❯>]\s+([^@\s]+)@([^\s]+)\s*$/u);
    if (pluginMatch) {
      if (current) plugins.push(current);
      current = {
        pluginName: pluginMatch[1],
        marketplace: pluginMatch[2],
        version: null,
        scope: null,
        status: null,
      };
      continue;
    }
    if (!current) continue;
    const versionMatch = line.match(/^\s*Version:\s+(.+)\s*$/);
    if (versionMatch) {
      current.version = versionMatch[1].trim();
      continue;
    }
    const scopeMatch = line.match(/^\s*Scope:\s+(.+)\s*$/);
    if (scopeMatch) {
      current.scope = scopeMatch[1].trim();
      continue;
    }
    const statusMatch = line.match(/^\s*Status:\s+(.+)\s*$/);
    if (statusMatch) {
      current.status = statusMatch[1].trim();
    }
  }
  if (current) plugins.push(current);

  for (const plugin of plugins) {
    if (!plugin.scope) {
      warnings.push(
        `Missing scope metadata for ${plugin.pluginName}@${plugin.marketplace}`,
      );
    }
  }
  if (plugins.length === 0) {
    warnings.push("No plugin entries could be parsed from `claude plugin list`.");
  }
  return { plugins, warnings };
}

function userTtlMs() {
  const env = Number(process.env[ENV_USER_CACHE_TTL]);
  if (Number.isFinite(env) && env >= 0) return env;
  return DEFAULT_USER_LIST_CACHE_TTL_MS;
}

/**
 * Try to read a cached `claude plugin list` output; returns null if missing/stale.
 */
export function readUserScopePluginListCached() {
  const cachePath = userListCachePath();
  if (!existsSync(cachePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(cachePath, "utf8"));
    if (
      typeof raw === "object" && raw &&
      typeof raw.fetchedAt === "number" &&
      typeof raw.output === "string"
    ) {
      const age = Date.now() - raw.fetchedAt;
      if (age <= userTtlMs()) return raw.output;
    }
  } catch {
    // ignore corrupt cache
  }
  return null;
}

/**
 * Fetch `claude plugin list` output (cached if fresh, else spawn claude).
 * Throws when `claude` is unavailable. Pass { noThrow: true } to suppress and
 * return null (used by the reminder plugin so it can degrade gracefully).
 */
export async function fetchUserScopePluginListOutput({ noThrow = false } = {}) {
  const cached = readUserScopePluginListCached();
  if (cached !== null) return cached;

  try {
    const output = execFileSync("claude", ["plugin", "list"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    persistUserScopePluginList(output);
    return output;
  } catch (err) {
    if (noThrow) return null;
    const stderr = err.stderr ? String(err.stderr).trim() : "";
    throw new Error(
      `Failed to run \`claude plugin list\`: ${stderr || (err instanceof Error ? err.message : String(err))}`,
    );
  }
}

function persistUserScopePluginList(output) {
  try {
    writeFileSync(userListCachePath(), JSON.stringify({ fetchedAt: Date.now(), output }));
  } catch {
    // cache is best-effort
  }
}

/**
 * Enumerate source artifacts for user-scope plugins. Returns sources split by
 * bucket (skills / commands) plus warnings. Both buckets target the global
 * OpenCode directories under openCodeGlobalRoot.
 *
 * Pass `listOutput` to skip the claude CLI call (used by sync scripts that have
 * already fetched the list and want deterministic behavior).
 */
export function discoverUserScopeSources({
  claudePluginsRoot,
  openCodeGlobalRoot,
  listOutput,
  enabledRefs,
}) {
  const root = claudePluginsRoot || defaultClaudePluginsRoot();
  const ocRoot = openCodeGlobalRoot || defaultOpenCodeGlobalRoot();
  const skillsTarget = userSkillsTargetRoot(ocRoot);
  const commandsTarget = userCommandsTargetRoot(ocRoot);
  const agentsTarget = userAgentsTargetRoot(ocRoot);

  const { plugins, warnings } = parseUserScopePluginList(listOutput);
  const userScopePlugins = plugins.filter((p) => p.scope === "user");
  // Only plugins the owner actually enabled (user `enabledPlugins`) are
  // synced — a plugin switched off in Claude Code must disappear from
  // OpenCode too. Project-scope enables are deliberately ignored: syncing
  // them globally would leak one vault's choices onto the whole machine.
  const enabled = enabledRefs ?? new Set(readUserEnabledPlugins().map((p) => p.pluginRef));
  // …and only the harness set at that: a skill syncs mechanically, but a
  // plugin's hooks need a hand-written OpenCode port, which exists solely for
  // these four (required + recommended in `.claude-plugin/catalog.json`).
  // Anything else stays Claude-only, so opencode sessions never inherit a
  // half-working plugin or third-party content unasked.
  const skippedDisabled = [];
  const skippedOutsideHarness = [];
  const skillsSources = [];
  const commandsSources = [];
  const agentsSources = [];
  const missing = [];

  for (const plugin of userScopePlugins) {
    const pluginRef = `${plugin.pluginName}@${plugin.marketplace}`;
    if (!HARNESS_SYNC_PLUGINS.has(pluginRef)) {
      skippedOutsideHarness.push(pluginRef);
      continue;
    }
    if (!enabled.has(pluginRef)) {
      skippedDisabled.push(pluginRef);
      continue;
    }
    const pluginRoot = path.join(root, plugin.marketplace, "plugins", plugin.pluginName);
    if (!existsSync(pluginRoot)) {
      missing.push(`${pluginRef} -> ${pluginRoot}`);
      continue;
    }
    // skills (directories)
    const skillsDir = path.join(pluginRoot, "skills");
    if (existsSync(skillsDir)) {
      for (const name of listChildNames(skillsDir, true)) {
        skillsSources.push({
          kind: "skill",
          pluginRef,
          name,
          sourcePath: path.join(skillsDir, name),
        });
      }
    }
    // commands (files in commands/ root)
    const commandsDir = path.join(pluginRoot, "commands");
    if (existsSync(commandsDir)) {
      for (const name of listChildNames(commandsDir, false)) {
        if (!name.toLowerCase().endsWith(".md")) continue;
        commandsSources.push({
          kind: "command",
          pluginRef,
          name,
          sourcePath: path.join(commandsDir, name),
        });
      }
    }
    // agents (files in agents/ root, converted to OpenCode frontmatter on copy)
    const agentsDir = path.join(pluginRoot, "agents");
    if (existsSync(agentsDir)) {
      for (const name of listChildNames(agentsDir, false)) {
        if (!name.endsWith(".md")) continue;
        agentsSources.push({
          kind: "agent",
          pluginRef,
          name,
          sourcePath: path.join(agentsDir, name),
        });
      }
    }
  }

  if (skippedDisabled.length > 0) {
    warnings.push(
      `Skipped disabled user-scope plugins (not in user enabledPlugins): ${skippedDisabled.sort().join(", ")} — enable in Claude Code to sync them.`,
    );
  }

  return {
    skillsSources,
    commandsSources,
    agentsSources,
    targets: { skillsTarget, commandsTarget, agentsTarget },
    skippedOutsideHarness: skippedOutsideHarness.sort(),
    warnings: warnings.concat(missing.map((m) => `Missing plugin root: ${m}`)),
  };
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

export function hashFile(filePath) {
  const h = crypto.createHash("sha1");
  const buf = readFileSync(filePath);
  h.update(filePath.replace(/\\/g, "/"));
  h.update("\0");
  h.update(buf);
  return h.digest("hex");
}

/**
 * Stable recursive directory SHA1. Contributions: relative path (forward-slash
 * normalized) + file contents, in lexicographic order so the hash is repeatable
 * across platforms.
 */
export function hashDirectory(dirPath) {
  const h = crypto.createHash("sha1");
  const stack = [""];
  const collected = [];
  while (stack.length) {
    const rel = stack.pop();
    const abs = path.join(dirPath, rel);
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        stack.push(entryRel);
      } else if (entry.isFile()) {
        collected.push(entryRel);
      }
    }
  }
  collected.sort();
  for (const entryRel of collected) {
    h.update(entryRel.replace(/\\/g, "/"));
    h.update("\0");
    try {
      h.update(readFileSync(path.join(dirPath, entryRel)));
    } catch {
      // unreadable file -> incorporate placeholder so hash changes
      h.update("<unreadable>");
    }
    h.update("\0");
  }
  return h.digest("hex");
}

export function hashArtifact(absPath) {
  if (!existsSync(absPath)) return "";
  const stat = statSync(absPath);
  return stat.isDirectory() ? hashDirectory(absPath) : hashFile(absPath);
}

// ---------------------------------------------------------------------------
// Manifest I/O
// ---------------------------------------------------------------------------

export function loadManifest(manifestPath) {
  if (!existsSync(manifestPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (!raw || typeof raw !== "object" || raw.version !== MANIFEST_VERSION) {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

export function writeManifest(manifestPath, manifest) {
  mkdirSync(path.dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

export function emptyManifest() {
  return { version: MANIFEST_VERSION, buckets: {} };
}

function ensureBucket(manifest, scopeKey) {
  if (!manifest.buckets) manifest.buckets = {};
  if (!manifest.buckets[scopeKey]) manifest.buckets[scopeKey] = {};
  return manifest.buckets[scopeKey];
}

/**
 * @param {Object} args
 * @param {boolean} [args.allowStaleTarget=false] if the existing target's hash
 *   differs from what's in the manifest, keep the existing target hash tag (the
 *   user hand-edited) instead of overwriting with the freshly-copied source's
 *   hash. Only meaningful for sync that respects existing hand-edits.
 */
/**
 * Record a freshly-copied artifact in a manifest bucket.
 */
export function manifestSet({
  manifest,
  scopeKey, // e.g. "projectScope-skills", "userScope-skills", "userScope-commands"
  source,
  sourceHash,
  targetHash,
  copiedAt,
}) {
  const bucket = ensureBucket(manifest, scopeKey);
  bucket[`${source.kind}/${source.name}`] = {
    pluginRef: source.pluginRef,
    kind: source.kind,
    name: source.name,
    sourceHash,
    targetHash,
    copiedAt,
  };
}

/**
 * Drop manifest entries that no longer have a target on disk (e.g. user rm'd it).
 */
export function pruneManifestMissingTargets(manifest, scopeKey, targetDirForKind) {
  const bucket = ensureBucket(manifest, scopeKey);
  for (const key of Object.keys(bucket)) {
    const entry = bucket[key];
    const targetPath = path.join(targetDirForKind, entry.name);
    if (!existsSync(targetPath)) {
      delete bucket[key];
    }
  }
}

/**
 * Remove manifest entries from a bucket whose pluginRef no longer appears in the
 * current sources for that scope (orphan). Optional cleanup. By default this is a
 * no-op so we keep history even when orphaned.
 */
export function dropOrphanEntries(manifest, scopeKey, currentPluginRefs) {
  const bucket = ensureBucket(manifest, scopeKey);
  const keep = new Set(currentPluginRefs);
  for (const key of Object.keys(bucket)) {
    if (!keep.has(bucket[key].pluginRef)) {
      delete bucket[key];
    }
  }
}

// ---------------------------------------------------------------------------
// Drift detection
// ---------------------------------------------------------------------------

/**
 * Compute drift for a single (scope, kind) bucket.
 *
 * @param {Object} args
 * @param {ArtifactSource[]} args.sources current sources in this bucket
 * @param {string} args.targetDir absolute path of the target directory
 * @param {Object<string,ManifestEntry>} args.manifestBucket (or undefined)
 * @returns {DriftItem[]}
 */
export function computeBucketDrift({ sources, targetDir, manifestBucket }) {
  const items = [];
  const manifest = manifestBucket || {};
  const sourceByName = new Map(sources.map((s) => [s.name, s]));
  const seen = new Set();

  // 1. Walk manifest entries: detect orphan, missing-target, stale, diverged, user-edit.
  for (const key of Object.keys(manifest)) {
    const entry = manifest[key];
    if (entry.kind === "command" && key.startsWith("skill/")) continue; // guard
    const source = sourceByName.get(entry.name);
    const targetPath = path.join(targetDir, entry.name);
    const targetExists = existsSync(targetPath);

    if (!source) {
      // Plugin no longer provides this artifact.
      if (targetExists) {
        items.push({
          kind: entry.kind,
          pluginRef: entry.pluginRef,
          name: entry.name,
          status: "orphan",
          note: "Source artifact no longer present (plugin may be disabled/removed)",
        });
      } else {
        // Both source and target gone; nothing to flag.
      }
      seen.add(entry.name);
      continue;
    }

    if (!targetExists) {
      items.push({
        kind: source.kind,
        pluginRef: source.pluginRef,
        name: source.name,
        status: "missing",
        note: "Target deleted on disk since last sync",
      });
      seen.add(source.name);
      continue;
    }

    const currentSourceHash = hashArtifact(source.sourcePath);
    const currentTargetHash = hashArtifact(targetPath);
    const sourceChanged = currentSourceHash !== entry.sourceHash;
    const targetChanged = currentTargetHash !== entry.targetHash;

    if (sourceChanged && targetChanged && currentSourceHash !== currentTargetHash) {
      items.push({
        kind: source.kind,
        pluginRef: source.pluginRef,
        name: source.name,
        status: "diverged",
        note: "Both source and target changed since last sync; --force will overwrite hand-edits",
      });
    } else if (sourceChanged) {
      items.push({
        kind: source.kind,
        pluginRef: source.pluginRef,
        name: source.name,
        status: "stale-source",
        note: "Source content changed since last sync (re-sync with --force)",
      });
    } else if (targetChanged) {
      items.push({
        kind: source.kind,
        pluginRef: source.pluginRef,
        name: source.name,
        status: "silent-user-edit",
        note: "Target edited locally; source unchanged (no re-sync needed)",
      });
    } else {
      items.push({
        kind: source.kind,
        pluginRef: source.pluginRef,
        name: source.name,
        status: "synced",
      });
    }
    seen.add(source.name);
  }

  // 2. Walk sources we haven't seen (manifest empty or genuinely new).
  for (const source of sources) {
    if (seen.has(source.name)) continue;
    const targetPath = path.join(targetDir, source.name);
if (!existsSync(targetPath)) {
        items.push({
          kind: source.kind,
          pluginRef: source.pluginRef,
          name: source.name,
          status: "missing",
          note: "Not yet synced (no manifest entry; copy available from source)",
        });
      } else {
      // Target exists with same name as a current source, but no manifest entry.
      // Most likely a prior sync from before the manifest feature existed; treat
      // as "seeded" (informational). The next sync run will populate the manifest.
      items.push({
        kind: source.kind,
        pluginRef: source.pluginRef,
        name: source.name,
        status: "seeded",
        note: "Target predates manifest; sync --force (or a copy now) will register it",
      });
    }
  }

  return items;
}

/**
 * Drift for the vault-local skills mirror (`.claude/skills` -> `.opencode/skills/`).
 */
export function detectProjectScopeDrift({ cwd, manifestPath }) {
  const discovery = discoverVaultLocalSkillSources(cwd);
  const manifestFullPath = manifestPath || defaultProjectManifestPath(cwd);
  const manifest = loadManifest(manifestFullPath) || emptyManifest();
  const bucketKey = "projectScope-skills";
  const manifestBucket = manifest.buckets?.[bucketKey] || {};

  const items = computeBucketDrift({
    sources: discovery.sources,
    targetDir: discovery.targetRoot,
    manifestBucket,
  });

  return {
    scope: "project",
    bucket: "skills",
    targetRoot: discovery.targetRoot,
    items,
    warnings: discovery.warnings,
  };
}

/**
 * Drift for the vault-local agent mirror (`.claude/agents` -> `.opencode/agent/`).
 * Separate from the skills bucket because it has its own target directory.
 */
export function detectProjectScopeAgentDrift({ cwd, manifestPath }) {
  const discovery = discoverVaultLocalAgentSources(cwd);
  const manifest = loadManifest(manifestPath || defaultProjectManifestPath(cwd)) || emptyManifest();

  return {
    scope: "project",
    bucket: "agents",
    targetRoot: discovery.targetRoot,
    items: computeBucketDrift({
      sources: discovery.sources,
      targetDir: discovery.targetRoot,
      manifestBucket: manifest.buckets?.["projectScope-agents"] || {},
    }),
    warnings: discovery.warnings,
  };
}

/**
 * Drift for user scope (skills + commands + agents, targets under ~/.config/opencode).
 */
export function detectUserScopeDrift({
  claudePluginsRoot,
  openCodeGlobalRoot,
  manifestPath,
  listOutput,
  enabledRefs,
}) {
  const ocRoot = openCodeGlobalRoot || defaultOpenCodeGlobalRoot();
  const manifestFullPath = manifestPath || defaultUserManifestPath(ocRoot);
  const manifest = loadManifest(manifestFullPath) || emptyManifest();

  const discovery = discoverUserScopeSources({
    claudePluginsRoot,
    openCodeGlobalRoot: ocRoot,
    listOutput,
    enabledRefs,
  });

  const skillsBucket = manifest.buckets?.["userScope-skills"] || {};
  const commandsBucket = manifest.buckets?.["userScope-commands"] || {};
  const agentsBucket = manifest.buckets?.["userScope-agents"] || {};

  const skillsItems = computeBucketDrift({
    sources: discovery.skillsSources,
    targetDir: discovery.targets.skillsTarget,
    manifestBucket: skillsBucket,
  });

  const commandsItems = computeBucketDrift({
    sources: discovery.commandsSources,
    targetDir: discovery.targets.commandsTarget,
    manifestBucket: commandsBucket,
  });

  const agentsItems = computeBucketDrift({
    sources: discovery.agentsSources,
    targetDir: discovery.targets.agentsTarget,
    manifestBucket: agentsBucket,
  });

  return [
    {
      scope: "user",
      bucket: "skills",
      targetRoot: discovery.targets.skillsTarget,
      items: skillsItems,
      warnings: [],
    },
    {
      scope: "user",
      bucket: "commands",
      targetRoot: discovery.targets.commandsTarget,
      items: commandsItems,
      warnings: [],
    },
    {
      scope: "user",
      bucket: "agents",
      targetRoot: discovery.targets.agentsTarget,
      items: agentsItems,
      warnings: [],
    },
    discovery.warnings,
  ];
}

/**
 * Full drift across both scopes. The reminder plugin calls this once per session.
 * `listOutput` may be supplied to avoid spawning claude (e.g. from cached value).
 * When omitted, fetchUserScopePluginListOutput({ noThrow: true }) is used.
 */
export async function detectFullDrift({
  cwd,
  claudePluginsRoot,
  openCodeGlobalRoot,
  projectManifestPath,
  userManifestPath,
  userListOutput,
  userEnabledRefs,
} = {}) {
  const warnings = [];
  let userList = userListOutput;
  if (userList === undefined) {
    userList = await fetchUserScopePluginListOutput({ noThrow: true });
    if (userList === null) {
      warnings.push(
        "`claude plugin list` unavailable; user-scope drift skipped (install claude CLI or run /sync-claude-user-plugins manually)",
      );
    }
  }

  const projectScope = detectProjectScopeDrift({
    cwd,
    manifestPath: projectManifestPath,
  });

  const projectAgents = detectProjectScopeAgentDrift({
    cwd,
    manifestPath: projectManifestPath,
  });

  const userResult = detectUserScopeDrift({
    claudePluginsRoot,
    openCodeGlobalRoot,
    manifestPath: userManifestPath,
    listOutput: userList ?? "",
    enabledRefs: userEnabledRefs,
  });
  const userWarnings = userResult[userResult.length - 1];
  const userScopeBuckets = userResult.slice(0, 3);

  return {
    projectScope,
    projectAgents,
    userScope: userScopeBuckets,
    warnings: warnings.concat(userWarnings),
  };
}

// ---------------------------------------------------------------------------
// Reminder XML
// ---------------------------------------------------------------------------

const REMINDER_STATUSES = new Set(["missing", "stale-source", "diverged", "orphan"]);

export function hasActionableDrift(report) {
  const lists = [
    report.projectScope.items,
    report.projectAgents?.items ?? [],
    ...report.userScope.map((b) => b.items),
  ];
  for (const items of lists) {
    for (const item of items) {
      if (REMINDER_STATUSES.has(item.status)) return true;
    }
  }
  return false;
}

function bucketSection(bucket) {
  const lines = [];
  for (const item of bucket.items) {
    if (!REMINDER_STATUSES.has(item.status)) continue;
    lines.push(`- ${item.status}: ${item.kind} "${item.name}" from plugin "${item.pluginRef}"`);
    if (item.note) lines.push(`    ${item.note}`);
  }
  return lines;
}

export function buildReminderXml(report) {
  if (!hasActionableDrift(report)) return null;

  const lines = ["<claude-plugin-sync-drift>"];
  lines.push("Claude Code plugin artifacts are out of sync with OpenCode.");
  lines.push("");

  const projectLines = bucketSection(report.projectScope);
  lines.push("## Project scope (.claude/skills -> .opencode/skills/)");
  if (projectLines.length) lines.push(...projectLines);
  else lines.push("(no drift)");
  lines.push("");

  if (report.projectAgents) {
    lines.push("## Project scope (.claude/agents -> .opencode/agent/)");
    const agentLines = bucketSection(report.projectAgents);
    if (agentLines.length) lines.push(...agentLines);
    else lines.push("(no drift)");
    lines.push("");
  }

  const userTargetDir = {
    commands: "~/.config/opencode/command",
    agents: "~/.config/opencode/agent",
    skills: "~/.config/opencode/skills",
  };
  for (const bucket of report.userScope) {
    const dir = userTargetDir[bucket.bucket] ?? "~/.config/opencode/skills";
    lines.push(`## User scope (harness set, enabled only -> ${dir})`);
    const bucketLines = bucketSection(bucket);
    if (bucketLines.length) lines.push(...bucketLines);
    else lines.push("(no drift)");
    lines.push("");
  }

  if (report.warnings.length) {
    lines.push("## Warnings");
    for (const w of report.warnings) lines.push(`- ${w}`);
    lines.push("");
  }

  lines.push("## Recommended action");
  lines.push("Run the harness commands to sync, then re-confirm:");
  lines.push("  - /sync-claude-skills        (vault-local skills + agents)");
  lines.push("  - /sync-claude-user-plugins  (harness set, enabled only: commands + skills + agents)");
  lines.push("Add --force to overwrite stale/diverged targets. Note: --force will overwrite local hand-edits.");
  lines.push("");
  lines.push("Or run the diagnostic for full detail:");
  lines.push("  node .opencode/scripts/check-claude-plugin-sync.mjs");
  lines.push("</claude-plugin-sync-drift>");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Copy operations (used by sync scripts; not by the reminder plugin)
// ---------------------------------------------------------------------------

// Claude tool names -> the OpenCode tools that do the same job. Anything not
// listed (MCP tools, harness-specific tools) has no OpenCode counterpart and is
// dropped rather than guessed at.
const CLAUDE_TO_OPENCODE_TOOLS = {
  read: "read",
  grep: "grep",
  glob: "glob",
  edit: "edit",
  write: "write",
  bash: "bash",
  webfetch: "webfetch",
  task: "task",
  todowrite: "todowrite",
};

// Tools an agent must not reach unless its Claude definition asked for them.
// OpenCode grants everything by default, so a read-only agent stays read-only
// only if the mutating tools are turned off explicitly.
const OPENCODE_MUTATING_TOOLS = ["edit", "write", "bash", "patch"];

/**
 * Rewrite a Claude agent definition as an OpenCode one.
 *
 * The body (the agent's actual prompt) is carried over verbatim; only the
 * frontmatter differs between the two harnesses:
 *   - OpenCode takes the agent's name from the filename, so `name:` is dropped.
 *   - `mode: subagent` marks it as something another agent delegates to.
 *   - `tools:` becomes a map, with the mutating tools explicitly disabled.
 *   - `model:` is deliberately dropped: Claude's short aliases ("haiku") are not
 *     OpenCode model ids, and guessing a provider here would break the agent on
 *     every setup that does not use that provider.
 */
export function claudeAgentToOpenCode(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return text;
  const [, front, body] = match;

  let description = "";
  let toolsCsv = "";
  for (const line of front.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0 || /^\s/.test(line)) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "description") description = value;
    else if (key === "tools") toolsCsv = value;
  }

  const allowed = new Set();
  for (const raw of toolsCsv.split(",")) {
    const mapped = CLAUDE_TO_OPENCODE_TOOLS[raw.trim().toLowerCase()];
    if (mapped) allowed.add(mapped);
  }

  const lines = ["---"];
  if (description) lines.push(`description: ${quoteYamlValue(description)}`);
  lines.push("mode: subagent");
  if (toolsCsv) {
    lines.push("tools:");
    for (const tool of allowed) lines.push(`  ${tool}: true`);
    for (const tool of OPENCODE_MUTATING_TOOLS) {
      if (!allowed.has(tool)) lines.push(`  ${tool}: false`);
    }
  }
  lines.push("---", "");
  return `${lines.join("\n")}${body.replace(/^\r?\n/, "")}`;
}

function quoteYamlValue(value) {
  const needsQuote = /^[>|&*!%@`{[]|:\s|#|^\s|\s$/.test(value);
  return needsQuote ? `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"` : value;
}

/**
 * Copy an agent definition, converting it to OpenCode's format on the way.
 * Same contract as copySourceToTarget: existing targets are left alone unless
 * `force`, so a hand-edited agent is not silently replaced.
 */
export function writeAgentToTarget(source, targetDir, force) {
  const targetPath = path.join(targetDir, source.name);
  if (existsSync(targetPath) && !force) {
    return { copied: false, reason: "exists" };
  }
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(targetPath, claudeAgentToOpenCode(readFileSync(source.sourcePath, "utf8")));
  return { copied: true };
}

export function copySourceToTarget(source, targetDir, force) {
  if (source.kind === "agent") return writeAgentToTarget(source, targetDir, force);
  const targetPath = path.join(targetDir, source.name);
  const existedBefore = existsSync(targetPath);
  if (existedBefore && !force) {
    return { copied: false, reason: "exists" };
  }
  if (existedBefore && force) {
    rmSync(targetPath, { recursive: true, force: true });
  }
  if (source.kind === "skill") {
    mkdirSync(targetDir, { recursive: true });
    cpSync(source.sourcePath, targetPath, { recursive: true, force: true });
  } else {
    mkdirSync(targetDir, { recursive: true });
    copyFileSync(source.sourcePath, targetPath);
  }
  return { copied: true };
}

// ---------------------------------------------------------------------------
// Persona injection (read-only mirror of plugins/persona/hooks/)
//
// The persona Claude plugin styles every turn through two hooks: SessionStart
// composes the full character + compression + boundaries block
// (persona-activate.mjs), UserPromptSubmit re-asserts it in one line
// (persona-mode-tracker.mjs). OpenCode has no hook bridge, so this section
// reimplements the *read* side of that logic for the opencode persona plugin
// (vault-template/.opencode/plugins/persona-plugin.ts): state resolution,
// character discovery, level filtering, and text composition.
//
// Deliberately read-only: unlike the Claude hooks, nothing here writes the
// session flag, the statusline label, or persona.json — opencode must never
// mutate Claude-side session state. The per-session `.persona-active` flag is
// also ignored on purpose: opencode has no /persona command path, so flag
// semantics do not map, and a stale flag would leak one session's temporary
// switch into every later opencode session. Switch in the Persona tab or a
// Claude session instead; persona.json is picked up live on the next message.

const PERSONA_PLUGIN_REF = "persona@workhub-marketplace";
const PERSONA_VALID_LEVELS = ["light", "normal", "heavy"];
const PERSONA_DEFAULT_CHARACTER = "genshijin";
const PERSONA_DEFAULT_LEVEL = "normal";
const PERSONA_CHARACTER_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const PERSONA_LEVEL_HEADING_RE = /^##[ ]+(?:レベル|Level)[ ]*[:：][ ]*(.+?)[ ]*$/i;
const PERSONA_MAX_CONFIG_BYTES = 8 * 1024;
const PERSONA_MAX_CHARACTER_BYTES = 256 * 1024;

export function personaClaudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

export function personaPluginRoot(marketplacesRoot) {
  if (process.env.PERSONA_PLUGIN_ROOT) return process.env.PERSONA_PLUGIN_ROOT;
  const root = marketplacesRoot || defaultClaudePluginsRoot();
  return path.join(root, "workhub-marketplace", "plugins", "persona");
}

export function isPersonaPluginEnabled() {
  return readUserEnabledPlugins().some((p) => p.pluginRef === PERSONA_PLUGIN_REF);
}

/** Read a small config/content file; refuse symlinks, non-files, oversize. */
function readPersonaFile(target, maxBytes) {
  try {
    const st = lstatSync(target);
    if (st.isSymbolicLink() || !st.isFile() || st.size > maxBytes) return null;
    return readFileSync(target, "utf8");
  } catch {
    return null;
  }
}

function parsePersonaState(raw) {
  if (typeof raw !== "string" || !raw) return null;
  const value = raw.trim().toLowerCase();
  if (value === "off") return { enabled: false, character: null, level: null };
  const [character, level = PERSONA_DEFAULT_LEVEL] = value.split(":");
  if (!PERSONA_CHARACTER_ID_RE.test(character)) return null;
  if (!PERSONA_VALID_LEVELS.includes(level)) return null;
  return { enabled: true, character, level };
}

function personaStateFromConfigObject(obj) {
  if (!obj || typeof obj !== "object") return null;
  if (obj.enabled === false) return { enabled: false, character: null, level: null };
  const character = typeof obj.character === "string" ? obj.character.toLowerCase() : null;
  const level = typeof obj.level === "string" ? obj.level.toLowerCase() : PERSONA_DEFAULT_LEVEL;
  if (!PERSONA_CHARACTER_ID_RE.test(character)) return null;
  if (!PERSONA_VALID_LEVELS.includes(level)) return null;
  return { enabled: true, character, level };
}

function readPersonaConfigFile(target) {
  const raw = readPersonaFile(target, PERSONA_MAX_CONFIG_BYTES);
  if (raw === null) return null;
  try {
    return personaStateFromConfigObject(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Persisted persona state: PERSONA_DEFAULT env, then persona.json, then default. */
export function readPersonaState(claudeDir) {
  const dir = claudeDir || personaClaudeDir();
  const envRaw = process.env.PERSONA_DEFAULT;
  if (envRaw) {
    const parsed = parsePersonaState(envRaw);
    if (parsed) return { state: parsed, origin: "env" };
  }
  const own = readPersonaConfigFile(path.join(dir, "persona.json"));
  if (own) return { state: own, origin: "config" };
  return {
    state: { enabled: true, character: PERSONA_DEFAULT_CHARACTER, level: PERSONA_DEFAULT_LEVEL },
    origin: "default",
  };
}

/** Flat `key: value` frontmatter only, mirroring the Claude hook parser. */
function parsePersonaFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { meta: {}, body: text };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    let value = kv[2].trim();
    if (value.length > 1 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    meta[kv[1]] = value;
  }
  return { meta, body: text.slice(match[0].length) };
}

function loadPersonaCharacterFrom(dir, id, origin) {
  const raw = readPersonaFile(path.join(dir, id, "character.md"), PERSONA_MAX_CHARACTER_BYTES);
  if (raw === null) return null;
  const { meta, body } = parsePersonaFrontmatter(raw);
  if (!PERSONA_CHARACTER_ID_RE.test(meta.id) || meta.id !== id) return null;
  return {
    id,
    origin,
    name: meta.name || id,
    statusline: meta.statusline || meta.name || id,
    reminder: meta.reminder || "",
    body,
    levels: {
      light: meta.level_light || "light",
      normal: meta.level_normal || "normal",
      heavy: meta.level_heavy || "heavy",
    },
  };
}

/** Character discovery across project, user, and bundled layers (first wins). */
export function discoverPersonaCharacters({ cwd, claudeDir, pluginRoot } = {}) {
  const dir = claudeDir || personaClaudeDir();
  const root = pluginRoot || personaPluginRoot();
  const layers = [
    path.join(cwd || process.cwd(), ".claude", "personas"),
    path.join(dir, "personas"),
    path.join(root, "characters"),
  ];
  const found = new Map();
  for (const layer of layers) {
    let entries;
    try {
      entries = readdirSync(layer, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const id = entry.name;
      if (id.startsWith("_") || !PERSONA_CHARACTER_ID_RE.test(id)) continue;
      if (found.has(id)) continue;
      const character = loadPersonaCharacterFrom(layer, id, layer);
      if (character) found.set(id, character);
    }
  }
  return found;
}

/**
 * Keep the "## レベル: <label>" (or "## Level: <label>") section matching the
 * active level and drop the other two. Mirrors the Claude hook filter exactly:
 * an unrecognised level heading is kept, and any other "## " heading resets
 * the skip, so author content is never silently swallowed.
 */
export function filterPersonaLevelSections(body, keepLabel, allLabels) {
  const lines = String(body).split(/\r?\n/);
  const out = [];
  let skipping = false;
  for (const line of lines) {
    const heading = PERSONA_LEVEL_HEADING_RE.exec(line);
    if (heading) {
      const label = heading[1];
      if (label === keepLabel) {
        skipping = false;
        out.push(line);
      } else if (allLabels.includes(label)) {
        skipping = true;
      } else {
        skipping = false;
        out.push(line);
      }
      continue;
    }
    if (/^##\s+/.test(line)) skipping = false;
    if (!skipping) out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function readPersonaCoreFile(pluginRoot, name) {
  try {
    const raw = readFileSync(path.join(pluginRoot, "core", name), "utf8");
    const firstSection = raw.indexOf("\n## ");
    return firstSection === -1 ? raw.trim() : raw.slice(firstSection + 1).trim();
  } catch {
    return "";
  }
}

/** Resolve what should be in effect; mirrors resolveActive without the session flag. */
export function resolvePersonaActive({ cwd, claudeDir, pluginRoot } = {}) {
  const characters = discoverPersonaCharacters({ cwd, claudeDir, pluginRoot });
  const persisted = readPersonaState(claudeDir);
  const state = persisted.state;
  const warnings = [];

  if (!state.enabled) {
    return { enabled: false, characters, character: null, level: null, warnings };
  }

  let character = characters.get(state.character);
  let level = state.level;

  if (!character) {
    warnings.push(
      `キャラクター "${state.character}" が見つかりません。Personaタブで一覧を確認してください。` +
      `暫定的に ${PERSONA_DEFAULT_CHARACTER} を使用します。`,
    );
    character = characters.get(PERSONA_DEFAULT_CHARACTER) || null;
  }

  if (!PERSONA_VALID_LEVELS.includes(level)) level = PERSONA_DEFAULT_LEVEL;

  if (!character) {
    warnings.push("利用できるキャラクターが1つもありません。プラグインの導入状態を確認してください。");
    return { enabled: false, characters, character: null, level: null, warnings };
  }

  return { enabled: true, characters, character, level, warnings };
}

/** SessionStart-equivalent block. The switch line names the Persona tab, not /persona. */
export function composePersonaFull(active, pluginRoot) {
  const { character, level } = active;
  const levelLabel = character.levels[level] || level;
  const allLabels = PERSONA_VALID_LEVELS.map((id) => character.levels[id]);
  const characterBody = filterPersonaLevelSections(character.body, levelLabel, allLabels);
  const compression = filterPersonaLevelSections(
    readPersonaCoreFile(pluginRoot, "compression.md"),
    level,
    PERSONA_VALID_LEVELS,
  );
  const boundaries = readPersonaCoreFile(pluginRoot, "boundaries.md");

  const parts = [];
  if (active.warnings.length) parts.push(active.warnings.join("\n"));
  parts.push(
    `ペルソナ有効 — ${character.name}（${levelLabel}）\n` +
    "切替・解除はPersonaタブまたはClaude Codeの /persona で行う（このセッションでは次メッセージから反映）",
  );
  parts.push(`# キャラクター: ${character.name}\n\n${characterBody}`);
  if (compression) parts.push(`# 圧縮ルール\n\n${compression}`);
  if (boundaries) parts.push(`# 境界\n\n${boundaries}`);
  try {
    if (existsSync(path.join(personaClaudeDir(), ".genshijin-active"))) {
      parts.push(
        "WARNING: genshijin プラグインが同時に有効です。両方が毎ターン別々の口調指示を " +
        "注入するため、口調が安定しません。どちらか一方を無効にしてください。",
      );
    }
  } catch {
    // never break the chat over a presence check
  }
  return parts.join("\n\n");
}

/** Per-turn one-liner, mirroring the Claude UserPromptSubmit reminder. */
export function composePersonaReminder(active) {
  const levelLabel = active.character.levels[active.level] || active.level;
  const reminder = active.character.reminder ||
    `${active.character.name}の口調を維持。コード/コミット/PR/破壊的操作の確認は通常日本語。`;
  return `ペルソナ有効 (${active.character.name}/${levelLabel})。${reminder}`;
}

/**
 * Resolve the persona injection for one opencode message, or null when silent:
 * plugin not user-enabled, state disabled, or no character available.
 * Reads live every call so Persona-tab switches apply on the next message.
 */
export function resolvePersonaInjection({ cwd, marketplacesRoot } = {}) {
  if (!isPersonaPluginEnabled()) return null;
  const claudeDir = personaClaudeDir();
  const pluginRoot = personaPluginRoot(marketplacesRoot);
  const active = resolvePersonaActive({ cwd, claudeDir, pluginRoot });
  if (!active.enabled || !active.character) return null;
  return {
    characterName: active.character.name,
    level: active.level,
    full: composePersonaFull(active, pluginRoot),
    reminder: composePersonaReminder(active),
  };
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

function listChildNames(dir, dirsOnly) {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    const filtered = dirsOnly
      ? entries.filter((e) => e.isDirectory())
      : entries.filter((e) => e.isFile());
    return filtered.map((e) => e.name).sort();
  } catch {
    return [];
  }
}

export function logSection(label, items) {
  console.log(`\n## ${label}`);
  if (!items || items.length === 0) {
    console.log("(none)");
    return;
  }
  for (const item of items) {
    console.log(`- ${item}`);
  }
}

export function nowIso() {
  return new Date().toISOString();
}