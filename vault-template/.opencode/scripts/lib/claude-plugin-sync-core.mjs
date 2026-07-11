// Shared core for the OpenCode <-> Claude Code plugin sync tooling.
//
// This module is intentionally free of any opencode-specific imports so that it
// can be used from both:
//   - the Node scripts under .opencode/scripts/ (CLI sync + diagnostic)
//   - the TypeScript plugins under .opencode/plugins/ (drift reminder hook)
//
// Responsibilities:
//   1. Discovery: enumerate the source artifacts (skills/commands) that should
//      exist on the OpenCode side, both for project-scope plugins
//      (.claude/settings.json) and user-scope plugins (claude plugin list).
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

export function userSkillsTargetRoot(openCodeGlobalRoot) {
  return path.join(openCodeGlobalRoot, "skills");
}

export function userCommandsTargetRoot(openCodeGlobalRoot) {
  return path.join(openCodeGlobalRoot, "command");
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
 * Enumerate the source artifacts for project-scope plugins.
 * Only `skills/` are considered (the project-scope sync script only copies skills).
 * Returns ArtifactSource[] plus a warnings list (missing plugin roots etc.).
 */
export function discoverProjectScopeSources(cwd, claudePluginsRoot) {
  const targetRoot = projectSkillsTargetRoot(cwd);
  const root = claudePluginsRoot || defaultClaudePluginsRoot();
  const sources = [];
  const warnings = [];
  const enabled = readProjectEnabledPlugins(cwd);
  for (const plugin of enabled) {
    const pluginDir = resolveProjectPluginRoot(plugin, root);
    const skillsDir = path.join(pluginDir, "skills");
    if (!existsSync(skillsDir)) {
      warnings.push(`${plugin.pluginRef} -> ${skillsDir} (skills dir missing)`);
      continue;
    }
    for (const name of listChildNames(skillsDir, /*dirsOnly*/ true)) {
      sources.push({
        kind: "skill",
        pluginRef: plugin.pluginRef,
        name,
        sourcePath: path.join(skillsDir, name),
      });
    }
  }
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
    const pluginMatch = line.match(/^\s*❯\s+([^@\s]+)@([^\s]+)\s*$/u);
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
}) {
  const root = claudePluginsRoot || defaultClaudePluginsRoot();
  const ocRoot = openCodeGlobalRoot || defaultOpenCodeGlobalRoot();
  const skillsTarget = userSkillsTargetRoot(ocRoot);
  const commandsTarget = userCommandsTargetRoot(ocRoot);

  const { plugins, warnings } = parseUserScopePluginList(listOutput);
  const userScopePlugins = plugins.filter((p) => p.scope === "user");

  const skillsSources = [];
  const commandsSources = [];
  const missing = [];

  for (const plugin of userScopePlugins) {
    const pluginRef = `${plugin.pluginName}@${plugin.marketplace}`;
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
  }

  return {
    skillsSources,
    commandsSources,
    targets: { skillsTarget, commandsTarget },
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
 * Drift for the project scope (skills only, project buckets under .opencode/skills).
 */
export function detectProjectScopeDrift({ cwd, claudePluginsRoot, manifestPath }) {
  const discovery = discoverProjectScopeSources(cwd, claudePluginsRoot);
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
 * Drift for user scope (skills + commands, targets under ~/.config/opencode).
 */
export function detectUserScopeDrift({
  claudePluginsRoot,
  openCodeGlobalRoot,
  manifestPath,
  listOutput,
}) {
  const ocRoot = openCodeGlobalRoot || defaultOpenCodeGlobalRoot();
  const manifestFullPath = manifestPath || defaultUserManifestPath(ocRoot);
  const manifest = loadManifest(manifestFullPath) || emptyManifest();

  const discovery = discoverUserScopeSources({
    claudePluginsRoot,
    openCodeGlobalRoot: ocRoot,
    listOutput,
  });

  const skillsBucket = manifest.buckets?.["userScope-skills"] || {};
  const commandsBucket = manifest.buckets?.["userScope-commands"] || {};

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
    claudePluginsRoot,
    manifestPath: projectManifestPath,
  });

  const userResult = detectUserScopeDrift({
    claudePluginsRoot,
    openCodeGlobalRoot,
    manifestPath: userManifestPath,
    listOutput: userList ?? "",
  });
  const userWarnings = userResult[userResult.length - 1];
  const userScopeBuckets = userResult.slice(0, 2);

  return {
    projectScope,
    userScope: userScopeBuckets,
    warnings: warnings.concat(userWarnings),
  };
}

// ---------------------------------------------------------------------------
// Reminder XML
// ---------------------------------------------------------------------------

const REMINDER_STATUSES = new Set(["missing", "stale-source", "diverged", "orphan"]);

export function hasActionableDrift(report) {
  const lists = [report.projectScope.items, ...report.userScope.map((b) => b.items)];
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
  lines.push("## Project scope (.claude/settings.json -> .opencode/skills/)");
  if (projectLines.length) lines.push(...projectLines);
  else lines.push("(no drift)");
  lines.push("");

  for (const bucket of report.userScope) {
    const dir = bucket.bucket === "commands" ? "~/.config/opencode/command" : "~/.config/opencode/skills";
    lines.push(`## User scope (claude plugin list -> ${dir})`);
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
  lines.push("  - /sync-claude-skills        (project scope skills)");
  lines.push("  - /sync-claude-user-plugins  (user scope commands + skills)");
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

export function copySourceToTarget(source, targetDir, force) {
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