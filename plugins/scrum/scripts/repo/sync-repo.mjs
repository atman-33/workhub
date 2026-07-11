#!/usr/bin/env node
// @ts-check
/**
 * sync-repo.mjs — pure git + fs, token-free sync of an Epic's development
 * repo into `<epicFolder>/.pm/repo/` (see `scripts/lib/layout.mjs`).
 *
 *   node sync-repo.mjs "<groupName>"
 *   node sync-repo.mjs "<groupName>" --epic-folder <path> --repo-url <url>
 *     [--epic-branch <name>] [--default-branch <name>]
 *     [--workspaces-root <path>]
 *
 * `<groupName>` resolves the Epic's `{drivePath, repo}` via
 * `resolveEpicConfig` (`monday-client.mjs`) — `repo.url` must be configured
 * (either directly or via `--repo-url` below) or the script exits with a
 * usage error. The `--epic-folder` / `--repo-url` / `--epic-branch` /
 * `--default-branch` / `--workspaces-root` flags override the corresponding
 * config value — mainly for local testing without a `.claude/scrum-context.json`,
 * but also usable as an explicit one-off override.
 *
 * Steps:
 *   1. Manage a dedicated mirror clone at `<repoWorkspacesRoot>/<repoName>`
 *      (deliberately local, never under the Drive Epic folder — Drive sync
 *      should never see a `.git` directory). Clone if missing, else
 *      `git fetch --prune origin`.
 *   2. Resolve the epic branch: `repo.epicBranch` (config or
 *      `--epic-branch`) if set; else auto-detect the newest `epic/*` remote
 *      branch by commit date; else the default branch (`origin/HEAD`, or
 *      `repo.defaultBranch` / `--default-branch`).
 *   3. Check out / fast-forward the epic branch in the mirror
 *      (`git checkout -B <branch> origin/<branch>` — the mirror is a
 *      dedicated read-only-by-convention clone, so always resetting the
 *      local branch to match its remote tracking branch is safe and simple).
 *   4. Write `<epic>/.pm/repo/repo-state.json` (overwrite), `commits.jsonl`
 *      (append-only, incremental from the previous run's `lastSyncedSha`),
 *      `branch-diff.json` (overwrite), `branches.json` (overwrite).
 *
 * Prints one JSON summary line to stdout, matching the rest of this plugin's
 * scripts. On failure, writes a plain-text message to stderr and exits
 * non-zero (same convention as every other script here — `save-all.mjs`,
 * `migrate-epic-layout.mjs`, etc. — despite this file's own module docstring
 * plan note about JSON errors; plain text keeps failure handling uniform
 * across the plugin).
 *
 * Exit codes: 0 = ok, 1 = unexpected/git error, 2 = usage error / no repo
 * configured.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  resolveEpicConfig,
  resolveRepoWorkspacesRoot,
  readFileWithBridge,
  writeFileWithBridge,
  printJson,
} from "../monday/monday-client.mjs";
import {
  repoStatePath,
  repoCommitsPath,
  repoBranchDiffPath,
  repoBranchesPath,
} from "../lib/layout.mjs";

const FIRST_RUN_COMMIT_LIMIT = 200;
const MAX_DIFF_FILES = 500;
const MAX_BRANCHES = 100;

/**
 * Run git synchronously in `cwd`, throwing a readable Error on any non-zero
 * exit or spawn failure.
 * @param {string[]} args
 * @param {string} cwd
 * @returns {string} stdout
 */
function git(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 64,
  });
  if (result.error) {
    throw new Error(`git ${args.join(" ")} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (exit ${result.status}): ${(result.stderr || "").trim()}`
    );
  }
  return result.stdout;
}

/**
 * Run git, returning `{ ok, stdout }` instead of throwing — for calls where
 * a non-zero exit is an expected outcome to branch on (e.g. "is ancestor").
 * @param {string[]} args
 * @param {string} cwd
 * @returns {{ ok: boolean, stdout: string }}
 */
function gitTry(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: result.status === 0, stdout: result.stdout || "" };
}

/**
 * @param {string[]} argv process.argv
 * @returns {{ groupName: string, epicFolder: string | null, repoUrl: string | null, epicBranch: string | null, defaultBranch: string | null, workspacesRoot: string | null }}
 */
