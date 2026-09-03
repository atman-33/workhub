#!/usr/bin/env node
// @ts-check
/**
 * PreToolUse hook: inject a target (sibling) repository's guidance into Claude's
 * context just before a file is read or edited, reproducing Claude Code's native
 * memory/rule loading for repos that live OUTSIDE the current working directory
 * tree. Two things are injected:
 *   1. The repo's root instruction file (CLAUDE.md preferred, else AGENTS.md),
 *      full text, once per session per repo.
 *   2. The path-scoped `.claude/rules/*.md` whose `paths:` front matter matches
 *      the touched file.
 *
 * Why this exists: Claude Code only loads memory/rules from the cwd hierarchy
 * (upward) plus cwd subdirectories (lazily). When the harness is launched in one
 * repo and used to develop a sibling repo, that sibling's CLAUDE.md/AGENTS.md and
 * `.claude/rules` are never loaded. This hook bridges that gap: on Read/Edit/Write
 * of a file under a registered sibling project, it injects the above via
 * `additionalContext`.
 *
 * Input (stdin JSON): `tool_name`, `tool_input.file_path`, `cwd`, `session_id`.
 * Registered projects come from `<projectRoot>/.claude/project-context.json`
 * (`projects[].path`) — the same source as inject-project-context.mjs.
 *
 * De-duplication: a per-(session_id, agent context, rule-file) sentinel under the
 * OS temp dir ensures each rule is injected at most once per agent context. The
 * "agent context" is the sub-agent's `agent_id` when present, else "main" for the
 * top-level session. This matters because sub-agents share the parent's
 * `session_id` AND `transcript_path` but have their own, separate context window:
 * keying de-dup on `session_id` alone let a sub-agent's injection suppress the
 * main session's (the instructions then never reached the main context). Keying it
 * per agent context fixes that while still de-duping repeated reads within one
 * context. Path-scoped rules can become relevant later (when a different file is
 * touched), so de-dup is also keyed per rule file, not per repo — a different rule
 * still injects the first time it matches.
 *
 * Always exits 0 and emits `{}` when there is nothing to inject. Never blocks or
 * issues a permission decision (it defers to the normal flow).
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

const CONFIG_RELATIVE_PATH = ".claude/project-context.json";

/**
 * @typedef {{
 *   path: string,
 *   name?: string,
 * }} RegisteredProject
 */

/**
 * @typedef {{
 *   projects?: unknown[],
 * }} ProjectContextConfig
 */

/**
 * @typedef {{
 *   cwd?: string,
 *   session_id?: string,
 *   agent_id?: string,
 *   tool_input?: {
 *     file_path?: string,
 *   },
 * }} PreToolUsePayload
 */

/**
 * @typedef {{
 *   root: string,
 *   name: string,
 * }} TargetProject
 */

/**
 * @typedef {{
 *   rel: string,
 *   body: string,
 * }} InjectedRule
 */

/** Read all of stdin (the PreToolUse payload). Returns "" if none. */
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

/** Normalise a filesystem path: forward slashes, strip trailing slashes. */
/** @param {string} p */
function normalizePath(p) {
  return String(p).replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * Resolve a project's instruction file under its root.
 * Prefers CLAUDE.md, falls back to AGENTS.md, returns "" when neither exists.
 */
/** @param {string} root */
function resolveInstructionsFile(root) {
  const base = normalizePath(root);
  for (const name of ["CLAUDE.md", "AGENTS.md"]) {
    const candidate = `${base}/${name}`;
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return "";
}

/** Resolve the project root from env, then the stdin payload, then cwd. */
/** @param {PreToolUsePayload} payload */
function resolveProjectRoot(payload) {
  if (process.env.CLAUDE_PROJECT_DIR) {
    return process.env.CLAUDE_PROJECT_DIR;
  }
  if (payload && typeof payload.cwd === "string" && payload.cwd) {
    return payload.cwd;
  }
  return process.cwd();
}

/**
 * Emit a PreToolUse result and exit 0. `additionalContext` null means "inject
 * nothing". When `systemMessage` is provided it is shown to the user (display
 * only — it does not affect the permission decision), giving a visible summary
 * of what was injected.
 */
/** @param {string | null} additionalContext @param {string} [systemMessage] */
function emit(additionalContext, systemMessage) {
  /** @type {{
   *   hookSpecificOutput?: { hookEventName: "PreToolUse", additionalContext: string },
   *   systemMessage?: string,
   * }} */
  const payload = {};
  if (additionalContext) {
    payload.hookSpecificOutput = {
      hookEventName: "PreToolUse",
      additionalContext,
    };
  }
  if (systemMessage) {
    payload.systemMessage = systemMessage;
  }
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

/** True when `child` is the same path as, or nested under, `parent`. */
/** @param {string} child @param {string} parent */
function isUnder(child, parent) {
  const c = child.toLowerCase();
  const p = parent.toLowerCase();
  return c === p || c.startsWith(p + "/");
}

/**
 * Convert a single glob pattern to an anchored, full-match RegExp.
 * Supports `**` (any depth, incl. slashes), `*` (single segment), `?`.
 */
/** @param {string} glob */
function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
      } else {
        re += "[^/]*";
      }
    } else if (ch === "?") {
      re += "[^/]";
    } else if (".+^${}()|[]\\".includes(ch)) {
      re += "\\" + ch;
    } else {
      re += ch;
    }
  }
  return new RegExp("^" + re + "$");
}

