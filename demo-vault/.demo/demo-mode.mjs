#!/usr/bin/env node
// Switch workhub between your real config and the demo config used for the
// README screenshots.
//
// The vault is only half of what a screenshot shows: the registered
// repositories live in the machine config at ~/.workhub/config.json, not in
// the vault. This script swaps that file for one pointing at demo-vault/ and
// at three throwaway repositories, and puts your own config back afterwards.
//
// Close workhub before running it — the app writes config.json on exit and
// would overwrite whatever this script just put there.
//
//   node demo-mode.mjs on            back up the real config, create the
//                                    throwaway repos, install the demo config
//   node demo-mode.mjs off           restore the real config
//   node demo-mode.mjs off --clean   also delete the throwaway repos
//
//   --repos <dir>   where the throwaway repositories live
//                   (default: <tmp>/workhub-demo-repos)

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const demoDir = path.dirname(fileURLToPath(import.meta.url));
const vaultDir = path.resolve(demoDir, "..");
const configDir = path.join(os.homedir(), ".workhub");
const configFile = path.join(configDir, "config.json");
const backupFile = path.join(configDir, "config.real.json");

const slash = (p) => p.split(path.sep).join("/");

function parseArgs(argv) {
  const mode = argv[0];
  if (mode !== "on" && mode !== "off") {
    fail("usage: node demo-mode.mjs <on|off> [--clean] [--repos <dir>]");
  }
  let clean = false;
  let reposDir = path.join(os.tmpdir(), "workhub-demo-repos");
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--clean") clean = true;
    else if (argv[i] === "--repos") reposDir = path.resolve(argv[++i] ?? "");
    else fail(`unknown argument: ${argv[i]}`);
  }
  return { mode, clean, reposDir };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

/**
 * Refuse to run while the app is open: workhub rewrites config.json on exit
 * and would silently undo whatever this script does.
 */
function assertAppClosed() {
  if (process.platform !== "win32") return;
  let out = "";
  try {
    out = execFileSync("tasklist", ["/FI", "IMAGENAME eq workhub.exe", "/NH"], {
      encoding: "utf8",
    });
  } catch {
    return; // no tasklist (or it failed) — not worth blocking on
  }
  if (/workhub\.exe/i.test(out)) {
    fail("workhub is running. Close it first — it rewrites config.json on exit.");
  }
}

function git(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function createDemoRepo(repoPath, branches, dirty) {
  if (fs.existsSync(path.join(repoPath, ".git"))) return;
  fs.mkdirSync(repoPath, { recursive: true });
  const name = path.basename(repoPath);
  const readme = path.join(repoPath, "README.md");

  git(repoPath, ["init", "-q", "-b", "main"]);
  git(repoPath, ["config", "user.name", "Demo User"]);
  git(repoPath, ["config", "user.email", "demo@example.invalid"]);
  fs.writeFileSync(
    readme,
    `# ${name}\n\nThrowaway repository for workhub screenshots.\n`,
  );
  git(repoPath, ["add", "-A"]);
  git(repoPath, ["commit", "-q", "-m", "chore: initial commit"]);

  for (const branch of branches) {
    git(repoPath, ["checkout", "-q", "-b", branch]);
    fs.appendFileSync(readme, `\n- work on ${branch}\n`);
    git(repoPath, ["commit", "-q", "-am", `feat: work on ${branch}`]);
    git(repoPath, ["checkout", "-q", "main"]);
  }
  if (dirty) fs.appendFileSync(readme, "\nuncommitted line\n");
}

const { mode, clean, reposDir } = parseArgs(process.argv.slice(2));

assertAppClosed();

if (mode === "off") {
  if (!fs.existsSync(backupFile)) {
    fail(
      `No backup at ${backupFile} — demo mode does not look active. Nothing was changed.`,
    );
  }
  fs.rmSync(configFile, { force: true });
  fs.renameSync(backupFile, configFile);
  console.log("Restored your config from config.real.json.");
  if (clean && fs.existsSync(reposDir)) {
    fs.rmSync(reposDir, { recursive: true, force: true });
    console.log(`Removed ${reposDir}.`);
  }
  process.exit(0);
}

if (fs.existsSync(backupFile)) {
  fail(
    `${backupFile} already exists — demo mode is already on (or a previous run did not finish). Run "off" first.`,
  );
}

fs.mkdirSync(configDir, { recursive: true });
if (fs.existsSync(configFile)) {
  fs.copyFileSync(configFile, backupFile);
  console.log(`Backed up your config to ${backupFile}.`);
} else {
  fs.writeFileSync(backupFile, "{}\n");
  console.log("No existing config; wrote an empty placeholder backup.");
}

createDemoRepo(path.join(reposDir, "demo-app"), ["feature/search", "fix/upload-flake"], true);
createDemoRepo(path.join(reposDir, "demo-site"), ["feature/onboarding"], false);
createDemoRepo(path.join(reposDir, "demo-infra"), [], false);

const sample = fs.readFileSync(path.join(demoDir, "config.sample.json"), "utf8");
const demoConfig = sample
  .replaceAll("{VAULT}", slash(vaultDir))
  .replaceAll("{REPOS}", slash(reposDir));
fs.writeFileSync(configFile, demoConfig);

console.log("Demo mode is on.");
console.log(`  vault : ${vaultDir}`);
console.log(`  repos : ${reposDir}`);
console.log('Start workhub, take the screenshots, then run: node demo-mode.mjs off');