function parseArgs(argv) {
  const rest = argv.slice(2);
  const positional = [];
  let epicFolder = null;
  let repoUrl = null;
  let epicBranch = null;
  let defaultBranch = null;
  let workspacesRoot = null;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--epic-folder") epicFolder = rest[++i];
    else if (arg === "--repo-url") repoUrl = rest[++i];
    else if (arg === "--epic-branch") epicBranch = rest[++i];
    else if (arg === "--default-branch") defaultBranch = rest[++i];
    else if (arg === "--workspaces-root") workspacesRoot = rest[++i];
    else positional.push(arg);
  }

  return {
    groupName: positional[0] || "",
    epicFolder,
    repoUrl,
    epicBranch,
    defaultBranch,
    workspacesRoot,
  };
}

/**
 * Derive a filesystem-safe repo folder name from a git remote URL: the last
 * path segment, with a trailing `.git` stripped.
 * @param {string} url
 * @returns {string}
 */
function repoNameFromUrl(url) {
  const stripped = url.replace(/\/+$/, "").replace(/\.git$/, "");
  const segments = stripped.split(/[/\\]/).filter(Boolean);
  return segments[segments.length - 1] || "repo";
}

/**
 * Ensure a dedicated mirror clone of `repoUrl` exists at `mirrorPath`,
 * cloning if missing, else `fetch --prune origin`.
 * @param {string} repoUrl
 * @param {string} mirrorPath
 */
function ensureMirror(repoUrl, mirrorPath) {
  if (existsSync(join(mirrorPath, ".git"))) {
    git(["fetch", "--prune", "origin"], mirrorPath);
    return;
  }
  const parent = join(mirrorPath, "..");
  mkdirSync(parent, { recursive: true });
  git(["clone", repoUrl, mirrorPath], parent);
}

/**
 * Resolve the default branch: explicit override/config first, else
 * `origin/HEAD`'s target branch.
 * @param {string} mirrorPath
 * @param {string | null} override
 * @returns {string}
 */
function resolveDefaultBranch(mirrorPath, override) {
  if (override) return override;
  const symref = gitTry(
    ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
    mirrorPath
  );
  if (symref.ok && symref.stdout.trim()) {
    return symref.stdout.trim().replace(/^origin\//, "");
  }
  // origin/HEAD isn't always set on a fresh clone/fetch; fall back to asking
  // the remote directly for its default branch.
  const remoteShow = gitTry(["remote", "show", "origin"], mirrorPath);
  if (remoteShow.ok) {
    const match = remoteShow.stdout.match(/HEAD branch:\s*(\S+)/);
    if (match) return match[1];
  }
  throw new Error(
    "sync-repo: could not determine the default branch (no origin/HEAD, " +
      "`git remote show origin` failed) — pass --default-branch or set " +
      "`repo.defaultBranch` in config."
  );
}

/**
 * Resolve the epic branch: config/override, else newest `epic/*` remote
 * branch by commit date, else the default branch.
 * @param {string} mirrorPath
 * @param {string | null} override
 * @param {string} defaultBranch
 * @returns {{ branch: string, method: "configured" | "auto-detected" | "default-branch" }}
 */
function resolveEpicBranch(mirrorPath, override, defaultBranch) {
  if (override) return { branch: override, method: "configured" };

  const listing = git(
    [
      "for-each-ref",
      "--sort=-committerdate",
      "--format=%(refname:short)|%(committerdate:iso-strict)",
      "refs/remotes/origin/epic/*",
    ],
    mirrorPath
  );
  const lines = listing.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length > 0) {
    const [refShort] = lines[0].split("|");
    return { branch: refShort.replace(/^origin\//, ""), method: "auto-detected" };
  }

  return { branch: defaultBranch, method: "default-branch" };
}

/**
 * Check out (or reset) `branch` in the mirror to match its remote tracking
 * branch. The mirror is a dedicated, script-managed clone, so always
 * resetting the local branch is safe and keeps this simple/robust.
 * @param {string} mirrorPath
 * @param {string} branch
 */
function checkoutBranch(mirrorPath, branch) {
  git(["checkout", "-B", branch, `origin/${branch}`], mirrorPath);
}

/**
 * @typedef {{ sha: string, author: string, date: string, subject: string, filesChanged: number, insertions: number, deletions: number, note?: string }} CommitEntry
 */

const LOG_FORMAT = "%x00%H%x1f%an%x1f%aI%x1f%s";

/**
 * Parse `git log --numstat --pretty=format:<LOG_FORMAT>` output into
 * structured commit entries, oldest-first.
 * @param {string} raw
 * @returns {CommitEntry[]}
 */
function parseLogNumstat(raw) {
  const blocks = raw.split("\x00").filter((b) => b.trim().length > 0);
  /** @type {CommitEntry[]} */
  const entries = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.length > 0);
    if (lines.length === 0) continue;
    const [sha, author, date, subject] = lines[0].split("\x1f");
    let filesChanged = 0;
    let insertions = 0;
    let deletions = 0;
    for (const line of lines.slice(1)) {
      const parts = line.split("\t");
      if (parts.length !== 3) continue;
      filesChanged += 1;
      insertions += parts[0] === "-" ? 0 : parseInt(parts[0], 10) || 0;
      deletions += parts[1] === "-" ? 0 : parseInt(parts[1], 10) || 0;
    }
    entries.push({ sha, author, date, subject, filesChanged, insertions, deletions });
  }
  // `git log` is newest-first by default; commits.jsonl reads naturally
  // oldest-first since it's appended to incrementally over time.
  return entries.reverse();
}

