// Shared helpers for the OpenCode plugins that mirror the Claude Code
// engineering hook scripts.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { relative } from "node:path";

const FORMAT_COMMAND_TIMEOUT_MS = 120000;

export interface ProjectEntry {
  name?: string;
  path?: string;
  postToolFormatCommands?: unknown[];
  summary?: string;
}

export interface ProjectContextConfig {
  openspecPath?: string;
  postToolFormatCommands?: unknown[];
  projects?: ProjectEntry[];
}

export interface RuleFile {
  body: string;
  path: string;
}

// Per-session de-dup state. Callers key this by OpenCode sessionID. Sub-agents
// run in distinct child sessions (Session.parentID), so keying by sessionID
// already isolates each agent context — no agent-level keying is needed here
// (unlike the Claude Code inject-target-rules.mjs mirror; see that plugin and
// inject-target-rules-plugin.ts for the rationale).
export interface SessionState {
  loadedInstructionTargets: Set<string>;
  loadedRules: Set<string>;
  loadedExtendedRules: Set<string>;
  pendingBlocks: string[];
}

export interface TargetProject {
  root: string;
  name: string;
  project: ProjectEntry;
}

interface ParsedPathsFrontMatter {
  hasFrontMatter: boolean;
  paths: string[];
}

export function createSessionState(): SessionState {
  return {
    loadedInstructionTargets: new Set<string>(),
    loadedRules: new Set<string>(),
    loadedExtendedRules: new Set<string>(),
    pendingBlocks: [],
  };
}

export function normalizePath(value: string): string {
  return String(value).replace(/\\/g, "/").replace(/\/+$/, "");
}

