#!/usr/bin/env node
// @ts-check
/**
 * SessionStart hook: inject the role-based delegation criteria as a
 * <role-based-delegation> block when `roleBasedDelegation: true` is set in
 * `<project-root>/.claude/project-context.json`.
 *
 * This used to be part of `inject-project-context.mjs`, which now lives in the
 * `workhub` plugin because it is the sole reader of a file the workhub app
 * writes. The delegation half stayed here on purpose: the criteria name this
 * plugin's own sub-agents (`code-explore`, `implementer`, `heavy-implementer`,
 * `test-runner`), so it has to be switched off exactly when they are. Living
 * beside them makes that automatic — no plugin can be enabled or disabled in a
 * way that leaves an instruction to delegate to agents that are not installed.
 *
 * The two hooks read the same config file and neither writes it, so the split
 * costs nothing but a second `readFileSync`.
 *
 * Always exits 0 (SessionStart cannot block and hooks must be failure-tolerant).
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CONFIG_RELATIVE_PATH = ".claude/project-context.json";

// Delegation-criteria doc shipped alongside the hook (../role-based-model-selection.md).
const DELEGATION_DOC_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "role-based-model-selection.md"
);

/** Read all of stdin (the SessionStart payload). Returns "" if none. */
function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/**
 * Print a SessionStart hook result and exit 0.
 *
 * As in `inject-project-context.mjs`, injected text is echoed to the user via
 * the display-only `systemMessage` field so the transcript shows exactly what
 * reached the context.
 *
 * @param {string | null} additionalContext
 */
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

/**
 * Resolve the project root from env, then the stdin payload, then cwd.
 *
 * @param {string} stdinRaw
 */
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

function main() {
  const projectRoot = resolveProjectRoot(readStdin());

  let config;
  try {
    config = JSON.parse(readFileSync(join(projectRoot, CONFIG_RELATIVE_PATH), "utf8"));
  } catch {
    // Missing or malformed config: inject nothing. The malformed case is
    // reported by inject-project-context.mjs, which reads the same file —
    // repeating the complaint here would just double it.
    emit(null);
    return;
  }

  if (config?.roleBasedDelegation !== true) {
    emit(null);
    return;
  }

  let doc;
  try {
    doc = readFileSync(DELEGATION_DOC_PATH, "utf8").trim();
  } catch {
    emit(null);
    return;
  }

  emit(doc ? `<role-based-delegation>\n${doc}\n</role-based-delegation>` : null);
}

main();
