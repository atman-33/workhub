#!/usr/bin/env node
// Synchronize the harness-set user-scope Claude plugins (workhub, engineering,
// obsidian, persona) into the global OpenCode directories
// (~/.config/opencode/{command,skills,agent,tools,lib}).
//
// Only set members enabled in the user `~/.claude/settings.json`
// `enabledPlugins` are synced — a plugin switched off in Claude Code
// disappears from OpenCode on the next sync (its stranded copies are removed
// with --prune). Anything outside the harness set stays Claude-only: a skill
// syncs mechanically, but a plugin's hooks need a hand-written OpenCode port,
// which exists solely for these four. Project-scope enables are deliberately
// ignored: syncing them globally would leak one vault's choices onto the whole
// machine.
//
// Custom tools are OpenCode-only (no Claude counterpart): they ship from the
// workhub plugin's `opencode-tools/` dir (tools/*.ts + lib/*) into the global
// `tools/` + `lib/` directories under the same enabled gating.
//
// Uses the shared core for discovery, hashing, and manifest handling so the drift
// reminder plugin and the check script agree with this script.
//
// Manifest behaviour: same as sync-claude-skills.mjs but split across four buckets
// (userScope-skills, userScope-commands, userScope-agents, userScope-tools) within
// <OPENCODE_GLOBAL_ROOT>/.claude-plugin-sync-manifest.json. Both are gitignored
// (the user manifest lives outside the repo by default).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  fetchUserScopePluginListOutput,
  discoverUserScopeSources,
  copySourceToTarget,
  copyToolToTarget,
  hashArtifact,
  hashToolSource,
  hashToolTarget,
  loadManifest,
  writeManifest,
  manifestSet,
  pruneManifestMissingTargets,
  logSection,
  nowIso,
  defaultOpenCodeGlobalRoot,
  defaultUserManifestPath,
} from "./lib/claude-plugin-sync-core.mjs";

const FORCE = process.argv.includes("--force");
const PRUNE = process.argv.includes("--prune");

const claudePluginsRoot = process.env.CLAUDE_PLUGINS_ROOT ||
  path.join(os.homedir(), ".claude", "plugins", "marketplaces");
const openCodeRoot = process.env.OPENCODE_GLOBAL_ROOT || defaultOpenCodeGlobalRoot();
const manifestPath = defaultUserManifestPath(openCodeRoot);