export function safeReadText(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

export function loadProjectContextConfig(
  configPath: string,
): ProjectContextConfig | null {
  const raw = safeReadText(configPath);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as ProjectContextConfig;
  } catch (err) {
    console.error(
      "[project-context] Failed to parse .claude/project-context.json:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

export function buildProjectContext(
  configPath: string,
  workspaceRoot: string,
): string | null {
  const config = loadProjectContextConfig(configPath);
  if (!config) {
    return null;
  }

  const resolvedOpenspec = resolveOpenspecPath(config, workspaceRoot);
  const hasOpenspec = resolvedOpenspec !== "";
  const hasProjects =
    Array.isArray(config.projects) &&
    config.projects.some(
      (project) =>
        project && typeof project.path === "string" && project.path.trim() !== "",
    );

  if (!hasOpenspec && !hasProjects) {
    return null;
  }

  return buildProjectContextXml(config, resolvedOpenspec);
}

export function resolveOpenspecPath(
  config: ProjectContextConfig,
  workspaceRoot: string,
): string {
  const candidate =
    typeof config.openspecPath === "string" ? config.openspecPath.trim() : "";
  if (candidate && existsSync(candidate)) {
    return candidate;
  }

  const fallback = normalizePath(workspaceRoot) + "/openspec";
  return existsSync(fallback) ? fallback : "";
}

export function buildProjectContextXml(
  config: ProjectContextConfig,
  openspecPath: string,
): string {
  const lines = ["<project-context>"];

  if (openspecPath) {
    lines.push(`  <openspec path="${xmlEscape(openspecPath)}" />`);
  }

  const projects = Array.isArray(config.projects) ? config.projects : [];
  const validProjects = projects.filter(
    (project) =>
      project && typeof project.path === "string" && project.path.trim() !== "",
  );

  if (validProjects.length > 0) {
    lines.push("  <registered-projects>");
    for (const project of validProjects) {
      const path = (project.path as string).trim();
      const name =
        typeof project.name === "string" && project.name.trim()
          ? project.name.trim()
          : path;
      const summary =
        typeof project.summary === "string" && project.summary.trim()
          ? project.summary.trim()
          : "";
      const attrs = `name="${xmlEscape(name)}" path="${xmlEscape(path)}"`;
      if (summary) {
        lines.push(`    <project ${attrs}>`);
        lines.push(`      <summary>${xmlEscape(summary)}</summary>`);
        lines.push("    </project>");
      } else {
        lines.push(`    <project ${attrs} />`);
      }
    }
    lines.push("  </registered-projects>");
  }

  lines.push("</project-context>");
  return lines.join("\n");
}

export function xmlEscape(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function makeEarlyPartId(): string {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const suffix = Array.from({ length: 14 }, () =>
    chars[Math.floor(Math.random() * chars.length)],
  ).join("");
  return `prt_000000000000${suffix}`;
}

export function isFileMutationTool(toolName: string): boolean {
  const normalized = toolName.toLowerCase();
  return normalized === "read" || normalized === "edit" || normalized === "write";
}

export function isWriteTool(toolName: string): boolean {
  const normalized = toolName.toLowerCase();
  return normalized === "edit" || normalized === "write";
}

export function collectTouchedPaths(args: unknown): string[] {
  const candidates: string[] = [];
  pushCandidatePaths(args, candidates);
  return [...new Set(candidates.map(normalizePath).filter(Boolean))];
}

function pushCandidatePaths(value: unknown, output: string[]): void {
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

  if (typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;
  pushCandidatePaths(record.file_path, output);
  pushCandidatePaths(record.path, output);
  pushCandidatePaths(record.file_paths, output);
  pushCandidatePaths(record.files, output);
}

export function findSiblingTargetProject(
  filePath: string,
  workspaceRoot: string,
  config: ProjectContextConfig,
): TargetProject | null {
  if (isUnder(filePath, workspaceRoot)) {
    return null;
  }

  const projects = Array.isArray(config.projects) ? config.projects : [];
  let bestMatch: TargetProject | null = null;
  for (const project of projects) {
    if (!project || typeof project.path !== "string" || !project.path.trim()) {
      continue;
    }

    const root = normalizePath(project.path);
    if (!isUnder(filePath, root)) {
      continue;
    }

    if (!bestMatch || root.length > bestMatch.root.length) {
      bestMatch = {
        root,
        name:
          typeof project.name === "string" && project.name.trim()
            ? project.name.trim()
            : root,
        project,
      };
    }
  }

  return bestMatch;
}

export function resolveInstructionsFile(root: string): string {
  for (const name of ["CLAUDE.md", "AGENTS.md"]) {
    const candidate = `${root}/${name}`;
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return "";
}

export function loadMatchingRules(root: string, relativePath: string): RuleFile[] {
  const rulesRoot = `${root}/.claude/rules`;
  let entries: string[];
  try {
    entries = readdirSync(rulesRoot);
  } catch {
    return [];
  }

  const matches: RuleFile[] = [];
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith(".md")) {
      continue;
    }

    const rulePath = `${rulesRoot}/${entry}`;
    const raw = safeReadText(rulePath);
    if (!raw) {
      continue;
    }

    const parsed = parsePathsFrontMatter(raw);
    if (
      parsed.paths.length > 0 &&
      !parsed.paths.some((pattern) => matchesGlob(relativePath, pattern))
    ) {
      continue;
    }

    matches.push({
      path: rulePath,
      body: stripFrontMatter(raw),
    });
  }

  return matches;
}

// cwd-relative path of a touched file, preserving `..` for files outside the
// workspace tree. Mirrors inject-extended-rules.mjs: both `filePath` and `cwd`
// are expected to be absolute (OpenCode passes absolute file paths).
export function toCwdRelativePath(filePath: string, cwd: string): string {
  return normalizePath(relative(normalizePath(cwd), normalizePath(filePath)));
}

// Candidate relative paths a touched file is matched under, for extended rules.
// Always includes the cwd-relative path (possibly with `..` segments). When the
// file lies under a project registered in `.claude/project-context.json`, a
// `<project-name>/<project-root-relative-path>` candidate is added too, so rules
// can scope by project NAME (`paths: - workhub/src/**`) independently of where
// that project lives on this machine.
export function buildExtendedRuleCandidates(
  touchedPath: string,
  workspaceRoot: string,
  config: ProjectContextConfig | null,
): string[] {
  const candidates: string[] = [];
  const cwdRelative = toCwdRelativePath(touchedPath, workspaceRoot);
  if (cwdRelative) {
    candidates.push(cwdRelative);
  }

  const filePath = normalizePath(touchedPath);
  for (const project of config?.projects ?? []) {
    if (
      !project ||
      typeof project.name !== "string" ||
      typeof project.path !== "string"
    ) {
      continue;
    }
    const name = project.name.trim();
    const root = normalizePath(project.path);
    if (!name || !root) {
      continue;
    }
    if (filePath.startsWith(root + "/")) {
      candidates.push(`${name}/${filePath.slice(root.length + 1)}`);
    }
  }

  return candidates;
}

// Workspace-local "extended rules" under `<workspaceRoot>/.claude/rules-ex`.
// Complement to loadMatchingRules (target repo's own `.claude/rules`): these
// cross-cutting rules live in the workspace and target other repos via cwd-relative
// globs or `<project-name>/...` globs (see buildExtendedRuleCandidates). A rule
// MUST declare `paths:` (no paths -> skipped), and matching is strict and
// root-anchored — no implicit leading double-star prefix (unlike matchesGlob).
export function loadExtendedRules(
  workspaceRoot: string,
  candidatePaths: string[],
): RuleFile[] {
  const rulesRoot = `${normalizePath(workspaceRoot)}/.claude/rules-ex`;
  let entries: string[];
  try {
    entries = readdirSync(rulesRoot);
  } catch {
    return [];
  }

  const matches: RuleFile[] = [];
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith(".md")) {
      continue;
    }

    const rulePath = `${rulesRoot}/${entry}`;
    const raw = safeReadText(rulePath);
    if (!raw) {
      continue;
    }

    const parsed = parsePathsFrontMatter(raw);
    if (!parsed.hasFrontMatter || parsed.paths.length === 0) {
      continue;
    }
    if (
      !parsed.paths.some((pattern) =>
        candidatePaths.some((candidate) =>
          matchesExtendedGlob(candidate, pattern),
        ),
      )
    ) {
      continue;
    }

    matches.push({
      path: rulePath,
      body: stripFrontMatter(raw),
    });
  }

  return matches;
}

function matchesExtendedGlob(relativePath: string, pattern: string): boolean {
  const clean = normalizePath(pattern.trim());
  try {
    return globToRegExp(clean).test(relativePath);
  } catch {
    return false;
  }
}

export function resolveFormatCommands(
  config: ProjectContextConfig,
  project: ProjectEntry,
): string[] {
  if (Array.isArray(project.postToolFormatCommands)) {
    return project.postToolFormatCommands
      .filter((command): command is string => typeof command === "string")
      .map((command) => command.trim())
      .filter(Boolean);
  }

  if (!Array.isArray(config.postToolFormatCommands)) {
    return [];
  }

  return config.postToolFormatCommands
    .filter((command): command is string => typeof command === "string")
    .map((command) => command.trim())
    .filter(Boolean);
}

export function runFormatCommands(root: string, commands: string[]): void {
  for (const command of commands) {
    try {
      spawnSync(command, {
        cwd: root,
        shell: true,
        encoding: "utf8",
        timeout: FORMAT_COMMAND_TIMEOUT_MS,
        windowsHide: true,
      });
    } catch {
      // Best effort only: format automation should never block the main flow.
    }
  }
}

export function toRepoRelativePath(filePath: string, root: string): string {
  return normalizePath(filePath)
    .slice(normalizePath(root).length)
    .replace(/^\/+/, "");
}

export function isUnder(child: string, parent: string): boolean {
  const normalizedChild = normalizePath(child).toLowerCase();
  const normalizedParent = normalizePath(parent).toLowerCase();
  return (
    normalizedChild === normalizedParent ||
    normalizedChild.startsWith(normalizedParent + "/")
  );
}

function globToRegExp(glob: string): RegExp {
  let output = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === "*") {
      if (glob[index + 1] === "*") {
        output += ".*";
        index += 1;
      } else {
        output += "[^/]*";
      }
      continue;
    }

    if (char === "?") {
      output += "[^/]";
      continue;
    }

    if (".+^${}()|[]\\".includes(char)) {
      output += "\\" + char;
      continue;
    }

    output += char;
  }

  return new RegExp(`^${output}$`);
}

