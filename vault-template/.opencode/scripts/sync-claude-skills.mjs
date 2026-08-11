#!/usr/bin/env node
// Synchronize project-scope Claude plugin skills into .opencode/skills/.
//
// Uses the shared core (lib/claude-plugin-sync-core.mjs) for discovery, hashing,
// and manifest handling, so the drift reminder plugin and the check script see
// exactly what this script did.
//
// Manifest behaviour:
//   - Whenever a skill is actually copied (target absent or --force), the
//     manifest entry is refreshed with the current source + target hashes.
//   - Skills that already exist on the target without --force are skipped, but if
//     the manifest does not yet know them (e.g. first run after the manifest
//     feature was introduced) we SEED the manifest entry with the current hashes
//     so future drift detection works without an immediate --force.
//   - The manifest file lives at .opencode/.claude-plugin-sync-manifest.json and
//     is gitignored (per-machine baseline; do not commit).
import fs from "node:fs";
import path from "node:path";

import {
  discoverProjectScopeSources,
  discoverProjectScopeAgentSources,
  copySourceToTarget,
  hashArtifact,
  loadManifest,
  writeManifest,
  manifestSet,
  pruneManifestMissingTargets,
  logSection,
  nowIso,
  defaultProjectManifestPath,
  projectSkillsTargetRoot,
} from "./lib/claude-plugin-sync-core.mjs";

const FORCE = process.argv.includes("--force");
const cwd = process.cwd();
const claudePluginsRoot = process.env.CLAUDE_PLUGINS_ROOT || undefined;
const manifestPath = defaultProjectManifestPath(cwd);
const targetSkillsRoot = projectSkillsTargetRoot(cwd);
const scopeKey = "projectScope-skills";
const agentsScopeKey = "projectScope-agents";

const { sources, warnings } = discoverProjectScopeSources(cwd, claudePluginsRoot);

if (sources.length === 0 && warnings.length === 0) {
  console.log("No enabled project-scope Claude plugins found in .claude/settings.json.");
  process.exit(0);
}

fs.mkdirSync(targetSkillsRoot, { recursive: true });

const manifest = loadManifest(manifestPath) || { version: 1, buckets: {} };
if (!manifest.buckets) manifest.buckets = {};

const copied = [];
const skipped = [];
const seeded = [];

const timestamp = nowIso();

function processBucket(bucketKey, bucketSources, targetRoot) {
  for (const source of bucketSources) {
    const targetPath = path.join(targetRoot, source.name);

    if (fs.existsSync(targetPath) && !FORCE) {
      skipped.push(source.name);
      const bucket = manifest.buckets[bucketKey] || (manifest.buckets[bucketKey] = {});
      if (!bucket[`${source.kind}/${source.name}`]) {
        // First-time seeding: target predates the manifest (likely from the old
        // non-manifest sync script). Record hashes so future drift detection works
        // without forcing a mismatched copy.
        manifestSet({
          manifest,
          scopeKey: bucketKey,
          source,
          sourceHash: hashArtifact(source.sourcePath),
          targetHash: hashArtifact(targetPath),
          copiedAt: timestamp,
        });
        seeded.push(`${source.pluginRef}/${source.name}`);
      }
      continue;
    }

    if (!copySourceToTarget(source, targetRoot, FORCE).copied) {
      skipped.push(source.name);
      continue;
    }

    manifestSet({
      manifest,
      scopeKey: bucketKey,
      source,
      sourceHash: hashArtifact(source.sourcePath),
      targetHash: hashArtifact(targetPath),
      copiedAt: timestamp,
    });
    copied.push(`${source.pluginRef}/${source.name}`);
  }
}

processBucket(scopeKey, sources, targetSkillsRoot);

// Agents live in the same plugins but land in .opencode/agent/, converted to
// OpenCode's frontmatter on the way (see claudeAgentToOpenCode).
const agentDiscovery = discoverProjectScopeAgentSources(cwd, claudePluginsRoot);
if (agentDiscovery.sources.length > 0) {
  fs.mkdirSync(agentDiscovery.targetRoot, { recursive: true });
  processBucket(agentsScopeKey, agentDiscovery.sources, agentDiscovery.targetRoot);
}
warnings.push(...agentDiscovery.warnings);

// Drop manifest entries whose target disappeared (user rm'd the dir manually).
pruneManifestMissingTargets(manifest, scopeKey, targetSkillsRoot);
pruneManifestMissingTargets(manifest, agentsScopeKey, agentDiscovery.targetRoot);

writeManifest(manifestPath, manifest);

logSection("Copied", copied);
logSection("Skipped (already exists)", skipped);
logSection("Manifest seeded (target pre-existed, no copy performed)", seeded);
logSection("Missing source directories (see warnings)", warnings);

if (warnings.length > 0) {
  process.exitCode = 2;
}