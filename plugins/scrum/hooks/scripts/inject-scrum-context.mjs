#!/usr/bin/env node
// @ts-check
/**
 * SessionStart hook: inject the configured monday.com backlog board, Google
 * Drive docs root path, and per-Epic Drive folder mappings into Claude's
 * context as a <scrum-context> XML block.
 *
 * Reads `<project-root>/.claude/scrum-context.json` and emits
 * `hookSpecificOutput.additionalContext`. Runs identically on Windows and
 * WSL/macOS because it is launched via `node` (no platform-specific wrapper).
 *
 * Behaviour:
 *   - No config file  -> emit nothing (don't nag unconfigured projects).
 *   - Malformed config -> emit a short error note so the user can fix it.
 *   - Valid config     -> emit the <scrum-context> block.
 * Always exits 0 (SessionStart cannot block and hooks must be failure-tolerant).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const CONFIG_RELATIVE_PATH = ".claude/scrum-context.json";

/**
 * @typedef {{
 *   mondayBoardId?: string,
 *   mondayBoardUrl?: string,
 *   driveDocsRootPath?: string | string[],
 *   mondayEpics?: Record<string, string | { drivePath?: string, repo?: { url?: string, epicBranch?: string, defaultBranch?: string } }>,
 * }} ScrumContextConfig
 */

/** Read all of stdin (the SessionStart payload). Returns "" if none. */
function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/** Escape a string for use in XML text or a double-quoted attribute. */
/** @param {unknown} value */
function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Print a SessionStart hook result and exit 0. The same text is also surfaced
 * via the top-level `systemMessage` field so it's visible in the transcript.
 */
/** @param {string | null} additionalContext */
function emit(additionalContext) {
  const payload = additionalContext
    ? {
        systemMessage: additionalContext,
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext,
        },
      }
    : {};
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

/** Resolve the project root from env, then the stdin payload, then cwd. */
/** @param {string} stdinRaw */
function resolveProjectRoot(stdinRaw) {
  if (process.env.CLAUDE_PROJECT_DIR) {
    return process.env.CLAUDE_PROJECT_DIR;
  }
  if (stdinRaw.trim()) {
    try {
      const payload = JSON.parse(stdinRaw);
      if (payload && typeof payload.cwd === "string" && payload.cwd) {
        return payload.cwd;
      }
    } catch {
      // ignore malformed stdin; fall through to cwd
    }
  }
  return process.cwd();
}

/** @param {unknown} value */
function trimmedString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

/**
 * Normalize `driveDocsRootPath` to an array of non-empty trimmed strings.
 * Accepts either a single string or an array of strings; anything else is
 * treated as empty. Keeps the config lenient (typos, nulls, wrong types all
 * collapse to "no Drive roots configured" rather than crashing the hook).
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeRootPaths(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(value)) {
    return value
      .map((v) => trimmedString(v))
      .filter(Boolean);
  }
  return [];
}

/**
 * Normalize one `mondayEpics[groupName]` value to `{drivePath, repoUrl,
 * epicBranch}` — accepts the legacy string shape (drivePath only) or the
 * object shape (`{drivePath, repo: {url, epicBranch?}}`). Mirrors
 * `monday-client.mjs`'s `normalizeEpicEntry`; duplicated here (rather than
 * imported) since this hook script is deliberately self-contained.
 * @param {unknown} value
 * @returns {{ drivePath: string, repoUrl: string, epicBranch: string }}
 */
function normalizeEpicValue(value) {
  if (typeof value === "string") {
    return { drivePath: trimmedString(value), repoUrl: "", epicBranch: "" };
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = /** @type {Record<string, unknown>} */ (value);
    const drivePath = trimmedString(obj.drivePath);
    const repo = obj.repo;
    const repoUrl =
      repo && typeof repo === "object" ? trimmedString(/** @type {any} */ (repo).url) : "";
    const epicBranch =
      repo && typeof repo === "object" ? trimmedString(/** @type {any} */ (repo).epicBranch) : "";
    return { drivePath, repoUrl, epicBranch };
  }
  return { drivePath: "", repoUrl: "", epicBranch: "" };
}

/**
 * Normalize `mondayEpics` to an array of `{name, path, repoUrl, epicBranch}`
 * entries, skipping any entry whose key or drivePath isn't a non-empty
 * string. Keeps the config lenient, same as `normalizeRootPaths`.
 * @param {unknown} value
 * @returns {{name: string, path: string, repoUrl: string, epicBranch: string}[]}
 */
function normalizeEpics(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  return Object.entries(value)
    .map(([name, entryValue]) => {
      const { drivePath, repoUrl, epicBranch } = normalizeEpicValue(entryValue);
      return { name: trimmedString(name), path: drivePath, repoUrl, epicBranch };
    })
    .filter(({ name, path }) => name && path);
}

/** Build the <scrum-context> XML block from the parsed config. */
/** @param {ScrumContextConfig} config */
function buildXml(config) {
  const lines = ["<scrum-context>"];

  const mondayBoardId = trimmedString(config.mondayBoardId);
  const mondayBoardUrl = trimmedString(config.mondayBoardUrl);
  if (mondayBoardId || mondayBoardUrl) {
    const attrs = [
      mondayBoardId ? `id="${xmlEscape(mondayBoardId)}"` : "",
      mondayBoardUrl ? `url="${xmlEscape(mondayBoardUrl)}"` : "",
    ]
      .filter(Boolean)
      .join(" ");
    lines.push(`  <monday-board ${attrs} />`);
  }

  const driveRoots = normalizeRootPaths(config.driveDocsRootPath);
  for (const root of driveRoots) {
    lines.push(`  <drive-docs-root path="${xmlEscape(root)}" />`);
  }

  const epics = normalizeEpics(config.mondayEpics);
  for (const { name, path, repoUrl, epicBranch } of epics) {
    const attrs = [
      `name="${xmlEscape(name)}"`,
      `drive-path="${xmlEscape(path)}"`,
      repoUrl ? `repo-url="${xmlEscape(repoUrl)}"` : "",
      epicBranch ? `epic-branch="${xmlEscape(epicBranch)}"` : "",
    ]
      .filter(Boolean)
      .join(" ");
    lines.push(`  <monday-epic ${attrs} />`);
  }

  lines.push("</scrum-context>");
  return lines.join("\n");
}

function main() {
  const stdinRaw = readStdin();
  const projectRoot = resolveProjectRoot(stdinRaw);
  const configPath = join(projectRoot, CONFIG_RELATIVE_PATH);

  let raw;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch {
    // No config file for this project: inject nothing.
    emit(null);
    return;
  }

  let config;
  try {
    config = JSON.parse(raw);
  } catch (error) {
    emit(
      `<scrum-context>\n  <error>Failed to parse ${xmlEscape(CONFIG_RELATIVE_PATH)}: ${xmlEscape(
        error instanceof Error ? error.message : String(error)
      )}. Please fix the JSON.</error>\n</scrum-context>`
    );
    return;
  }

  const hasMonday =
    trimmedString(config.mondayBoardId) || trimmedString(config.mondayBoardUrl);
  const hasDrive = normalizeRootPaths(config.driveDocsRootPath).length > 0;
  const hasEpics = normalizeEpics(config.mondayEpics).length > 0;

  if (!hasMonday && !hasDrive && !hasEpics) {
    emit(null);
    return;
  }

  emit(buildXml(config));
}

main();