/**
 * Fetch commits on `epicBranch` in `range` (a git revision range/limit arg
 * list), shaped as `CommitEntry[]`, oldest-first.
 * @param {string} mirrorPath
 * @param {string[]} rangeArgs e.g. `["oldSha..epicBranch"]` or `["-200", "epicBranch"]`
 * @returns {CommitEntry[]}
 */
function fetchCommits(mirrorPath, rangeArgs) {
  const raw = git(
    ["log", ...rangeArgs, `--pretty=format:${LOG_FORMAT}`, "--numstat"],
    mirrorPath
  );
  return parseLogNumstat(raw);
}

/**
 * @param {string} sha
 * @returns {boolean}
 */
function isValidSha(sha) {
  return Boolean(sha) && /^[0-9a-f]{7,40}$/i.test(sha);
}

/**
 * Resolve commits.jsonl content + a note, given the previous repo-state (if
 * any). Handles first run (seed from merge-base, or last N commits when the
 * epic branch IS the default branch), incremental runs, and force-push
 * re-seeding when the previous `lastSyncedSha` is no longer reachable.
 * @param {string} mirrorPath
 * @param {string} epicBranch
 * @param {string} defaultBranch
 * @param {string | null} previousSha
 * @returns {{ newCommits: CommitEntry[], reseeded: boolean, note: string | null }}
 */
function resolveCommits(mirrorPath, epicBranch, defaultBranch, previousSha) {
  const sameBranch = epicBranch === defaultBranch;

  if (!previousSha) {
    const rangeArgs = sameBranch
      ? [`-${FIRST_RUN_COMMIT_LIMIT}`, epicBranch]
      : [(() => {
          const base = git(["merge-base", epicBranch, defaultBranch], mirrorPath).trim();
          return `${base}..${epicBranch}`;
        })()];
    return { newCommits: fetchCommits(mirrorPath, rangeArgs), reseeded: true, note: null };
  }

  if (!isValidSha(previousSha)) {
    return {
      newCommits: [],
      reseeded: false,
      note: `previous lastSyncedSha "${previousSha}" is not a valid sha; commits.jsonl left untouched`,
    };
  }

  const ancestorCheck = gitTry(
    ["merge-base", "--is-ancestor", previousSha, epicBranch],
    mirrorPath
  );
  if (ancestorCheck.ok) {
    return {
      newCommits: fetchCommits(mirrorPath, [`${previousSha}..${epicBranch}`]),
      reseeded: false,
      note: null,
    };
  }

  // previousSha is no longer reachable from epicBranch — most likely a
  // force-push rewrote history. Re-seed the same way a first run would.
  const rangeArgs = sameBranch
    ? [`-${FIRST_RUN_COMMIT_LIMIT}`, epicBranch]
    : [(() => {
        const base = git(["merge-base", epicBranch, defaultBranch], mirrorPath).trim();
        return `${base}..${epicBranch}`;
      })()];
  return {
    newCommits: fetchCommits(mirrorPath, rangeArgs),
    reseeded: true,
    note: `previous lastSyncedSha "${previousSha}" is no longer an ancestor of "${epicBranch}" (force-push?) — commits.jsonl re-seeded`,
  };
}

/**
 * @param {string} raw commits.jsonl content read via readFileWithBridge (or "")
 * @returns {string}
 */
function appendJsonl(raw, entries) {
  const base = raw && raw.trim() ? raw.replace(/\n?$/, "\n") : "";
  const lines = entries.map((e) => JSON.stringify(e)).join("\n");
  return entries.length > 0 ? `${base}${lines}\n` : base;
}

/**
 * Build `branch-diff.json` content: epicBranch vs defaultBranch.
 * @param {string} mirrorPath
 * @param {string} epicBranch
 * @param {string} defaultBranch
 */
