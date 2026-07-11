#!/usr/bin/env node
// @ts-check
/**
 * Analyze git changes and categorize them for PR creation.
 *
 * Usage:
 *     node analyze_changes.mjs [target_branch] [--output OUTPUT]
 *
 * Output: JSON with categorized changes, confidence metadata, and summary statistics.
 */

import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DOC_EXTENSIONS = new Set([".md", ".mdx", ".rst", ".txt"]);
const DOC_BASENAMES = new Set([
  "README",
  "README.md",
  "README.mdx",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "LICENSE",
  "LICENSE.md",
]);
const FRONTEND_EXTENSIONS = new Set([".tsx", ".jsx", ".css", ".scss", ".sass", ".less", ".html", ".vue", ".svelte"]);
const BACKEND_EXTENSIONS = new Set([".py", ".rb", ".go", ".rs", ".java", ".kt", ".cs", ".php", ".scala"]);
const SCRIPT_EXTENSIONS = new Set([".sh", ".bash", ".zsh", ".ps1"]);
const CONFIG_EXTENSIONS = new Set([".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".properties"]);
const ASSET_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".bmp", ".avif",
  ".ttf", ".otf", ".woff", ".woff2",
]);
const DATA_EXTENSIONS = new Set([".sql", ".csv", ".tsv", ".parquet", ".jsonl"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".js", ".mjs", ".cjs"]);
const CI_PATH_PREFIXES = [".github/workflows/", ".circleci/", ".buildkite/"];
const CI_FILENAMES = new Set(["Jenkinsfile", ".gitlab-ci.yml", "azure-pipelines.yml", "azure-pipelines.yaml"]);
const INFRA_MARKERS = new Set(["terraform", "infra", "infrastructure", "helm", "charts", "k8s", "kubernetes", "ansible"]);
const FRONTEND_MARKERS = new Set(["web", "ui", "frontend", "client"]);
const BACKEND_MARKERS = new Set(["api", "apis", "server", "backend", "worker", "workers"]);
const TEST_MARKERS = new Set(["test", "tests", "spec", "specs", "__tests__", "__snapshots__"]);
const ASSET_DIR_NAMES = new Set(["assets", "images", "img", "media", "static", "public"]);
const DATA_DIR_NAMES = new Set(["data", "fixtures", "migrations", "seeds"]);
const DEPENDENCY_FILENAMES = new Set([
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

const ISSUE_REF_PATTERN = /(?<ref>(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#\d+)/g;
const CLOSING_CLAUSE_PATTERN = /\b(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\b\s*:?\s+([^\n.;]+)/gi;
const CONVENTIONAL_COMMIT_PREFIX_PATTERN = /^(feat|fix|docs|refactor|chore|build|ci|test)(\(.+?\))?!?:\s*/i;
const COMMIT_TYPE_PATTERN = /^(feat|fix|docs|refactor|chore|build|ci|test)(\(.+\))?!?:/;

/**
 * @typedef {{ stdout: string, returncode: number, stderr: string }} CommandResult
 */

/**
 * Run a shell command and return output + return code.
 * @param {string[]} cmd
 * @returns {CommandResult}
 */
function runCommand(cmd) {
  const result = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8" });
  if (result.error) {
    return { stdout: `Error: ${result.error.message}`, returncode: 1, stderr: "" };
  }
  return {
    stdout: (typeof result.stdout === "string" ? result.stdout : "").trim(),
    returncode: typeof result.status === "number" ? result.status : 1,
    stderr: (typeof result.stderr === "string" ? result.stderr : "").trim(),
  };
}

/**
 * @param {string} filepath
 * @returns {string}
 */
function pathSuffix(filepath) {
  const base = filepath.split("/").pop() || "";
  const idx = base.lastIndexOf(".");
  return idx > 0 ? base.slice(idx).toLowerCase() : "";
}

/**
 * Get the current git branch name.
 * @returns {string}
 */
function getCurrentBranch() {
  const { stdout } = runCommand(["git", "branch", "--show-current"]);
  return stdout;
}

/**
 * Return a filesystem-safe branch slug.
 * @param {string} branchName
 * @returns {string}
 */
function sanitizeBranchName(branchName) {
  const slug = branchName.replace("/", "-").replace(/[^A-Za-z0-9._-]+/g, "-");
  return slug.replace(/^-+|-+$/g, "") || "head";
}

/**
 * Normalize local and remote branch names for comparisons.
 * @param {string} branchName
 * @returns {string}
 */
function normalizeBranchName(branchName) {
  const normalized = branchName.trim();
  const prefixes = ["refs/heads/", "refs/remotes/origin/", "origin/"];
  for (const prefix of prefixes) {
    if (normalized.startsWith(prefix)) {
      return normalized.slice(prefix.length);
    }
  }
  return normalized;
}

/**
 * Return the repository default branch name when available.
 * @returns {string}
 */
function getDefaultBranch() {
  let res = runCommand(["git", "symbolic-ref", "refs/remotes/origin/HEAD"]);
  if (res.returncode === 0 && res.stdout) {
    return normalizeBranchName(res.stdout);
  }

  res = runCommand(["git", "remote", "show", "origin"]);
  if (res.returncode !== 0 || !res.stdout) {
    return "";
  }

  const match = /HEAD branch:\s*(.+)$/m.exec(res.stdout);
  return match ? match[1].trim() : "";
}

/**
 * Get changed files with status.
 * @param {string} targetBranch
 * @returns {{ status: string, filepath: string }[]}
 */
function getChangedFiles(targetBranch) {
  const { stdout, returncode } = runCommand([
    "git",
    "diff",
    "--name-status",
    `${targetBranch}...HEAD`,
  ]);

  if (returncode !== 0 || !stdout) {
    return [];
  }

  const changes = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const tabIndex = line.indexOf("\t");
    if (tabIndex === -1) continue;
    const status = line.charAt(0);
    const filepath = line.slice(tabIndex + 1);
    changes.push({ status, filepath });
  }

  return changes;
}

/**
 * Categorize a file using generic, repository-agnostic heuristics.
 * @param {string} filepath
 * @returns {string}
 */
function categorizeFile(filepath) {
  const partsAll = filepath.split("/");
  const partsLower = partsAll.map((p) => p.toLowerCase());
  const partsSet = new Set(partsLower);
  const basename = partsAll[partsAll.length - 1];
  const basenameLower = basename.toLowerCase();
  const suffix = pathSuffix(filepath);
  const lowered = filepath.toLowerCase();

  if ([...partsSet].some((p) => TEST_MARKERS.has(p)) || /(^|[._-])(test|spec)([._-]|$)/.test(basenameLower)) {
    return "tests";
  }

  if (DOC_BASENAMES.has(basename) || DOC_EXTENSIONS.has(suffix) || partsSet.has("docs") || partsSet.has("doc")) {
    return "docs";
  }

  if (CI_PATH_PREFIXES.some((p) => lowered.startsWith(p)) || CI_FILENAMES.has(basename)) {
    return "ci";
  }

  if (basename === "Dockerfile" || basenameLower.includes("docker-compose") || [...partsSet].some((p) => INFRA_MARKERS.has(p))) {
    return "infrastructure";
  }

  if ((partsAll.length > 0 && partsLower[0] === "scripts") || SCRIPT_EXTENSIONS.has(suffix)) {
    return "scripts";
  }

  if (basename.startsWith(".") && !DOC_EXTENSIONS.has(suffix)) {
    return "config";
  }

  if (DEPENDENCY_FILENAMES.has(basename) || CONFIG_EXTENSIONS.has(suffix)) {
    return "config";
  }

  if (ASSET_EXTENSIONS.has(suffix) || [...partsSet].some((p) => ASSET_DIR_NAMES.has(p))) {
    return "assets";
  }

  if (DATA_EXTENSIONS.has(suffix) || [...partsSet].some((p) => DATA_DIR_NAMES.has(p))) {
    return "data";
  }

  if (FRONTEND_EXTENSIONS.has(suffix)) {
    return "frontend";
  }

  if (BACKEND_EXTENSIONS.has(suffix)) {
    return "backend";
  }

  if (SOURCE_EXTENSIONS.has(suffix)) {
    if ([...partsSet].some((p) => FRONTEND_MARKERS.has(p))) return "frontend";
    if ([...partsSet].some((p) => BACKEND_MARKERS.has(p))) return "backend";
    return "application";
  }

  return "other";
}

/**
 * Get commit messages (oneline) between target branch and HEAD.
 * @param {string} targetBranch
 * @returns {string[]}
 */
function getCommitMessages(targetBranch) {
  const { stdout, returncode } = runCommand(["git", "log", `${targetBranch}..HEAD`, "--oneline"]);
  if (returncode !== 0 || !stdout) return [];
  return stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

/**
 * Get full commit message bodies between target branch and HEAD.
 * @param {string} targetBranch
 * @returns {string[]}
 */
function getCommitMessageBodies(targetBranch) {
  const { stdout, returncode } = runCommand([
    "git",
    "log",
    `${targetBranch}..HEAD`,
    "--format=%B%x00",
  ]);
  if (returncode !== 0 || !stdout) return [];
  return stdout.split("\x00").map((entry) => entry.trim()).filter(Boolean);
}

/**
 * Return unique values while preserving discovery order.
 * @param {string[]} values
 * @returns {string[]}
 */
function uniqueInOrder(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

/**
 * Remove a conventional commit prefix before issue parsing.
 * @param {string} message
 * @returns {string}
 */
function stripConventionalCommitPrefix(message) {
  return message.replace(CONVENTIONAL_COMMIT_PREFIX_PATTERN, "");
}

/**
 * Extract related and auto-closing issue references from commit messages.
 * @param {string[]} messages
 * @returns {{ all: string[], closing: string[], related: string[] }}
 */
function extractIssueReferences(messages) {
  const allRefs = [];
  const closingRefs = [];

  for (const message of messages) {
    const normalized = stripConventionalCommitPrefix(message);
    ISSUE_REF_PATTERN.lastIndex = 0;
    for (const m of normalized.matchAll(ISSUE_REF_PATTERN)) {
      if (m.groups && m.groups.ref) allRefs.push(m.groups.ref);
    }

    CLOSING_CLAUSE_PATTERN.lastIndex = 0;
    for (const clause of normalized.matchAll(CLOSING_CLAUSE_PATTERN)) {
      const clauseText = clause[1] || "";
      ISSUE_REF_PATTERN.lastIndex = 0;
      for (const m of clauseText.matchAll(ISSUE_REF_PATTERN)) {
        if (m.groups && m.groups.ref) closingRefs.push(m.groups.ref);
      }
    }
  }

  const allUnique = uniqueInOrder(allRefs);
  const allSet = new Set(allUnique);
  const closingUnique = uniqueInOrder(closingRefs).filter((ref) => allSet.has(ref));
  const closingSet = new Set(closingUnique);
  const relatedRefs = allUnique.filter((ref) => !closingSet.has(ref));

  return { all: allUnique, closing: closingUnique, related: relatedRefs };
}

/**
 * Get diff statistics (files, insertions, deletions).
 * @param {string} targetBranch
 * @returns {{ files: number, insertions: number, deletions: number }}
 */
function getDiffStats(targetBranch) {
  const { stdout, returncode } = runCommand(["git", "diff", "--shortstat", `${targetBranch}...HEAD`]);
  if (returncode !== 0 || !stdout) {
    return { files: 0, insertions: 0, deletions: 0 };
  }

  const stats = { files: 0, insertions: 0, deletions: 0 };
  const filesMatch = /(\d+) files? changed/.exec(stdout);
  const insertionsMatch = /(\d+) insertions?/.exec(stdout);
  const deletionsMatch = /(\d+) deletions?/.exec(stdout);

  if (filesMatch) stats.files = parseInt(filesMatch[1], 10);
  if (insertionsMatch) stats.insertions = parseInt(insertionsMatch[1], 10);
  if (deletionsMatch) stats.deletions = parseInt(deletionsMatch[1], 10);

  return stats;
}

/**
 * @typedef {{ status: string, file: string }} FileInfo
 */

/**
 * Build a sorted status counter as a plain object.
 * @param {FileInfo[]} files
 * @returns {Record<string, number>}
 */
function countStatuses(files) {
  const counts = new Map();
  for (const file of files) {
    counts.set(file.status, (counts.get(file.status) || 0) + 1);
  }
  const entries = [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return Object.fromEntries(entries);
}

/**
 * Return compact category summaries with sample files.
 * @param {Record<string, FileInfo[]>} changesByCategory
 * @returns {{ category: string, file_count: number, samples: string[], statuses: Record<string, number> }[]}
 */
function summarizeCategories(changesByCategory) {
  const summaries = [];
  for (const [category, files] of Object.entries(changesByCategory)) {
    summaries.push({
      category,
      file_count: files.length,
      samples: files.slice(0, 3).map((f) => f.file),
      statuses: countStatuses(files),
    });
  }
  summaries.sort((a, b) => b.file_count - a.file_count || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return summaries;
}

/**
 * Summarize changed files by top-level area.
 * @param {{ status: string, filepath: string }[]} changedFiles
 * @returns {{ area: string, file_count: number, samples: string[] }[]}
 */
function summarizeTopLevelAreas(changedFiles) {
  const areaCounts = new Map();
  const areaSamples = new Map();

  for (const { filepath } of changedFiles) {
    const slashIdx = filepath.indexOf("/");
    const area = slashIdx >= 0 ? filepath.slice(0, slashIdx) : "(repo root)";
    areaCounts.set(area, (areaCounts.get(area) || 0) + 1);
    const samples = areaSamples.get(area) || [];
    if (samples.length < 3) samples.push(filepath);
    areaSamples.set(area, samples);
  }

  const summaries = [];
  for (const [area, count] of areaCounts.entries()) {
    summaries.push({ area, file_count: count, samples: areaSamples.get(area) || [] });
  }
  summaries.sort((a, b) => b.file_count - a.file_count || (a.area < b.area ? -1 : a.area > b.area ? 1 : 0));
  return summaries;
}

/**
 * Estimate whether the generic category split is trustworthy enough to show directly.
 * @param {Record<string, FileInfo[]>} changesByCategory
 * @param {number} totalFiles
 * @returns {{ strategy: string, confidence: string, matched_files: number, other_files: number, coverage: number }}
 */
function measureClassificationConfidence(changesByCategory, totalFiles) {
  const otherFiles = (changesByCategory.other || []).length;
  const coverage = totalFiles === 0 ? 1.0 : (totalFiles - otherFiles) / totalFiles;

  let confidence = "low";
  if (coverage >= 0.85) confidence = "high";
  else if (coverage >= 0.6) confidence = "medium";

  return {
    strategy: "generic",
    confidence,
    matched_files: totalFiles - otherFiles,
    other_files: otherFiles,
    coverage: Math.round(coverage * 10) / 10,
  };
}

/**
 * Return the commit subject from a `git log --oneline` entry.
 * @param {string} commitLine
 * @returns {string}
 */
function extractCommitSubject(commitLine) {
  const spaceIdx = commitLine.indexOf(" ");
  return spaceIdx >= 0 ? commitLine.slice(spaceIdx + 1) : commitLine;
}

/**
 * Infer PR type from branch, changes, and commits.
 * @param {string} currentBranch
 * @param {Record<string, FileInfo[]>} changesByCategory
 * @param {string[]} commitMessages
 * @returns {string}
 */
function inferPrType(currentBranch, changesByCategory, commitMessages) {
  const branchPrefix = currentBranch.toLowerCase().split("/", 1)[0];
  const branchTypeMap = {
    feature: "feature",
    feat: "feature",
    bugfix: "bugfix",
    fix: "bugfix",
    hotfix: "bugfix",
    docs: "docs",
    doc: "docs",
    refactor: "refactor",
    chore: "chore",
    build: "chore",
    ci: "chore",
  };
  if (branchPrefix in branchTypeMap) {
    return branchTypeMap[branchPrefix];
  }

  const categories = new Set(Object.keys(changesByCategory));
  if (categories.size === 1 && categories.has("docs")) return "docs";

  const choreSubset = new Set(["config", "ci", "infrastructure", "scripts"]);
  if (categories.size > 0 && [...categories].every((c) => choreSubset.has(c))) return "chore";

  const commitTypeCounts = new Map();
  for (const message of commitMessages) {
    const subject = extractCommitSubject(message);
    const match = COMMIT_TYPE_PATTERN.exec(subject);
    if (match) {
      commitTypeCounts.set(match[1], (commitTypeCounts.get(match[1]) || 0) + 1);
    }
  }

  const totalTypedCommits = [...commitTypeCounts.values()].reduce((sum, n) => sum + n, 0);
  const fixCount = commitTypeCounts.get("fix") || 0;
  const featCount = commitTypeCounts.get("feat") || 0;

  if (totalTypedCommits > 0) {
    if (fixCount > featCount && fixCount >= Math.max(2, Math.floor((totalTypedCommits + 1) / 2))) {
      return "bugfix";
    }
    if ((commitTypeCounts.get("docs") || 0) === totalTypedCommits) return "docs";
    if (featCount > 0) return "feature";
    if ((commitTypeCounts.get("refactor") || 0) === totalTypedCommits) return "refactor";
    const choreTyped =
      (commitTypeCounts.get("chore") || 0) +
      (commitTypeCounts.get("build") || 0) +
      (commitTypeCounts.get("ci") || 0);
    if (choreTyped === totalTypedCommits) return "chore";
  }

  return "feature";
}

function main() {
  const { values, positionals } = parseArgs({
    options: {
      output: { type: "string", short: "o" },
    },
    allowPositionals: true,
    args: process.argv.slice(2),
  });

  const targetBranch = positionals[0] ?? "main";
  const outputFile = values.output;

  const currentBranch = getCurrentBranch();
  const defaultBranch = getDefaultBranch();
  const changedFiles = getChangedFiles(targetBranch);
  const commitMessages = getCommitMessages(targetBranch);
  const commitMessageBodies = getCommitMessageBodies(targetBranch);
  const issueRefs = extractIssueReferences(commitMessageBodies.length > 0 ? commitMessageBodies : commitMessages);
  const diffStats = getDiffStats(targetBranch);

  /** @type {Record<string, FileInfo[]>} */
  const changesByCategory = {};
  for (const { status, filepath } of changedFiles) {
    const category = categorizeFile(filepath);
    (changesByCategory[category] = changesByCategory[category] || []).push({ status, file: filepath });
  }

  const prType = inferPrType(currentBranch, changesByCategory, commitMessages);
  const totalFiles = changedFiles.length;
  const categorySummary = summarizeCategories(changesByCategory);
  const topLevelAreas = summarizeTopLevelAreas(changedFiles);
  const classification = measureClassificationConfidence(changesByCategory, totalFiles);

  const result = {
    current_branch: currentBranch,
    branch_slug: sanitizeBranchName(currentBranch),
    target_branch: targetBranch,
    default_branch: defaultBranch,
    target_is_default_branch: defaultBranch ? normalizeBranchName(targetBranch) === defaultBranch : false,
    pr_type: prType,
    stats: diffStats,
    commits: commitMessages,
    issue_references: issueRefs.all,
    closing_issue_references: issueRefs.closing,
    related_issue_references: issueRefs.related,
    changes_by_category: changesByCategory,
    category_summary: categorySummary,
    top_level_areas: topLevelAreas,
    classification,
    total_files: totalFiles,
  };

  const payload = JSON.stringify(result, null, 2);
  if (outputFile) {
    mkdirSync(dirname(outputFile), { recursive: true });
    writeFileSync(outputFile, payload + "\n", "utf8");
  } else {
    process.stdout.write(payload + "\n");
  }
  return 0;
}

process.exitCode = main();