let listOutput;
try {
  listOutput = await fetchUserScopePluginListOutput();
  if (listOutput === null) {
    console.error("Error: `claude plugin list` produced no output.");
    process.exit(1);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const discovery = discoverUserScopeSources({
  claudePluginsRoot,
  openCodeGlobalRoot: openCodeRoot,
  listOutput,
});

const userScopePlugins = discovery.skillsSources
  .map((s) => s.pluginRef)
  .concat(discovery.commandsSources.map((s) => s.pluginRef))
  .concat(discovery.agentsSources.map((s) => s.pluginRef))
  .concat(discovery.toolsSources.map((s) => s.pluginRef));
const uniquePluginRefs = [...new Set(userScopePlugins)];

if (uniquePluginRefs.length === 0 && discovery.warnings.length === 0) {
  console.log("No enabled user-scope Claude plugins found.");
  process.exit(0);
}

fs.mkdirSync(discovery.targets.skillsTarget, { recursive: true });
fs.mkdirSync(discovery.targets.commandsTarget, { recursive: true });
if (discovery.toolsSources.length > 0) {
  fs.mkdirSync(discovery.targets.toolsTarget, { recursive: true });
  fs.mkdirSync(discovery.targets.toolsLibTarget, { recursive: true });
}

const manifest = loadManifest(manifestPath) || { version: 1, buckets: {} };
if (!manifest.buckets) manifest.buckets = {};

const timestamp = nowIso();
const copied = [];
const skipped = [];
const seeded = [];

function processBucket(scopeKey, sources, targetDir) {
  for (const source of sources) {
    const targetPath = path.join(targetDir, source.name);
    const existedBefore = fs.existsSync(targetPath);

    if (existedBefore && !FORCE) {
      skipped.push(`${source.kind}:${source.name} (${source.pluginRef})`);
      const bucket = manifest.buckets[scopeKey] || (manifest.buckets[scopeKey] = {});
      if (!bucket[`${source.kind}/${source.name}`]) {
        const sourceHash = hashArtifact(source.sourcePath);
        const targetHash = hashArtifact(targetPath);
        manifestSet({ manifest, scopeKey, source, sourceHash, targetHash, copiedAt: timestamp });
        seeded.push(`${source.kind}:${source.name} (${source.pluginRef})`);
      }
      continue;
    }

    const result = copySourceToTarget(source, targetDir, FORCE);
    if (!result.copied) {
      skipped.push(`${source.kind}:${source.name} (${source.pluginRef})`);
      continue;
    }
    const sourceHash = hashArtifact(source.sourcePath);
    const targetHash = hashArtifact(targetPath);
    manifestSet({ manifest, scopeKey, source, sourceHash, targetHash, copiedAt: timestamp });
    copied.push(`${source.kind}:${source.name} (${source.pluginRef})`);
  }
}

processBucket("userScope-skills", discovery.skillsSources, discovery.targets.skillsTarget);
processBucket("userScope-commands", discovery.commandsSources, discovery.targets.commandsTarget);

// Agents land in the global agent directory, converted to OpenCode's
// frontmatter on the way (see claudeAgentToOpenCode in the core).
if (discovery.agentsSources.length > 0) {
  fs.mkdirSync(discovery.targets.agentsTarget, { recursive: true });
  processBucket("userScope-agents", discovery.agentsSources, discovery.targets.agentsTarget);
}

// Custom tools land in the global tools directory plus the companion lib dir
// (see copyToolToTarget in the core). Hashes cover the tool file and the
// shipped lib files.
function processToolsBucket(scopeKey, sources, toolsTargetDir, libTargetDir) {
  for (const source of sources) {
    const targetPath = path.join(toolsTargetDir, source.name);
    const existedBefore = fs.existsSync(targetPath);

    if (existedBefore && !FORCE) {
      skipped.push(`${source.kind}:${source.name} (${source.pluginRef})`);
      const bucket = manifest.buckets[scopeKey] || (manifest.buckets[scopeKey] = {});
      if (!bucket[`${source.kind}/${source.name}`]) {
        const sourceHash = hashToolSource(source.sourcePath, source.libDir);
        const targetHash = hashToolTarget(targetPath, libTargetDir, source.libDir);
        manifestSet({ manifest, scopeKey, source, sourceHash, targetHash, copiedAt: timestamp });
        seeded.push(`${source.kind}:${source.name} (${source.pluginRef})`);
      }
      continue;
    }

    const result = copyToolToTarget(source, toolsTargetDir, libTargetDir, FORCE);
    if (!result.copied) {
      skipped.push(`${source.kind}:${source.name} (${source.pluginRef})`);
      continue;
    }
    const sourceHash = hashToolSource(source.sourcePath, source.libDir);
    const targetHash = hashToolTarget(targetPath, libTargetDir, source.libDir);
    manifestSet({ manifest, scopeKey, source, sourceHash, targetHash, copiedAt: timestamp });
    copied.push(`${source.kind}:${source.name} (${source.pluginRef})`);
  }
}

if (discovery.toolsSources.length > 0) {
  processToolsBucket(
    "userScope-tools",
    discovery.toolsSources,
    discovery.targets.toolsTarget,
    discovery.targets.toolsLibTarget,
  );
}

pruneManifestMissingTargets(manifest, "userScope-skills", discovery.targets.skillsTarget);
pruneManifestMissingTargets(manifest, "userScope-commands", discovery.targets.commandsTarget);
pruneManifestMissingTargets(manifest, "userScope-agents", discovery.targets.agentsTarget);
pruneManifestMissingTargets(manifest, "userScope-tools", discovery.targets.toolsTarget);

const pruned = [];
if (PRUNE) {
  // Remove manifest-tracked orphans: the source plugin no longer provides the
  // artifact (plugin disabled or removed), but the copy is still on disk.
  // Only entries the manifest knows are eligible; hand-written targets without
  // a manifest entry are never touched.
  // Note: tool orphans remove the deployed tool file; companion lib files stay
  // (they are shared and may serve hand-written tools).
  for (const [bucketKey, bucketSources, targetRoot] of [
    ["userScope-skills", discovery.skillsSources, discovery.targets.skillsTarget],
    ["userScope-commands", discovery.commandsSources, discovery.targets.commandsTarget],
    ["userScope-agents", discovery.agentsSources, discovery.targets.agentsTarget],
    ["userScope-tools", discovery.toolsSources, discovery.targets.toolsTarget],
  ]) {
    const bucket = manifest.buckets[bucketKey] || {};
    const live = new Set(bucketSources.map((source) => `${source.kind}/${source.name}`));
    for (const key of Object.keys(bucket)) {
      if (live.has(key)) continue;
      const entry = bucket[key];
      const targetPath = path.join(targetRoot, entry.name);
      if (!fs.existsSync(targetPath)) {
        delete bucket[key];
        continue;
      }
      fs.rmSync(targetPath, { recursive: true, force: true });
      delete bucket[key];
      pruned.push(`${entry.kind}:${entry.name} (${entry.pluginRef})`);
    }
  }
}

writeManifest(manifestPath, manifest);

logSection("User-scope plugins", uniquePluginRefs);
logSection("Not synced (outside the harness set)", discovery.skippedOutsideHarness);
logSection("Resolved paths", [
  `CLAUDE_PLUGINS_ROOT=${claudePluginsRoot}`,
  `OPENCODE_GLOBAL_ROOT=${openCodeRoot}`,
  `MANIFEST=${manifestPath}`,
]);
logSection("Copied", copied);
logSection("Skipped (already exists)", skipped);
logSection("Manifest seeded (target pre-existed, no copy performed)", seeded);
if (PRUNE) logSection("Pruned (orphan targets removed)", pruned);
logSection("Parse warnings / missing plugin roots", discovery.warnings);

if (discovery.warnings.length > 0) {
  process.exitCode = 2;
}