function computeBranchDiff(mirrorPath, epicBranch, defaultBranch) {
  if (epicBranch === defaultBranch) {
    return { sameBranch: true, epicBranch, defaultBranch };
  }

  const aheadBy = parseInt(
    git(["rev-list", "--count", `${defaultBranch}..${epicBranch}`], mirrorPath).trim(),
    10
  ) || 0;
  const behindBy = parseInt(
    git(["rev-list", "--count", `${epicBranch}..${defaultBranch}`], mirrorPath).trim(),
    10
  ) || 0;

  const numstat = git(
    ["diff", "--numstat", `${defaultBranch}...${epicBranch}`],
    mirrorPath
  );
  /** @type {Array<{ path: string, insertions: number, deletions: number }>} */
  const files = [];
  let insertions = 0;
  let deletions = 0;
  for (const line of numstat.split("\n")) {
    const parts = line.split("\t");
    if (parts.length !== 3) continue;
    const ins = parts[0] === "-" ? 0 : parseInt(parts[0], 10) || 0;
    const del = parts[1] === "-" ? 0 : parseInt(parts[1], 10) || 0;
    insertions += ins;
    deletions += del;
    files.push({ path: parts[2], insertions: ins, deletions: del });
  }

  return {
    sameBranch: false,
    epicBranch,
    defaultBranch,
    aheadBy,
    behindBy,
    diffstat: { filesChanged: files.length, insertions, deletions },
    files: files.slice(0, MAX_DIFF_FILES),
    filesTruncated: files.length > MAX_DIFF_FILES,
  };
}

/**
 * Build `branches.json` content: remote branches derived from the epic
 * branch or matching common feature-branch prefixes.
 * @param {string} mirrorPath
 * @param {string} epicBranch
 * @param {string} defaultBranch
 */