function matchesGlob(relativePath: string, pattern: string): boolean {
  const normalizedPattern = pattern.replace(/^\.\//, "").replace(/^\/+/, "");
  try {
    if (globToRegExp(normalizedPattern).test(relativePath)) {
      return true;
    }

    if (
      !normalizedPattern.startsWith("**/") &&
      globToRegExp(`**/${normalizedPattern}`).test(relativePath)
    ) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

function parsePathsFrontMatter(content: string): ParsedPathsFrontMatter {
  const match = content.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return { hasFrontMatter: false, paths: [] };
  }

  const lines = match[1].split(/\r?\n/);
  const paths: string[] = [];
  let inList = false;
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    const inline = line.match(/^paths:\s*(.*)$/);
    if (inline) {
      const value = inline[1].trim();
      if (value && value !== "|" && value !== ">") {
        paths.push(stripQuotes(value));
        inList = false;
      } else {
        inList = true;
      }
      continue;
    }

    if (!inList) {
      continue;
    }

    const item = line.match(/^\s*-\s*(.+)$/);
    if (item) {
      paths.push(stripQuotes(item[1].trim()));
      continue;
    }

    if (line.trim() && !/^\s/.test(line)) {
      inList = false;
    }
  }

  return { hasFrontMatter: true, paths };
}

function stripQuotes(value: string): string {
  return value.replace(/^["']/, "").replace(/["']$/, "");
}

function stripFrontMatter(content: string): string {
  return content.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}