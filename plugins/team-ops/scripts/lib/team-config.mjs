// @ts-check
/**
 * Shared helpers for the team-ops plugin scripts.
 *
 * Config model (see docs/design.html §3):
 *   - Local (per machine):  <project-root>/.claude/team-context.json
 *       { teamRootPath, repoWorkspacesRoot?, me?, activeProjects? }
 *   - Shared (per team):    <teamRoot>/ai/_meta/team.json        { language? }
 *   - Shared (per project): <teamRoot>/ai/projects/<p>/config/project.json
 *       { repos: [{ name, url, devMainBranch?, defaultBranch? }], sprint? }
 *
 * All helpers are lenient: missing/malformed files resolve to null/defaults
 * rather than throwing, so callers can produce actionable error messages.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const LOCAL_CONFIG_RELATIVE_PATH = ".claude/team-context.json";
export const DEFAULT_WORKSPACES_ROOT = join(homedir(), ".team-ops-repos");

/** Resolve the project root the way plugin hooks do: env → cwd. */
export function resolveProjectRoot() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

/** @param {string} path */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Load the machine-local config. Returns null when absent/malformed.
 * @param {string} [projectRoot]
 * @returns {null | {
 *   teamRootPath: string,
 *   repoWorkspacesRoot: string,
 *   me: string,
 *   activeProjects: string[],
 *   configPath: string,
 * }}
 */
export function loadLocalConfig(projectRoot = resolveProjectRoot()) {
  const configPath = join(projectRoot, LOCAL_CONFIG_RELATIVE_PATH);
  const raw = readJson(configPath);
  if (!raw || typeof raw !== "object") return null;
  const teamRootPath =
    typeof raw.teamRootPath === "string" ? raw.teamRootPath.trim() : "";
  if (!teamRootPath) return null;
  return {
    teamRootPath,
    repoWorkspacesRoot:
      typeof raw.repoWorkspacesRoot === "string" && raw.repoWorkspacesRoot.trim()
        ? raw.repoWorkspacesRoot.trim()
        : DEFAULT_WORKSPACES_ROOT,
    me: typeof raw.me === "string" ? raw.me.trim() : "",
    activeProjects: Array.isArray(raw.activeProjects)
      ? raw.activeProjects.filter((p) => typeof p === "string" && p.trim())
      : [],
    configPath,
  };
}

/** `<teamRoot>/ai` — the AI zone every path below hangs off. */
/** @param {{ teamRootPath: string }} config */
export function teamAiRoot(config) {
  return join(config.teamRootPath, "ai");
}

/** @param {{ teamRootPath: string }} config @param {string} project */
export function projectDir(config, project) {
  return join(teamAiRoot(config), "projects", project);
}

/**
 * Shared team-wide settings from `_meta/team.json`.
 * `language` is the content language for KB / backlog / spec documents
 * (BCP 47-ish tag, e.g. "ja", "en"). Defaults to "en".
 * @param {{ teamRootPath: string }} config
 */
export function loadTeamMeta(config) {
  const raw = readJson(join(teamAiRoot(config), "_meta", "team.json"));
  const language =
    raw && typeof raw.language === "string" && raw.language.trim()
      ? raw.language.trim()
      : "en";
  return { language };
}

/**
 * Shared per-project settings. Returns null when the project folder or its
 * config is missing.
 * @param {{ teamRootPath: string }} config
 * @param {string} project
 * @returns {null | {
 *   repos: { name: string, url: string, devMainBranch: string, defaultBranch: string }[],
 *   sprint: { lengthDays: number, pointScale: number[] },
 * }}
 */
export function loadProjectConfig(config, project) {
  const raw = readJson(join(projectDir(config, project), "config", "project.json"));
  if (!raw || typeof raw !== "object") return null;
  const repos = (Array.isArray(raw.repos) ? raw.repos : [])
    .map((r) => ({
      name: typeof r?.name === "string" ? r.name.trim() : "",
      url: typeof r?.url === "string" ? r.url.trim() : "",
      devMainBranch:
        typeof r?.devMainBranch === "string" ? r.devMainBranch.trim() : "",
      defaultBranch:
        typeof r?.defaultBranch === "string" && r.defaultBranch.trim()
          ? r.defaultBranch.trim()
          : "main",
    }))
    .filter((r) => r.name && r.url);
  const sprint = raw.sprint && typeof raw.sprint === "object" ? raw.sprint : {};
  return {
    repos,
    sprint: {
      lengthDays:
        typeof sprint.lengthDays === "number" && sprint.lengthDays > 0
          ? sprint.lengthDays
          : 10,
      pointScale: Array.isArray(sprint.pointScale)
        ? sprint.pointScale.filter((n) => typeof n === "number")
        : [1, 2, 3, 5, 8, 13],
    },
  };
}

/**
 * Minimal YAML-frontmatter parser for PBI files. Handles the flat
 * `key: value` subset the team-ops schema uses (plus inline `[a, b]` arrays).
 * Not a general YAML parser by design.
 * @param {string} text
 * @returns {{ attrs: Record<string, string | string[]>, body: string }}
 */
export function parseFrontmatter(text) {
  /** @type {Record<string, string | string[]>} */
  const attrs = {};
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { attrs, body: text };
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let value = kv[2].trim();
    if (/^\[.*\]$/.test(value)) {
      attrs[kv[1]] = value
        .slice(1, -1)
        .split(",")
        .map((v) => v.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
      continue;
    }
    value = value.replace(/^["']|["']$/g, "");
    attrs[kv[1]] = value;
  }
  return { attrs, body: text.slice(match[0].length) };
}

/**
 * List a project's PBI files with parsed frontmatter.
 * @param {{ teamRootPath: string }} config
 * @param {string} project
 * @returns {{ file: string, attrs: Record<string, string | string[]> }[]}
 */
export function listPbis(config, project) {
  const itemsDir = join(projectDir(config, project), "backlog", "items");
  if (!existsSync(itemsDir)) return [];
  const out = [];
  for (const name of readdirSync(itemsDir)) {
    if (!name.endsWith(".md")) continue;
    const file = join(itemsDir, name);
    try {
      out.push({ file, attrs: parseFrontmatter(readFileSync(file, "utf8")).attrs });
    } catch {
      // unreadable file: skip rather than fail the whole listing
    }
  }
  return out;
}

/** `YYYY-MM-DD` in local time. */
export function todayStamp(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Extract PBI ids (e.g. `P-0012`) from a commit subject or branch name.
 * Matches both `[P-0012]` message tags and `pbi/P-0012-slug` branch refs.
 * @param {string} text
 * @returns {string[]}
 */
export function extractPbiIds(text) {
  const ids = new Set();
  for (const m of text.matchAll(/\bP-\d{3,5}\b/gi)) {
    ids.add(m[0].toUpperCase());
  }
  return [...ids];
}
