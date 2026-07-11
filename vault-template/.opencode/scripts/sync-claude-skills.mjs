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

for (const source of sources) {
  const targetPath = path.join(targetSkillsRoot, source.name);
  const existedBefore = fs.existsSync(targetPath);

  if (existedBefore && !FORCE) {
    skipped.push(source.name);
    const bucket = manifest.buckets[scopeKey] || (manifest.buckets[scopeKey] = {});
    if (!bucket[`skill/${source.name}`]) {
      // First-time seeding: target predates the manifest (likely from the old
      // non-manifest sync script). Record hashes so future drift detection works
      // without forcing a mismatched copy.
      const sourceHash = hashArtifact(source.sourcePath);
      const targetHash = hashArtifact(targetPath);
      manifestSet({ manifest, scopeKey, source, sourceHash, targetHash, copiedAt: timestamp });
      seeded.push(`${source.pluginRef}/${source.name}`);
    }
    continue;
  }

  const result = copySourceToTarget(source, targetSkillsRoot, FORCE);
  if (!result.copied) {
    skipped.push(source.name);
    continue;
  }

  const sourceHash = hashArtifact(source.sourcePath);
  const targetHash = hashArtifact(targetPath);
  manifestSet({ manifest, scopeKey, source, sourceHash, targetHash, copiedAt: timestamp });
  copied.push(`${source.pluginRef}/${source.name}`);
}

// Drop manifest entries whose target disappeared (user rm'd the dir manually).
pruneManifestMissingTargets(manifest, scopeKey, targetSkillsRoot);

writeManifest(manifestPath, manifest);

logSection("Copied", copied);
logSection("Skipped (already exists)", skipped);
logSection("Manifest seeded (target pre-existed, no copy performed)", seeded);
logSection("Missing source directories (see warnings)", warnings);

if (warnings.length > 0) {
  process.exitCode = 2;
}