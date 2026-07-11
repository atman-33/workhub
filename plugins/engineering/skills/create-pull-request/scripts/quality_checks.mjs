#!/usr/bin/env node
// @ts-check
/**
 * Cross-platform quality checks before creating a PR.
 *
 * Usage:
 *     node quality_checks.mjs [target_branch] [--output OUTPUT]
 */

import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const CODE_SUFFIXES = new Set([".py", ".js", ".ts", ".tsx", ".jsx", ".vue"]);
const DEPENDENCY_FILES = new Set([
  "requirements.txt",
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);
const TEST_MARKERS = ["test", "spec", "__tests__", ".test.", ".spec."];
const TODO_PATTERN = /\b(TODO|FIXME)\b/g;

/**
 * @typedef {{ stdout: string, returncode: number, stderr: string }} CommandResult
 */

/**
 * @param {string[]} command
 * @returns {CommandResult}
 */
function runCommand(command) {
  const result = spawnSync(command[0], command.slice(1), { encoding: "utf8" });
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
 * @param {number} size
 * @returns {string}
 */
function humanSize(size) {
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = Number(size);
  for (const unit of units) {
    if (value < 1024 || unit === units[units.length - 1]) {
      if (unit === "B") return `${Math.floor(value)}${unit}`;
      return `${value.toFixed(1)}${unit}`;
    }
    value /= 1024;
  }
  return `${size}B`;
}

/**
 * @param {string} targetBranch
 * @returns {string[]}
 */
function changedFiles(targetBranch) {
  const { stdout, returncode } = runCommand(["git", "diff", "--name-only", `${targetBranch}...HEAD`]);
  if (returncode !== 0 || !stdout) return [];
  return stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

/**
 * @param {{ name: string, status: string, message: string }[]} checks
 * @param {string} name
 * @param {string} status
 * @param {string} message
 */
function addCheck(checks, name, status, message) {
  checks.push({ name, status, message });
}

/**
 * @param {string} pathText
 * @returns {boolean}
 */
function hasTestMarker(pathText) {
  const lowered = pathText.toLowerCase();
  return TEST_MARKERS.some((marker) => lowered.includes(marker));
}

/**
 * @param {string} relativePath
 * @returns {string}
 */
function basenameOf(relativePath) {
  const parts = relativePath.split(/[\\/]/);
  return parts[parts.length - 1];
}

/**
 * @param {string} relativePath
 * @returns {string}
 */
function suffixOf(relativePath) {
  const base = basenameOf(relativePath);
  const idx = base.lastIndexOf(".");
  return idx > 0 ? base.slice(idx).toLowerCase() : "";
}

function main() {
  const { values, positionals } = parseArgs({
    options: {
      output: { type: "string" },
    },
    allowPositionals: true,
    args: process.argv.slice(2),
  });

  const targetBranch = positionals[0] ?? "main";
  const outputFile = values.output;

  const checks = [];

  const statusResult = runCommand(["git", "status", "--porcelain"]);
  if (statusResult.stdout) {
    addCheck(checks, "uncommitted_changes", "warn", "There are uncommitted changes in the working directory");
  } else {
    addCheck(checks, "uncommitted_changes", "pass", "No uncommitted changes");
  }

  const mergeBaseResult = runCommand(["git", "merge-base", "HEAD", targetBranch]);
  if (mergeBaseResult.returncode !== 0 || !mergeBaseResult.stdout) {
    const message = mergeBaseResult.stderr || `Could not determine merge-base with ${targetBranch}`;
    addCheck(checks, "merge_conflicts", "warn", message);
  } else {
    const mergeTreeResult = runCommand(["git", "merge-tree", mergeBaseResult.stdout, targetBranch, "HEAD"]);
    if (mergeTreeResult.stdout.includes("<<<<<<<")) {
      addCheck(checks, "merge_conflicts", "fail", `Merge conflicts detected with ${targetBranch}`);
    } else {
      addCheck(checks, "merge_conflicts", "pass", `No merge conflicts with ${targetBranch}`);
    }
  }

  const aheadResult = runCommand(["git", "rev-list", "--count", `${targetBranch}..HEAD`]);
  const ahead = aheadResult.returncode === 0 && /^\d+$/.test(aheadResult.stdout) ? parseInt(aheadResult.stdout, 10) : 0;
  if (ahead === 0) {
    addCheck(checks, "branch_ahead", "fail", `Current branch has no commits ahead of ${targetBranch}`);
  } else {
    addCheck(checks, "branch_ahead", "pass", `Branch is ${ahead} commit(s) ahead of ${targetBranch}`);
  }

  const files = changedFiles(targetBranch);

  let todoCount = 0;
  const largeFiles = [];
  let hasCodeChanges = false;
  let hasTestChanges = false;

  for (const relativePath of files) {
    const suffix = suffixOf(relativePath);
    const isCodeFile = CODE_SUFFIXES.has(suffix);
    if (isCodeFile) {
      if (hasTestMarker(relativePath)) {
        hasTestChanges = true;
      } else {
        hasCodeChanges = true;
      }
    }

    let stat;
    try {
      stat = statSync(relativePath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;

    if (isCodeFile) {
      let content = "";
      try {
        content = readFileSync(relativePath, "utf8");
      } catch {
        content = "";
      }
      TODO_PATTERN.lastIndex = 0;
      const matches = content.match(TODO_PATTERN);
      todoCount += matches ? matches.length : 0;
    }

    if (stat.size > 1024 * 1024) {
      largeFiles.push(`${relativePath} (${humanSize(stat.size)})`);
    }
  }

  if (todoCount) {
    addCheck(checks, "todo_comments", "warn", `Found ${todoCount} TODO/FIXME comment(s) in changed files`);
  } else {
    addCheck(checks, "todo_comments", "pass", "No TODO/FIXME comments in changed files");
  }

  if (largeFiles.length > 0) {
    addCheck(checks, "large_files", "warn", `Large files detected: ${largeFiles.join(", ")}`);
  } else {
    addCheck(checks, "large_files", "pass", "No large files");
  }

  if (hasCodeChanges && !hasTestChanges) {
    addCheck(checks, "test_coverage", "warn", "Code changes detected but no test file changes");
  } else if (hasCodeChanges && hasTestChanges) {
    addCheck(checks, "test_coverage", "pass", "Test files updated with code changes");
  } else {
    addCheck(checks, "test_coverage", "pass", "No code changes requiring tests");
  }

  if (files.some((filePath) => DEPENDENCY_FILES.has(basenameOf(filePath)))) {
    addCheck(checks, "dependencies", "warn", "Dependency files changed - ensure they are properly reviewed");
  } else {
    addCheck(checks, "dependencies", "pass", "No dependency changes");
  }

  const payload = {
    checks,
    summary: {
      failures: checks.filter((check) => check.status === "fail").length,
      warnings: checks.filter((check) => check.status === "warn").length,
    },
  };

  const rendered = JSON.stringify(payload, null, 2);
  if (outputFile) {
    mkdirSync(dirname(outputFile), { recursive: true });
    writeFileSync(outputFile, rendered + "\n", "utf8");
  } else {
    process.stdout.write(rendered + "\n");
  }

  return 0;
}

process.exitCode = main();