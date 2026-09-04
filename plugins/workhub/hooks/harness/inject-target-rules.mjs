#!/usr/bin/env node
// @ts-check
/**
 * PreToolUse hook: inject a target (sibling) repository's guidance into Claude's
 * context just before a file is read or edited, reproducing Claude Code's native
 * memory/rule loading for repos that live OUTSIDE the current working directory
 * tree. Three things are injected, per repository:
 *   1. The repo's root instruction file (CLAUDE.md preferred, else AGENTS.md),
 *      full text, once per session per repo.
 *   2. The path-scoped `.claude/rules/*.md` whose `paths:` front matter matches
 *      the touched file.
 *   3. A catalog of the repo's `.claude/skills/<name>/SKILL.md` — name,
 *      description and path only. A hook cannot register a skill with the Skill
 *      tool, so the model is pointed at the file and reads it when one applies.
 *
 * Why this exists: Claude Code only loads memory/rules from the cwd hierarchy
 * (upward) plus cwd subdirectories (lazily). When the harness is launched in one
 * repo and used to develop a sibling repo, that sibling's CLAUDE.md/AGENTS.md and
 * `.claude/rules` are never loaded. This hook bridges that gap: on Read/Edit/Write
 * of a file under a registered sibling project, it injects the above via
 * `additionalContext`.
 *
 * Repositories nest. A full-stack repo may hold `frontend/` and `backend/` as
 * repositories of their own, with the cross-cutting guidance at the outer level
 * and the local guidance inside. So the hook resolves a *chain* rather than a
 * single repo: every registered root that owns the file, plus any unregistered
 * ancestor that is itself a repository carrying guidance, ordered outermost
 * first so the innermost guidance lands closest to the request. Set
 * `"ancestorRules": false` in `.claude/project-context.json` to consider
 * registered roots only. See target-rules-core.mjs for the resolution rules.
 *
 * Input (stdin JSON): `tool_name`, `tool_input.file_path`, `cwd`, `session_id`.
 * Registered projects come from `<projectRoot>/.claude/project-context.json`
 * (`projects[].path`) — the same source as inject-project-context.mjs.
 *
 * De-duplication: a per-(session_id, agent context, source-file) sentinel under
 * the OS temp dir ensures each injected file is injected at most once per agent
 * context. The "agent context" is the sub-agent's `agent_id` when present, else
 * "main" for the top-level session. This matters because sub-agents share the
 * parent's `session_id` AND `transcript_path` but have their own, separate
 * context window: keying de-dup on `session_id` alone let a sub-agent's injection
 * suppress the main session's (the instructions then never reached the main
 * context). Keying it per agent context fixes that while still de-duping repeated
 * reads within one context. Path-scoped rules can become relevant later (when a
 * different file is touched), so de-dup is also keyed per rule file, not per repo
 * — a different rule still injects the first time it matches.
 *
 * Always exits 0 and emits `{}` when there is nothing to inject. Never blocks or
 * issues a permission decision (it defers to the normal flow).
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  collectSkillCatalog,
  getRegisteredProjects,
  isUnder,
  loadMatchingRules,
  normalizePath,
  renderInstructionsBlock,
  renderRulesBlock,
  renderSkillsBlock,
  resolveInstructionsFile,
  resolveTargetChain,
  toRepoRelativePath,
} from "./target-rules-core.mjs";

const CONFIG_RELATIVE_PATH = ".claude/project-context.json";

/**
 * @typedef {{
 *   projects?: unknown[],
 *   ancestorRules?: unknown,
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

/** Read all of stdin (the PreToolUse payload). Returns "" if none. */
function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
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

/** Sentinel path for a (session, agent context, source-file) triple. */
/** @param {string} sessionId @param {string} contextId @param {string} sourcePath */
function sentinelPath(sessionId, contextId, sourcePath) {
  const key = createHash("sha1")
    .update(`${sessionId}|${contextId}|${sourcePath}`)
    .digest("hex");
  return join(tmpdir(), `claude-target-rules-${key}`);
}

/**
 * Claim a source file for injection: true the first time it is seen in this
 * agent context, false afterwards. A sentinel that cannot be written is not
 * fatal — the content is injected, just without the de-dup guarantee.
 */
/** @param {string} sessionId @param {string} contextId @param {string} sourcePath @param {string} note */
function claim(sessionId, contextId, sourcePath, note) {
  const sentinel = sentinelPath(sessionId, contextId, sourcePath);
  if (existsSync(sentinel)) {
    return false;
  }
  try {
    writeFileSync(sentinel, `${new Date().toISOString()} ${note}\n`);
  } catch {
    // Non-fatal: inject once even if the sentinel can't be written.
  }
  return true;
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

  // Every repository that owns the file, outermost first: registered roots plus
  // unregistered repository ancestors above them.
  const chain = resolveTargetChain(filePath, cwd, projects, {
    ancestors: config.ancestorRules !== false,
  });
  if (chain.length === 0) {
    emit(null);
    return;
  }

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

  /** @type {string[]} */
  const blocks = [];
  /** @type {string[]} */
  const summaryParts = [];

  for (const target of chain) {
    const relPath = toRepoRelativePath(filePath, target.root);
    /** @type {string[]} */
    const injectedHere = [];

    // 1. Root instruction file (CLAUDE.md preferred, then AGENTS.md), full text,
    //    injected at most once per (session, repo). Reproduces the native cwd
    //    memory auto-load for a sibling repo.
    const instructionsFile = resolveInstructionsFile(target.root);
    if (instructionsFile) {
      const fileName = toRepoRelativePath(instructionsFile, target.root);
      let content;
      try {
        content = readFileSync(instructionsFile, "utf8");
      } catch {
        content = "";
      }
      if (content.trim() && claim(sessionId, contextId, instructionsFile, relPath)) {
        blocks.push(renderInstructionsBlock(target, fileName, content));
        injectedHere.push(`${fileName} (full)`);
      }
    }

    // 2. Path-scoped rules under the target's .claude/rules. Missing dir is fine.
    const rules = loadMatchingRules(target.root, relPath).filter((rule) =>
      claim(sessionId, contextId, rule.abs, relPath)
    );
    if (rules.length > 0) {
      blocks.push(renderRulesBlock(target, relPath, rules));
      const names = rules.map((r) => r.rel.replace(/^\.claude\/rules\//, ""));
      injectedHere.push(`rules: ${names.join(", ")}`);
    }

    // 3. Skill catalog under the target's .claude/skills. The catalog is a single
    //    unit — claim it on the directory rather than on each SKILL.md.
    const skillsDir = `${target.root}/.claude/skills`;
    if (claim(sessionId, contextId, skillsDir, relPath)) {
      const skills = collectSkillCatalog(target.root);
      if (skills.length > 0) {
        blocks.push(renderSkillsBlock(target, skills));
        injectedHere.push(`skills: ${skills.map((s) => s.name).join(", ")}`);
      }
    }

    if (injectedHere.length > 0) {
      summaryParts.push(`${target.name} — ${injectedHere.join(" + ")}`);
    }
  }

  if (blocks.length === 0) {
    emit(null);
    return;
  }

  // One-line, display-only summary so the user can see what was injected.
  emit(blocks.join("\n\n"), `🔎 target-rules: ${summaryParts.join(" | ")}`);
}

main();
