#!/usr/bin/env node
// @ts-check
/**
 * init-scrum-context.mjs — create or update `.claude/scrum-context.json` in
 * the target project, without hand-editing JSON or losing existing entries.
 *
 * Reads a patch object from stdin:
 *   { mondayBoardId?, mondayBoardUrl?, driveDocsRootPath?, mondayEpics?,
 *     repoWorkspacesRoot? }
 *
 * `mondayEpics[groupName]` values may be a plain string (legacy — the Epic's
 * Drive folder path) or an object (`{drivePath, repo: {url, epicBranch?,
 * defaultBranch?}}`) — see `monday-client.mjs`'s `normalizeEpicEntry`.
 *
 * Behaviour:
 *   - Shallow-merges onto any existing config; `mondayEpics` is merged
 *     key-by-key so previously configured Epic mappings are never dropped —
 *     a patch entry (string or object) replaces the existing value for that
 *     key wholesale, it is never deep-merged into an existing object entry.
 *   - Creates `.claude/` if missing, writes pretty-printed JSON + trailing
 *     newline.
 *   - Ensures the project's `.gitignore` lists `.claude/scrum-context.json`
 *     (appended once, idempotent) since the file holds real board ids and
 *     Drive paths.
 *   - Reports whether `MONDAY_TOKEN` is set (not its value) as a courtesy
 *     diagnostic — this script does not require it.
 *
 * node init-scrum-context.mjs < patch.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readStdin, resolveProjectRoot, printJson } from "../monday/monday-client.mjs";

const CONFIG_RELATIVE_PATH = join(".claude", "scrum-context.json");
const GITIGNORE_ENTRY = ".claude/scrum-context.json";

/**
 * @param {string} configPath
 * @returns {Record<string, any>}
 */
function readExistingConfig(configPath) {
  let raw;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    throw new Error(
      `scrum: existing ${CONFIG_RELATIVE_PATH} is not valid JSON — fix it manually before running this script.`
    );
  }
}

/**
 * @param {Record<string, any>} existing
 * @param {Record<string, any>} patch
 * @returns {Record<string, any>}
 */
function mergeConfig(existing, patch) {
  const merged = { ...existing };
  for (const key of [
    "mondayBoardId",
    "mondayBoardUrl",
    "driveDocsRootPath",
    "repoWorkspacesRoot",
  ]) {
    if (patch[key] !== undefined && patch[key] !== null && patch[key] !== "") {
      merged[key] = patch[key];
    }
  }
  if (patch.mondayEpics && typeof patch.mondayEpics === "object") {
    merged.mondayEpics = {
      ...(existing.mondayEpics && typeof existing.mondayEpics === "object"
        ? existing.mondayEpics
        : {}),
      ...patch.mondayEpics,
    };
  }
  return merged;
}

/**
 * @param {string} projectRoot
 * @returns {{ path: string, updated: boolean }}
 */
function ensureGitignoreEntry(projectRoot) {
  const gitignorePath = join(projectRoot, ".gitignore");
  let raw = "";
  try {
    raw = readFileSync(gitignorePath, "utf8");
  } catch {
    raw = "";
  }
  const alreadyListed = raw
    .split("\n")
    .some((line) => line.trim() === GITIGNORE_ENTRY);
  if (alreadyListed) {
    return { path: gitignorePath, updated: false };
  }
  const separator = raw.length === 0 || raw.endsWith("\n") ? "" : "\n";
  writeFileSync(gitignorePath, `${raw}${separator}${GITIGNORE_ENTRY}\n`, "utf8");
  return { path: gitignorePath, updated: true };
}

function main() {
  const stdinRaw = readStdin();
  let patch;
  try {
    patch = stdinRaw.trim() ? JSON.parse(stdinRaw) : {};
  } catch (error) {
    process.stderr.write(
      `scrum: stdin is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }\n`
    );
    process.exit(2);
  }

  const projectRoot = resolveProjectRoot("");
  const configPath = join(projectRoot, CONFIG_RELATIVE_PATH);

  let existing;
  try {
    existing = readExistingConfig(configPath);
  } catch (error) {
    process.stderr.write(
      (error instanceof Error ? error.message : String(error)) + "\n"
    );
    process.exit(1);
  }
  const merged = mergeConfig(existing, patch);

  const configDir = join(projectRoot, ".claude");
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  writeFileSync(configPath, JSON.stringify(merged, null, 2) + "\n", "utf8");

  const gitignore = ensureGitignoreEntry(projectRoot);

  printJson({
    configPath,
    fieldsSet: Object.keys(patch),
    gitignore,
    mondayTokenSet: Boolean(process.env.MONDAY_TOKEN),
  });
}

main();
