#!/usr/bin/env node
// @ts-check
/**
 * layout.mjs — single source of truth for the `.pm/` Epic machine-data
 * layout (see the "Epic snapshot layout" section of `plugins/scrum/README.md`).
 *
 * Every script that reads/writes machine-managed data under an Epic Drive
 * folder (`save-all.mjs`, `init-task.mjs`, `generate-progress-report.mjs`,
 * `migrate-epic-layout.mjs`, `sync-repo.mjs`, …) resolves its paths through
 * the helpers here instead of hardcoding `.pm/...` segments, so a future
 * rename of the root folder (or any subpath) is a one-file change.
 *
 * Layout (relative to `<epicFolder>`):
 *
 *   .pm/
 *     backlog/
 *       items/<itemId>.json
 *       docs/<docId>.md
 *       updates/<itemId>.json
 *       progress-history.json
 *     repo/
 *       repo-state.json
 *       commits.jsonl
 *       branch-diff.json
 *       branches.json
 *     reports/
 *       progress/progress-report-<date>.html
 *       spec/
 *       spikes/
 *       audits/
 *     summary.md
 *
 * `.snapshots` (the pre-`.pm` root name) is exported too, read-only, so
 * migration/guard code (`migrate-epic-layout.mjs`, the legacy-layout guards
 * in `save-all.mjs` / `generate-progress-report.mjs`) can detect it without
 * hardcoding the string themselves.
 */

import { join } from "node:path";

/** The single root folder name for all machine-managed Epic data. */
export const PM_DIR_NAME = ".pm";

/** The pre-`.pm` root folder name, kept only for migration/guard code. */
export const LEGACY_SNAPSHOTS_DIR_NAME = ".snapshots";

/** @param {string} epicFolder */
export function pmRoot(epicFolder) {
  return join(epicFolder, PM_DIR_NAME);
}

/** @param {string} epicFolder */
export function legacySnapshotsDir(epicFolder) {
  return join(epicFolder, LEGACY_SNAPSHOTS_DIR_NAME);
}

/** @param {string} epicFolder */
export function backlogDir(epicFolder) {
  return join(pmRoot(epicFolder), "backlog");
}

/** @param {string} epicFolder */
export function backlogItemsDir(epicFolder) {
  return join(backlogDir(epicFolder), "items");
}

/** @param {string} epicFolder */
export function backlogDocsDir(epicFolder) {
  return join(backlogDir(epicFolder), "docs");
}

/** @param {string} epicFolder */
export function backlogUpdatesDir(epicFolder) {
  return join(backlogDir(epicFolder), "updates");
}

/** @param {string} epicFolder */
export function backlogProgressHistoryPath(epicFolder) {
  return join(backlogDir(epicFolder), "progress-history.json");
}

/** @param {string} epicFolder */
export function repoDir(epicFolder) {
  return join(pmRoot(epicFolder), "repo");
}

/** @param {string} epicFolder */
export function repoStatePath(epicFolder) {
  return join(repoDir(epicFolder), "repo-state.json");
}

/** @param {string} epicFolder */
export function repoCommitsPath(epicFolder) {
  return join(repoDir(epicFolder), "commits.jsonl");
}

/** @param {string} epicFolder */
export function repoBranchDiffPath(epicFolder) {
  return join(repoDir(epicFolder), "branch-diff.json");
}

/** @param {string} epicFolder */
export function repoBranchesPath(epicFolder) {
  return join(repoDir(epicFolder), "branches.json");
}

/** @param {string} epicFolder */
export function reportsDir(epicFolder) {
  return join(pmRoot(epicFolder), "reports");
}

/** @param {string} epicFolder */
export function reportsProgressDir(epicFolder) {
  return join(reportsDir(epicFolder), "progress");
}

/** @param {string} epicFolder */
export function reportsSpecDir(epicFolder) {
  return join(reportsDir(epicFolder), "spec");
}

/** @param {string} epicFolder */
export function reportsSpikesDir(epicFolder) {
  return join(reportsDir(epicFolder), "spikes");
}

/** @param {string} epicFolder */
export function reportsAuditsDir(epicFolder) {
  return join(reportsDir(epicFolder), "audits");
}

/** @param {string} epicFolder */
export function summaryPath(epicFolder) {
  return join(pmRoot(epicFolder), "summary.md");
}