function computeBranches(mirrorPath, epicBranch, defaultBranch) {
  const listing = git(
    [
      "for-each-ref",
      "--format=%(refname:short)|%(objectname)|%(committerdate:iso-strict)",
      "refs/remotes/origin",
    ],
    mirrorPath
  );

  /** @type {Array<{ name: string, tipSha: string, lastCommitDate: string, aheadOfEpic: number, behindEpic: number, mergedIntoEpic: boolean }>} */
  const branches = [];

  for (const line of listing.split("\n")) {
    if (!line.trim()) continue;
    const [refShort, tipSha, lastCommitDate] = line.split("|");
    if (!refShort || refShort === "origin/HEAD") continue;
    const name = refShort.replace(/^origin\//, "");
    if (name === epicBranch || name === defaultBranch) continue;

    const isFeaturePrefixed = /^(feature|fix)\//.test(name);

    // Only the epic/default branches are checked out as local branches in
    // the mirror (see `checkoutBranch`) — every other remote branch only
    // exists as `origin/<name>`, so every git ref below must use `refShort`
    // (the full `origin/<name>` form), not the display-only stripped `name`.
    const mergeBaseWithEpic = gitTry(["merge-base", refShort, epicBranch], mirrorPath);
    const mergeBaseWithDefault = gitTry(["merge-base", refShort, defaultBranch], mirrorPath);
    let derivedFromEpic = false;
    if (mergeBaseWithEpic.ok && mergeBaseWithDefault.ok) {
      const epicBaseDate = gitTry(
        ["show", "-s", "--format=%cI", mergeBaseWithEpic.stdout.trim()],
        mirrorPath
      );
      const defaultBaseDate = gitTry(
        ["show", "-s", "--format=%cI", mergeBaseWithDefault.stdout.trim()],
        mirrorPath
      );
      if (epicBaseDate.ok && defaultBaseDate.ok) {
        derivedFromEpic =
          Date.parse(epicBaseDate.stdout.trim()) > Date.parse(defaultBaseDate.stdout.trim());
      }
    }

    if (!derivedFromEpic && !isFeaturePrefixed) continue;

    const ahead = gitTry(["rev-list", "--count", `${epicBranch}..${refShort}`], mirrorPath);
    const behind = gitTry(["rev-list", "--count", `${refShort}..${epicBranch}`], mirrorPath);
    const merged = gitTry(["merge-base", "--is-ancestor", refShort, epicBranch], mirrorPath);

    branches.push({
      name,
      tipSha: tipSha.trim(),
      lastCommitDate: (lastCommitDate || "").trim(),
      aheadOfEpic: ahead.ok ? parseInt(ahead.stdout.trim(), 10) || 0 : 0,
      behindEpic: behind.ok ? parseInt(behind.stdout.trim(), 10) || 0 : 0,
      mergedIntoEpic: merged.ok,
    });

    if (branches.length >= MAX_BRANCHES) break;
  }

  return branches;
}

async function main() {
  const { groupName, epicFolder: epicFolderArg, repoUrl: repoUrlArg, epicBranch: epicBranchArg, defaultBranch: defaultBranchArg, workspacesRoot: workspacesRootArg } =
    parseArgs(process.argv);

  if (!groupName) {
    process.stderr.write(
      'sync-repo: usage: sync-repo.mjs "<groupName>" [--epic-folder <path>] ' +
        "[--repo-url <url>] [--epic-branch <name>] [--default-branch <name>] " +
        "[--workspaces-root <path>]\n"
    );
    process.exit(2);
    return;
  }

  let epicFolder = epicFolderArg;
  let repoUrl = repoUrlArg;
  let configEpicBranch = epicBranchArg;
  let configDefaultBranch = defaultBranchArg;

  if (!epicFolder || !repoUrl) {
    const config = await resolveEpicConfig(groupName);
    epicFolder = epicFolder || config.drivePath;
    if (!repoUrl) repoUrl = config.repo ? config.repo.url : null;
    if (!configEpicBranch) configEpicBranch = config.repo ? config.repo.epicBranch : null;
    if (!configDefaultBranch) configDefaultBranch = config.repo ? config.repo.defaultBranch : null;
  }

  if (!epicFolder) {
    process.stderr.write(
      `sync-repo: no --epic-folder given and no mondayEpics["${groupName}"] ` +
        "configured in `.claude/scrum-context.json`.\n"
    );
    process.exit(2);
    return;
  }
  if (!repoUrl) {
    process.stderr.write(
      `sync-repo: no --repo-url given and no repo configured for ` +
        `mondayEpics["${groupName}"].repo.url in \`.claude/scrum-context.json\`.\n`
    );
    process.exit(2);
    return;
  }

  const workspacesRoot = workspacesRootArg || (await resolveRepoWorkspacesRoot());
  const repoName = repoNameFromUrl(repoUrl);
  const mirrorPath = join(workspacesRoot, repoName);

  ensureMirror(repoUrl, mirrorPath);

  const defaultBranch = resolveDefaultBranch(mirrorPath, configDefaultBranch);
  const { branch: epicBranch, method: detectionMethod } = resolveEpicBranch(
    mirrorPath,
    configEpicBranch,
    defaultBranch
  );

  checkoutBranch(mirrorPath, epicBranch);
  const lastSyncedSha = git(["rev-parse", epicBranch], mirrorPath).trim();

  const previousStateRaw = readFileWithBridge(repoStatePath(epicFolder));
  /** @type {{ lastSyncedSha?: string } | null} */
  let previousState = null;
  if (previousStateRaw) {
    try {
      previousState = JSON.parse(previousStateRaw);
    } catch {
      previousState = null;
    }
  }

  const { newCommits, reseeded, note } = resolveCommits(
    mirrorPath,
    epicBranch,
    defaultBranch,
    previousState ? previousState.lastSyncedSha || null : null
  );

  const commitsPath = repoCommitsPath(epicFolder);
  if (reseeded) {
    writeFileWithBridge(commitsPath, appendJsonl("", newCommits));
  } else if (newCommits.length > 0) {
    const existingRaw = readFileWithBridge(commitsPath) || "";
    writeFileWithBridge(commitsPath, appendJsonl(existingRaw, newCommits));
  }

  const branchDiff = computeBranchDiff(mirrorPath, epicBranch, defaultBranch);
  writeFileWithBridge(repoBranchDiffPath(epicFolder), JSON.stringify(branchDiff, null, 2) + "\n");

  const branches = computeBranches(mirrorPath, epicBranch, defaultBranch);
  writeFileWithBridge(repoBranchesPath(epicFolder), JSON.stringify(branches, null, 2) + "\n");

  const repoState = {
    repoUrl,
    mirrorPath,
    epicBranch,
    defaultBranch,
    lastSyncedSha,
    lastSyncAt: new Date().toISOString(),
    detectionMethod,
    ...(note ? { note } : {}),
  };
  writeFileWithBridge(repoStatePath(epicFolder), JSON.stringify(repoState, null, 2) + "\n");

  printJson({
    repoUrl,
    mirrorPath,
    epicBranch,
    defaultBranch,
    detectionMethod,
    lastSyncedSha,
    commitsAppended: newCommits.length,
    commitsReseeded: reseeded,
    note,
    branchDiff: branchDiff.sameBranch
      ? { sameBranch: true }
      : { aheadBy: branchDiff.aheadBy, behindBy: branchDiff.behindBy, filesChanged: branchDiff.diffstat.filesChanged },
    branchesTracked: branches.length,
  });
}

main().catch((err) => {
  process.stderr.write(
    (err instanceof Error ? err.message : String(err)) + "\n"
  );
  process.exit(1);
});
