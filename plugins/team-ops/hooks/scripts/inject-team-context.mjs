#!/usr/bin/env node
// @ts-check
/**
 * SessionStart hook: inject the team-ops context — team root, content
 * language, active projects, and the knowledge-capture norm — as a
 * <team-context> XML block.
 *
 * Reads `<project-root>/.claude/team-context.json` (machine-local) plus the
 * shared `_meta/team.json` inside the team root.
 *
 * Behaviour:
 *   - No config file   -> emit nothing (never nag unconfigured projects).
 *   - Malformed config -> emit a short error note so the user can fix it.
 *   - Valid config     -> emit the <team-context> block + capture norm.
 * Always exits 0 (SessionStart cannot block and hooks must be failure-tolerant).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CONFIG_RELATIVE_PATH = ".claude/team-context.json";

/** Read all of stdin (the SessionStart payload). Returns "" if none. */
function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/** @param {unknown} value */
function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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

const projectRoot = resolveProjectRoot(readStdin());
const configPath = join(projectRoot, CONFIG_RELATIVE_PATH);

if (!existsSync(configPath)) {
  emit(null);
}

/** @type {any} */
let config = null;
try {
  config = JSON.parse(readFileSync(configPath, "utf8"));
} catch {
  emit(
    `<team-context-error>${xmlEscape(CONFIG_RELATIVE_PATH)} exists but is not valid JSON — fix it or re-run the setup-team-context skill.</team-context-error>`,
  );
}

const teamRootPath =
  config && typeof config.teamRootPath === "string" ? config.teamRootPath.trim() : "";
if (!teamRootPath) {
  emit(
    `<team-context-error>${xmlEscape(CONFIG_RELATIVE_PATH)} is missing "teamRootPath" — re-run the setup-team-context skill.</team-context-error>`,
  );
}

const aiRoot = join(teamRootPath, "ai");
const rootExists = existsSync(aiRoot);

// Shared team-wide settings (content language) from _meta/team.json.
let language = "en";
try {
  const meta = JSON.parse(readFileSync(join(aiRoot, "_meta", "team.json"), "utf8"));
  if (meta && typeof meta.language === "string" && meta.language.trim()) {
    language = meta.language.trim();
  }
} catch {
  // no shared meta yet: keep the default
}

const me = typeof config.me === "string" ? config.me.trim() : "";
const activeProjects = Array.isArray(config.activeProjects)
  ? config.activeProjects.filter((p) => typeof p === "string" && p.trim())
  : [];

const lines = ["<team-context>"];
lines.push(`  <team-root path="${xmlEscape(teamRootPath)}" ai-zone="${xmlEscape(aiRoot)}" />`);
lines.push(`  <content-language value="${xmlEscape(language)}" />`);
if (me) lines.push(`  <me name="${xmlEscape(me)}" />`);
lines.push(`  <knowledge dir="${xmlEscape(join(aiRoot, "knowledge"))}" />`);
for (const project of activeProjects) {
  lines.push(
    `  <project name="${xmlEscape(project)}" dir="${xmlEscape(join(aiRoot, "projects", project))}" />`,
  );
}
if (!rootExists) {
  lines.push(
    `  <warning>The team AI zone was not found at the path above — check that the shared folder is synced locally, or re-run setup-team-context.</warning>`,
  );
}
lines.push(
  `  <norms>Team knowledge, backlog, sprint, and spec content is written in the content-language above. Conventions live in ${xmlEscape(join(aiRoot, "_meta", "conventions.md"))}. When this session surfaces reusable TEAM knowledge — a process gotcha, a decision rationale, domain know-how useful to teammates or newcomers — propose saving it with the team-kb-save skill at the moment of discovery (repo-specific technical rules still go to that repo's .claude/rules). After writing to the shared folder, append one line to _meta/activity-log.md.</norms>`,
);
lines.push("</team-context>");

emit(lines.join("\n"));
