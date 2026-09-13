#!/usr/bin/env node
// Mirror the vault's own Claude skills/agents into .opencode/.
//
// Sources are the vault-local `.claude/skills` (and `.claude/agents`), listed
// as "(vault-local)". Plugins are user-scope only and never consulted here —
// plugin skills/agents reach OpenCode through the user-scope sync
// (sync-claude-user-plugins.mjs), which targets the global OpenCode
// directories instead of this project.
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
//   - `--prune` deletes manifest-tracked orphans: targets whose source is gone
//     (e.g. a vault-local skill that was deleted, or a plugin copy stranded by
//     the move to user-scope-only plugins). Only manifest entries are
//     eligible — hand-written targets the manifest never recorded are left alone.
import fs from "node:fs";
import path from "node:path";

import {
  discoverVaultLocalSkillSources,
  discoverVaultLocalAgentSources,
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
const PRUNE = process.argv.includes("--prune");
const cwd = process.cwd();
const manifestPath = defaultProjectManifestPath(cwd);
const targetSkillsRoot = projectSkillsTargetRoot(cwd);
const scopeKey = "projectScope-skills";
const agentsScopeKey = "projectScope-agents";

const { sources, warnings } = discoverVaultLocalSkillSources(cwd);

if (sources.length === 0 && warnings.length === 0) {
  console.log(
    "Nothing to sync: no vault-local skills in .claude/skills.",
  );
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

// Vault-local agents land in .opencode/agent/, converted to OpenCode's
// frontmatter on the way (see claudeAgentToOpenCode).
const agentDiscovery = discoverVaultLocalAgentSources(cwd);
if (agentDiscovery.sources.length > 0) {
  fs.mkdirSync(agentDiscovery.targetRoot, { recursive: true });
  processBucket(agentsScopeKey, agentDiscovery.sources, agentDiscovery.targetRoot);
}
warnings.push(...agentDiscovery.warnings);

// Drop manifest entries whose target disappeared (user rm'd it manually).
pruneManifestMissingTargets(manifest, scopeKey, targetSkillsRoot);
pruneManifestMissingTargets(manifest, agentsScopeKey, agentDiscovery.targetRoot);

const pruned = [];
if (PRUNE) {
  // Remove manifest-tracked orphans: the source is gone (e.g. a deleted
  // vault-local skill, or a plugin copy stranded by the move to user-scope-only
  // plugins), but the copy is still on disk. Only entries the manifest knows
  // are eligible; hand-written targets without a manifest entry are never touched.
  for (const [bucketKey, targetRoot] of [
    [scopeKey, targetSkillsRoot],
    [agentsScopeKey, agentDiscovery.targetRoot],
  ]) {
    const bucket = manifest.buckets[bucketKey] || {};
    const live = new Set(
      (bucketKey === agentsScopeKey ? agentDiscovery.sources : sources).map(
        (source) => `${source.kind}/${source.name}`,
      ),
    );
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
      pruned.push(`${entry.pluginRef}/${entry.name}`);
    }
  }
}

writeManifest(manifestPath, manifest);

logSection("Copied", copied);
logSection("Skipped (already exists)", skipped);
logSection("Manifest seeded (target pre-existed, no copy performed)", seeded);
if (PRUNE) logSection("Pruned (orphan targets removed)", pruned);
logSection("Missing source directories (see warnings)", warnings);

if (warnings.length > 0) {
  process.exitCode = 2;
}