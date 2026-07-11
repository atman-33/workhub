#!/usr/bin/env node
// Synchronize user-scope Claude plugin commands and skills into the global
// OpenCode directories (~/.config/opencode/{command,skills}).
//
// Uses the shared core for discovery, hashing, and manifest handling so the drift
// reminder plugin and the check script agree with this script.
//
// Manifest behaviour: same as sync-claude-skills.mjs but split across two buckets
// (userScope-skills and userScope-commands) within
// <OPENCODE_GLOBAL_ROOT>/.claude-plugin-sync-manifest.json. Both are gitignored
// (the user manifest lives outside the repo by default).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  fetchUserScopePluginListOutput,
  discoverUserScopeSources,
  copySourceToTarget,
  hashArtifact,
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
  .concat(discovery.commandsSources.map((s) => s.pluginRef));
const uniquePluginRefs = [...new Set(userScopePlugins)];

if (uniquePluginRefs.length === 0 && discovery.warnings.length === 0) {
  console.log("No user-scope Claude plugins found.");
  process.exit(0);
}

fs.mkdirSync(discovery.targets.skillsTarget, { recursive: true });
fs.mkdirSync(discovery.targets.commandsTarget, { recursive: true });

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

pruneManifestMissingTargets(manifest, "userScope-skills", discovery.targets.skillsTarget);
pruneManifestMissingTargets(manifest, "userScope-commands", discovery.targets.commandsTarget);

writeManifest(manifestPath, manifest);

logSection("User-scope plugins", uniquePluginRefs);
logSection("Resolved paths", [
  `CLAUDE_PLUGINS_ROOT=${claudePluginsRoot}`,
  `OPENCODE_GLOBAL_ROOT=${openCodeRoot}`,
  `MANIFEST=${manifestPath}`,
]);
logSection("Copied", copied);
logSection("Skipped (already exists)", skipped);
logSection("Manifest seeded (target pre-existed, no copy performed)", seeded);
logSection("Parse warnings / missing plugin roots", discovery.warnings);

if (discovery.warnings.length > 0) {
  process.exitCode = 2;
}