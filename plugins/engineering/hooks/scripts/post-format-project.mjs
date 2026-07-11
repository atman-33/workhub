#!/usr/bin/env node
// @ts-check
/**
 * PostToolUse hook: run best-effort formatter commands defined in
 * <cwd>/.claude/project-context.json for registered sibling projects whose
 * files were just edited or written by Claude.
 *
 * Behaviour:
 *   - Reads `postToolFormatCommands: string[]` from the same config file used
 *     by the engineering plugin's other hooks.
 *   - Resolves the touched file path(s) from a few likely payload shapes and
 *     matches them against registered `projects[].path` roots.
 *   - Skips files under the current cwd tree so it only covers target projects
 *     outside the launcher repository.
 *   - Runs each command sequentially in the matched target project's root.
 *   - Never blocks the user flow: failures are reported via `systemMessage`
 *     only and the hook always exits 0.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const CONFIG_RELATIVE_PATH = ".claude/project-context.json";
const COMMAND_TIMEOUT_MS = 120000;

/**
 * @typedef {{
 *   path: string,
 *   name?: string,
 *   postToolFormatCommands?: unknown[],
 * }} RegisteredProject
 */

/**
 * @typedef {{
 *   projects?: unknown[],
 *   postToolFormatCommands?: unknown[],
 * }} ProjectContextConfig
 */

/**
 * @typedef {{
 *   cwd?: string,
 *   tool_input?: Record<string, unknown>,
 *   tool_response?: Record<string, unknown>,
 *   file_path?: string,
 *   path?: string,
 * }} PostToolUsePayload
 */

/**
 * @typedef {{
 *   root: string,
 *   name: string,
 *   commands: string[],
 * }} TargetProject
 */

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/** @param {string} p */
function normalizePath(p) {
  return String(p).replace(/\\/g, "/").replace(/\/+$/, "");
}

/** @param {string} child @param {string} parent */
function isUnder(child, parent) {
  const normalizedChild = normalizePath(child).toLowerCase();
  const normalizedParent = normalizePath(parent).toLowerCase();
  return (
    normalizedChild === normalizedParent ||
    normalizedChild.startsWith(normalizedParent + "/")
  );
}

/** @param {PostToolUsePayload} payload */
function resolveProjectRoot(payload) {
  if (process.env.CLAUDE_PROJECT_DIR) {
    return process.env.CLAUDE_PROJECT_DIR;
  }
  if (payload && typeof payload.cwd === "string" && payload.cwd) {
    return payload.cwd;
  }
  return process.cwd();
}

/** @param {unknown[]} projects */
function getRegisteredProjects(projects) {
  /** @type {RegisteredProject[]} */
  const registeredProjects = [];

  for (const project of projects) {
    if (
      project &&
      typeof project === "object" &&
      "path" in project &&
      typeof project.path === "string" &&
      project.path.trim()
    ) {
      registeredProjects.push(/** @type {RegisteredProject} */ (project));
    }
  }

  return registeredProjects;
}

/** @param {unknown[]} commands */
function getFormatCommands(commands) {
  return commands
    .filter((command) => typeof command === "string")
    .map((command) => command.trim())
    .filter(Boolean);
}

/** @param {unknown} value @param {string[]} output */
function pushCandidatePaths(value, output) {
  if (!value) {
    return;
  }

  if (typeof value === "string") {
    output.push(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      pushCandidatePaths(item, output);
    }
    return;
  }

  if (typeof value === "object") {
    if ("file_path" in value) {
      pushCandidatePaths(value.file_path, output);
    }
    if ("path" in value) {
      pushCandidatePaths(value.path, output);
    }
    if ("file_paths" in value) {
      pushCandidatePaths(value.file_paths, output);
    }
    if ("files" in value) {
      pushCandidatePaths(value.files, output);
    }
  }
}

