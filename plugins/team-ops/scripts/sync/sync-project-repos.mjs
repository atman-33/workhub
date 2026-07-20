#!/usr/bin/env node
// @ts-check
/**
 * Token-free sync of every repository configured for a project.
 *
 * For each repo in `projects/<p>/config/project.json`:
 *   1. Maintain a script-owned bare mirror under
 *      `<repoWorkspacesRoot>/<project>/<repo-name>.git` (never the user's
 *      own checkout, never inside the shared folder).
 *   2. Append commits newly reachable on the project's dev-main branch to
 *      `repos/<repo>/commits.jsonl` (incremental via lastSyncedSha).
 *   3. Overwrite `repos/<repo>/diff-vs-default.json` (dev-main vs default).
 *   4. Aggregate per-PBI activity from the new commits into
 *      `repos/<repo>/pbi-activity.json` (id extracted from commit subjects
 *      and `pbi/<id>-<slug>` branch names in merge subjects).
 *   5. Overwrite `repos/<repo>/repo-state.json`.
 *
 * Usage: node sync-project-repos.mjs <project>
 * Output: one JSON line per repo + one summary line.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  loadLocalConfig,
  loadProjectConfig,
  projectDir,
  extractPbiIds,
} from "../lib/team-config.mjs";

const project = process.argv[2];
if (!project) {
  console.error("usage: node sync-project-repos.mjs <project>");
  process.exit(1);
}

const local = loadLocalConfig();
if (!local) {
  console.error(
    "no .claude/team-context.json found — run the setup-team-context skill first",
  );
  process.exit(1);
}
const projectConfig = loadProjectConfig(local, project);
if (!projectConfig || projectConfig.repos.length === 0) {
  console.error(
    `no repos configured in projects/${project}/config/project.json`,
  );
  process.exit(1);
}

/** @param {string} cwd @param {string[]} args */
function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

/** @param {string} path @param {any} fallback */
function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

const pDir = projectDir(local, project);
const results = [];

for (const repo of projectConfig.repos) {
  const line = { repo: repo.name, ok: false, newCommits: 0, error: "" };
  try {
    // 1. mirror clone (bare, script-owned, local)
    const mirrorDir = join(local.repoWorkspacesRoot, project, `${repo.name}.git`);
    if (!existsSync(mirrorDir)) {
      mkdirSync(join(local.repoWorkspacesRoot, project), { recursive: true });
      execFileSync("git", ["clone", "--mirror", repo.url, mirrorDir], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } else {
      git(mirrorDir, ["fetch", "--prune", "origin"]);
    }

    // resolve branches
    const branches = git(mirrorDir, ["branch", "--format=%(refname:short)"])
      .split("\n")
      .filter(Boolean);
    let devMain = repo.devMainBranch;
    if (!devMain || !branches.includes(devMain)) {
      const fallback = branches.includes(repo.defaultBranch)
        ? repo.defaultBranch
        : branches[0];
      if (devMain && !branches.includes(devMain)) {
        line.error = `devMainBranch "${devMain}" not found; using "${fallback}"`;
      }
      devMain = fallback;
    }
    const defaultBranch = branches.includes(repo.defaultBranch)
      ? repo.defaultBranch
      : devMain;

    // 2. incremental commit log
    const outDir = join(pDir, "repos", repo.name);
    mkdirSync(outDir, { recursive: true });
    const statePath = join(outDir, "repo-state.json");
    const state = readJson(statePath, {});
    const range =
      state.lastSyncedSha &&
      git(mirrorDir, ["cat-file", "-t", state.lastSyncedSha]) === "commit"
        ? `${state.lastSyncedSha}..${devMain}`
        : devMain;
    const logRaw = git(mirrorDir, [
      "log",
      "--first-parent",
      "--reverse",
      "--date=iso-strict",
      "--format=%H%x1f%an%x1f%ad%x1f%s",
      range,
    ]);
    const newCommits = logRaw
      ? logRaw.split("\n").map((l) => {
          const [sha, author, date, subject] = l.split("\x1f");
          return { sha, author, date, subject };
        })
      : [];
    if (newCommits.length > 0) {
      appendFileSync(
        join(outDir, "commits.jsonl"),
        `${newCommits.map((c) => JSON.stringify(c)).join("\n")}\n`,
        "utf8",
      );
    }

    // 3. diff vs default branch
    let diff = { same: devMain === defaultBranch };
    if (devMain !== defaultBranch) {
      const [behind, ahead] = git(mirrorDir, [
        "rev-list",
        "--left-right",
        "--count",
        `${defaultBranch}...${devMain}`,
      ])
        .split(/\s+/)
        .map(Number);
      const files = git(mirrorDir, [
        "diff",
        "--name-status",
        `${defaultBranch}...${devMain}`,
      ])
        .split("\n")
        .filter(Boolean)
        .slice(0, 500);
      const shortstat = git(mirrorDir, [
        "diff",
        "--shortstat",
        `${defaultBranch}...${devMain}`,
      ]);
      diff = { same: false, ahead, behind, shortstat, files };
    }
    writeFileSync(
      join(outDir, "diff-vs-default.json"),
      `${JSON.stringify(
        { devMainBranch: devMain, defaultBranch, syncedAt: new Date().toISOString(), ...diff },
        null,
        2,
      )}\n`,
      "utf8",
    );

    // 4. per-PBI activity from the new commits
    const activityPath = join(outDir, "pbi-activity.json");
    const activity = readJson(activityPath, {});
    for (const commit of newCommits) {
      const ids = extractPbiIds(commit.subject);
      if (ids.length === 0) continue;
      let additions = 0;
      let deletions = 0;
      let filesTouched = 0;
      try {
        const numstat = git(mirrorDir, [
          "show",
          "--numstat",
          "--first-parent",
          "--format=",
          commit.sha,
        ]);
        for (const row of numstat.split("\n").filter(Boolean)) {
          const [a, d] = row.split("\t");
          additions += Number(a) || 0;
          deletions += Number(d) || 0;
          filesTouched += 1;
        }
      } catch {
        // stats are best-effort
      }
      for (const id of ids) {
        const entry = activity[id] || {
          commits: 0,
          additions: 0,
          deletions: 0,
          filesTouched: 0,
          lastCommitDate: "",
          lastSubject: "",
        };
        entry.commits += 1;
        entry.additions += additions;
        entry.deletions += deletions;
        entry.filesTouched += filesTouched;
        entry.lastCommitDate = commit.date;
        entry.lastSubject = commit.subject;
        activity[id] = entry;
      }
    }
    writeFileSync(activityPath, `${JSON.stringify(activity, null, 2)}\n`, "utf8");

    // 5. repo state
    const tipSha = git(mirrorDir, ["rev-parse", devMain]);
    writeFileSync(
      statePath,
      `${JSON.stringify(
        {
          url: repo.url,
          mirrorPath: mirrorDir,
          devMainBranch: devMain,
          defaultBranch,
          lastSyncedSha: tipSha,
          lastSyncAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    line.ok = true;
    line.newCommits = newCommits.length;
  } catch (err) {
    line.error = err instanceof Error ? err.message.split("\n")[0] : String(err);
  }
  results.push(line);
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

process.stdout.write(
  `${JSON.stringify({
    project,
    repos: results.length,
    ok: results.filter((r) => r.ok).length,
    newCommits: results.reduce((n, r) => n + r.newCommits, 0),
  })}\n`,
);
