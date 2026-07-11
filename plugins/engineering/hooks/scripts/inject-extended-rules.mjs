#!/usr/bin/env node
// @ts-check
/**
 * PreToolUse hook: inject workspace-local "extended rules" into Claude's context
 * just before a file is read or edited. This is the second rule-injection path,
 * complementary to inject-target-rules.mjs.
 *
 * Where inject-target-rules.mjs loads a *target repo's own* `.claude/rules` (rules
 * that live with the repo they govern), this hook loads rules that live in the
 * CURRENT WORKSPACE — `<cwd>/.claude/rules-ex/*.md` — and applies them to files in
 * ANY repo via cwd-relative globs. The intent: keep cross-cutting development rules
 * centralised in the harness (cwd) without modifying sibling target repos.
 *
 * Folder name `rules-ex` = the *extended* form of `.claude/rules`: its `paths:`
 * globs are resolved relative to cwd and may use `..` to reach other repos,
 * e.g. `paths: ../workhub/plugins/**`. Additionally, globs may start with a
 * project NAME registered in `<cwd>/.claude/project-context.json`
 * (`paths: workhub/src/**`): the touched file is then matched as
 * `<project-name>/<path relative to that project's root>`, which keeps rules
 * independent of where the repos live on a given machine.
 *
 * Matching: the touched file is converted to a set of candidate paths — its
 * cwd-relative path (preserving `..`) plus one `<project-name>/<rel>` candidate
 * per registered project that contains it — then matched against each rule's
 * `paths:` globs with a strict, root-anchored full match (no implicit leading
 * double-star prefixing — the `../` or project-name segment already anchors the
 * pattern). A rule WITHOUT `paths:` is skipped (cross-cutting rules must declare
 * their scope to avoid firing on every file).
 *
 * Input (stdin JSON): `tool_input.file_path`, `cwd`, `session_id`, `agent_id`.
 *
 * De-duplication: a per-(session_id, agent context, rule-file) sentinel under the
 * OS temp dir ensures each rule is injected at most once per agent context, same
 * scheme and rationale as inject-target-rules.mjs.
 *
 * Always exits 0 and emits `{}` when there is nothing to inject. Never blocks.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

const RULES_RELATIVE_DIR = ".claude/rules-ex";
const CONFIG_RELATIVE_PATH = ".claude/project-context.json";

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
 * nothing". `systemMessage`, when provided, is shown to the user (display only).
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

/**
 * A cwd-relative path matches a glob with a strict, root-anchored full match.
 * Unlike inject-target-rules.mjs there is NO leading double-star fallback: the
 * `../` (or bare cwd-relative segment) in the pattern already anchors it at cwd,
 * so an implicit prefix would let `../repo/a.ts` spuriously match unrelated trees.
 */
/** @param {string} relPath @param {string} glob */
function matchesGlob(relPath, glob) {
  const clean = normalizePath(glob.trim());
  try {
    return globToRegExp(clean).test(relPath);
  } catch {
    return false;
  }
}

/**
 * Extract the `paths:` patterns from a rule file's front matter.
 * Returns { hasFrontMatter, paths } where `paths` is an array of glob strings.
 * Supports inline (`paths: ../repo/*.py`) and YAML list forms. Zero-dependency.
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

/**
 * Candidate paths a touched file is matched under: its cwd-relative path plus a
 * `<project-name>/<project-root-relative-path>` candidate for every project
 * registered in `.claude/project-context.json` whose root contains the file.
 * Missing or malformed config just yields no extra candidates (never fatal).
 */
/** @param {string} cwd @param {string} filePath @param {string} relPath */
function buildCandidatePaths(cwd, filePath, relPath) {
  const candidates = relPath ? [relPath] : [];
  let config;
  try {
    config = JSON.parse(readFileSync(join(cwd, CONFIG_RELATIVE_PATH), "utf8"));
  } catch {
    return candidates;
  }
  const projects = config && Array.isArray(config.projects) ? config.projects : [];
  for (const project of projects) {
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
  return join(tmpdir(), `claude-extended-rules-${key}`);
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

  // cwd-relative path, preserving `..` for files outside the workspace tree,
  // plus project-name-prefixed candidates from project-context.json.
  const relPath = normalizePath(relative(cwd, filePath));
  const candidates = buildCandidatePaths(cwd, filePath, relPath);
  if (candidates.length === 0) {
    emit(null);
    return;
  }

  // Read workspace-local extended rules. Missing dir is fine (nothing to inject).
  const rulesDir = join(cwd, RULES_RELATIVE_DIR);
  /** @type {string[]} */
  let entries = [];
  try {
    entries = readdirSync(rulesDir).filter((f) => f.toLowerCase().endsWith(".md"));
  } catch {
    emit(null);
    return;
  }

  const sessionId =
    typeof payload.session_id === "string" && payload.session_id
      ? payload.session_id
      : "no-session";

  // The agent context: a sub-agent's id when present, else the main session.
  const contextId =
    typeof payload.agent_id === "string" && payload.agent_id
      ? payload.agent_id
      : "main";

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
    // Cross-cutting rules MUST declare scope: no paths -> never applies.
    if (!hasFrontMatter || paths.length === 0) continue;
    if (!paths.some((g) => candidates.some((c) => matchesGlob(c, g)))) continue;

    // De-dup per (session, agent context, rule).
    const sentinel = sentinelPath(sessionId, contextId, ruleAbsPath);
    if (existsSync(sentinel)) continue;
    try {
      writeFileSync(sentinel, `${new Date().toISOString()} ${relPath}\n`);
    } catch {
      // If we can't write the sentinel we still inject once; never fatal.
    }

    injected.push({
      rel: normalizePath(`${RULES_RELATIVE_DIR}/${file}`),
      body: stripFrontMatter(content).trim(),
    });
  }

  if (injected.length === 0) {
    emit(null);
    return;
  }

  const lines = [
    `<extended-rules root="${xmlEscape(cwd)}">`,
    `  Workspace-local extended rules from "${xmlEscape(RULES_RELATIVE_DIR)}" that`,
    `  apply to ${xmlEscape(relPath)} (resolved relative to the workspace root).`,
  ];
  for (const r of injected) {
    lines.push(`  <rule path="${xmlEscape(r.rel)}">`);
    lines.push(r.body);
    lines.push("  </rule>");
  }
  lines.push("</extended-rules>");

  const names = injected.map((r) => r.rel.replace(/^\.claude\/rules-ex\//, ""));
  const summary = `🔎 extended-rules: ${names.join(", ")}`;

  emit(lines.join("\n"), summary);
}

main();