/** @param {PostToolUsePayload} payload */
function collectTouchedPaths(payload) {
  /** @type {string[]} */
  const candidates = [];
  pushCandidatePaths(payload.tool_input, candidates);
  pushCandidatePaths(payload.tool_response, candidates);
  pushCandidatePaths(payload.file_path, candidates);
  pushCandidatePaths(payload.path, candidates);

  return [...new Set(candidates.map((path) => normalizePath(path)).filter(Boolean))];
}

/** @param {string} filePath @param {TargetProject[]} targets */
function findLongestMatchingTarget(filePath, targets) {
  /** @type {TargetProject | null} */
  let match = null;

  for (const target of targets) {
    if (isUnder(filePath, target.root)) {
      if (!match || target.root.length > match.root.length) {
        match = target;
      }
    }
  }

  return match;
}

/** @param {TargetProject} target @param {string[]} commands */
function runFormatCommands(target, commands) {
  /** @type {string[]} */
  const lines = [`🎨 post-format: ${target.name}`];

  for (const command of commands) {
    const result = spawnSync(command, {
      cwd: target.root,
      shell: true,
      encoding: "utf8",
      timeout: COMMAND_TIMEOUT_MS,
      windowsHide: true,
    });

    if (result.error) {
      const detail = result.error.name === "Error"
        ? result.error.message
        : result.error.name;
      lines.push(`- error: ${command} (${detail})`);
      continue;
    }

    if (typeof result.status === "number" && result.status !== 0) {
      lines.push(`- fail(${result.status}): ${command}`);
      continue;
    }

    if (result.signal) {
      lines.push(`- fail(${result.signal}): ${command}`);
      continue;
    }

    lines.push(`- ok: ${command}`);
  }

  return lines.join("\n");
}

/** @param {string | null} systemMessage */
function emit(systemMessage) {
  const payload = systemMessage ? { systemMessage } : {};
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

function main() {
  /** @type {PostToolUsePayload} */
  let payload;
  try {
    payload = JSON.parse(readStdin());
  } catch {
    emit(null);
    return;
  }

  if (!payload || typeof payload !== "object") {
    emit(null);
    return;
  }

  const cwd = normalizePath(resolveProjectRoot(payload));
  const configPath = join(cwd, CONFIG_RELATIVE_PATH);

  /** @type {ProjectContextConfig} */
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    emit(null);
    return;
  }

  const commands = getFormatCommands(
    Array.isArray(config.postToolFormatCommands)
      ? config.postToolFormatCommands
      : []
  );

  const projects = getRegisteredProjects(
    Array.isArray(config.projects) ? config.projects : []
  ).map((project) => {
    const root = normalizePath(project.path.trim());
    const projectCommands = getFormatCommands(
      Array.isArray(project.postToolFormatCommands)
        ? project.postToolFormatCommands
        : []
    );
    return {
      root,
      name: project.name && project.name.trim() ? project.name.trim() : root,
      commands: projectCommands.length > 0 ? projectCommands : commands,
    };
  });
  if (projects.length === 0 || projects.every((project) => project.commands.length === 0)) {
    emit(null);
    return;
  }

  const touchedPaths = collectTouchedPaths(payload).map((filePath) => {
    const isAbsolute = /^([a-zA-Z]:\/|\/)/.test(filePath);
    return isAbsolute ? filePath : normalizePath(`${cwd}/${filePath}`);
  });
  if (touchedPaths.length === 0) {
    emit(null);
    return;
  }

  /** @type {TargetProject[]} */
  const matchedTargets = [];
  const seenRoots = new Set();

  for (const filePath of touchedPaths) {
    if (isUnder(filePath, cwd)) {
      continue;
    }

    const target = findLongestMatchingTarget(filePath, projects);
    if (!target || seenRoots.has(target.root)) {
      continue;
    }

    seenRoots.add(target.root);
    matchedTargets.push(target);
  }

  if (matchedTargets.length === 0) {
    emit(null);
    return;
  }

  emit(
    matchedTargets
      .filter((target) => target.commands.length > 0)
      .map((target) => runFormatCommands(target, target.commands))
      .join("\n\n") || null
  );
}

main();