/** A repo-relative path matches a glob if either the bare or `**`/-prefixed form hits. */
/** @param {string} relPath @param {string} glob */
function matchesGlob(relPath, glob) {
  const clean = glob.replace(/^\.\//, "").replace(/^\/+/, "");
  try {
    if (globToRegExp(clean).test(relPath)) {
      return true;
    }
    // Allow a pattern like "apis/*.py" to also match nested occurrences,
    // mirroring how editors commonly treat unrooted globs.
    if (!clean.startsWith("**/") && globToRegExp("**/" + clean).test(relPath)) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Extract the `paths:` patterns from a rule file's front matter.
 * Returns { hasFrontMatter, paths } where `paths` is an array of glob strings.
 * Supports inline (`paths: apis/*.py`) and YAML list forms. Zero-dependency.
 */
/** @param {string} content */
function parsePathsFrontMatter(content) {
  const m = content.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) {
    return { hasFrontMatter: false, paths: [] };
  }
  const body = m[1];
  const lines = body.split(/\r?\n/);
  const paths = [];
  let inList = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const inline = line.match(/^paths:\s*(.*)$/);
    if (inline) {
      const val = inline[1].trim();
      if (val && val !== "|" && val !== ">") {
        paths.push(stripQuotes(val));
        inList = false;
      } else {
        inList = true; // list items follow on subsequent lines
      }
      continue;
    }
    if (inList) {
      const item = line.match(/^\s*-\s*(.+)$/);
      if (item) {
        paths.push(stripQuotes(item[1].trim()));
      } else if (line.trim() && !/^\s/.test(line)) {
        // A new top-level key ends the list.
        inList = false;
      }
    }
  }
  return { hasFrontMatter: true, paths };
}

/** @param {string} s */
function stripQuotes(s) {
  return s.replace(/^["']/, "").replace(/["']$/, "");
}

/** Strip the front matter block so only the rule body is injected. */
/** @param {string} content */
function stripFrontMatter(content) {
  const m = content.match(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? content.slice(m[0].length) : content;
}

/** Sentinel path for a (session, agent context, rule-file) triple. */
/** @param {string} sessionId @param {string} contextId @param {string} ruleAbsPath */
function sentinelPath(sessionId, contextId, ruleAbsPath) {
  const key = createHash("sha1")
    .update(`${sessionId}|${contextId}|${ruleAbsPath}`)
    .digest("hex");
  return join(tmpdir(), `claude-target-rules-${key}`);
}

/**
 * @param {unknown[]} projects
 * @returns {RegisteredProject[]}
 */
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

function main() {
  /** @type {PreToolUsePayload} */
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

  const filePathRaw =
    payload.tool_input && typeof payload.tool_input.file_path === "string"
      ? payload.tool_input.file_path
      : "";
  if (!filePathRaw) {
    emit(null);
    return;
  }

  const cwd = normalizePath(resolveProjectRoot(payload));

  // Normalise the touched file to an absolute, forward-slash path.
  let filePath = normalizePath(filePathRaw);
  const isAbsolute = /^([a-zA-Z]:\/|\/)/.test(filePath);
  if (!isAbsolute) {
    filePath = normalizePath(`${cwd}/${filePath}`);
  }

  // Files under the cwd tree already get native rule loading — skip them.
  if (isUnder(filePath, cwd)) {
    emit(null);
    return;
  }

  // Load registered projects.
  const configPath = join(cwd, CONFIG_RELATIVE_PATH);
  /** @type {ProjectContextConfig} */
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    emit(null);
    return;
  }
  const projects = getRegisteredProjects(
    Array.isArray(config.projects) ? config.projects : []
  );

  // Longest-matching registered root that contains the file.
  /** @type {TargetProject | null} */
  let target = null;
  for (const p of projects) {
    const root = normalizePath(p.path.trim());
    if (isUnder(filePath, root)) {
      if (!target || root.length > target.root.length) {
        target = { root, name: p.name && p.name.trim() ? p.name.trim() : root };
      }
    }
  }
  if (!target) {
    emit(null);
    return;
  }

  // repo-relative path of the touched file.
  const relPath = filePath
    .slice(target.root.length)
    .replace(/^\/+/, "");

  const sessionId =
    typeof payload.session_id === "string" && payload.session_id
      ? payload.session_id
      : "no-session";

  // The agent context: a sub-agent's id when present, else the main session.
  // Sub-agents share session_id/transcript_path with the main session but keep a
  // separate context window, so de-dup must be scoped per agent context.
  const contextId =
    typeof payload.agent_id === "string" && payload.agent_id
      ? payload.agent_id
      : "main";

  const blocks = [];
  let injectedInstructions = "";

  // 1. Root instruction file (CLAUDE.md preferred, then AGENTS.md), full text,
  //    injected at most once per (session, repo). Reproduces the native cwd
  //    memory auto-load for a sibling repo.
  const instructionsFile = resolveInstructionsFile(target.root);
  if (instructionsFile) {
    const sentinel = sentinelPath(sessionId, contextId, instructionsFile);
    if (!existsSync(sentinel)) {
      let content;
      try {
        content = readFileSync(instructionsFile, "utf8");
      } catch {
        content = null;
      }
      if (content && content.trim()) {
        try {
          writeFileSync(sentinel, `${new Date().toISOString()} ${relPath}\n`);
        } catch {
          // Non-fatal: inject once even if the sentinel can't be written.
        }
        const fileName = instructionsFile.slice(target.root.length).replace(/^\/+/, "");
        injectedInstructions = fileName;
        blocks.push(
          [
            `<target-project-instructions project="${xmlEscape(target.name)}" path="${xmlEscape(fileName)}">`,
            `  Full instructions from the target repository "${xmlEscape(target.name)}"`,
            `  (outside the current working directory). Follow them while working there.`,
            content.trim(),
            "</target-project-instructions>",
          ].join("\n")
        );
      }
    }
  }

  // 2. Path-scoped rules under the target's .claude/rules. Missing dir is fine.
  const rulesDir = join(target.root, ".claude", "rules");
  /** @type {string[]} */
  let entries = [];
  try {
    entries = readdirSync(rulesDir).filter((f) => f.toLowerCase().endsWith(".md"));
  } catch {
    entries = [];
  }

  /** @type {InjectedRule[]} */
  const injected = [];
  for (const file of entries.sort()) {
    const ruleAbsPath = normalizePath(join(rulesDir, file));
    let content;
    try {
      content = readFileSync(ruleAbsPath, "utf8");
    } catch {
      continue;
    }
    const { hasFrontMatter, paths } = parsePathsFrontMatter(content);
    // No paths -> always applies; with paths -> require a glob match.
    const applies = !hasFrontMatter || paths.length === 0
      ? true
      : paths.some((g) => matchesGlob(relPath, g));
    if (!applies) continue;

    // De-dup per (session, agent context, rule).
    const sentinel = sentinelPath(sessionId, contextId, ruleAbsPath);
    if (existsSync(sentinel)) continue;
    try {
      writeFileSync(sentinel, `${new Date().toISOString()} ${relPath}\n`);
    } catch {
      // If we can't write the sentinel we still inject once; never fatal.
    }

    injected.push({
      rel: normalizePath(`.claude/rules/${file}`),
      body: stripFrontMatter(content).trim(),
    });
  }

  if (injected.length > 0) {
    const lines = [
      `<target-project-rules project="${xmlEscape(target.name)}" root="${xmlEscape(target.root)}">`,
      `  These path-scoped rules come from the target repository "${xmlEscape(target.name)}"`,
      `  (outside the current working directory) and apply to ${xmlEscape(relPath)}.`,
    ];
    for (const r of injected) {
      lines.push(`  <rule path="${xmlEscape(r.rel)}">`);
      lines.push(r.body);
      lines.push("  </rule>");
    }
    lines.push("</target-project-rules>");
    blocks.push(lines.join("\n"));
  }

  if (blocks.length === 0) {
    emit(null);
    return;
  }

  // One-line, display-only summary so the user can see what was injected.
  const parts = [];
  if (injectedInstructions) {
    parts.push(`${injectedInstructions} (full)`);
  }
  if (injected.length > 0) {
    const names = injected.map((r) => r.rel.replace(/^\.claude\/rules\//, ""));
    parts.push(`rules: ${names.join(", ")}`);
  }
  const summary = `🔎 target-rules: ${target.name} — ${parts.join(" + ")}`;

  emit(blocks.join("\n\n"), summary);
}

main();
