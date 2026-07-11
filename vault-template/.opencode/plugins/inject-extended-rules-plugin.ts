import type { Plugin } from "@opencode-ai/plugin";
import {
  buildExtendedRuleCandidates,
  collectTouchedPaths,
  createSessionState,
  isFileMutationTool,
  loadExtendedRules,
  loadProjectContextConfig,
  normalizePath,
  type SessionState,
  xmlEscape,
} from "./lib/project-context-core";

// OpenCode mirror of the engineering plugin's inject-extended-rules.mjs hook.
//
// Second rule-injection path, complementary to inject-target-rules-plugin.ts:
// where that plugin loads a TARGET repo's own `.claude/rules`, this one loads
// workspace-local "extended rules" from `<cwd>/.claude/rules-ex/*.md` and applies
// them to files in ANY repo via cwd-relative globs (`paths: ../repo/**`) or
// project-name globs (`paths: <project-name>/src/**`, resolved against the
// project roots registered in `.claude/project-context.json`).
//
// Like inject-target-rules-plugin.ts, OpenCode cannot attach context to the same
// file-tool call, so matching rules are queued on `tool.execute.before` and flushed
// into the next model turn via `experimental.chat.system.transform`. De-dup is
// keyed per sessionID (sub-agents run in distinct child sessions), tracked in
// SessionState.loadedExtendedRules.
const injectExtendedRulesPlugin: Plugin = async (ctx, _options) => {
  const workspaceRoot = normalizePath(ctx.directory);
  const sessionState = new Map<string, SessionState>();

  return {
    "tool.execute.before": async (input, output) => {
      if (!isFileMutationTool(input.tool)) {
        return;
      }

      const state = getSessionState(sessionState, input.sessionID);
      const touchedPaths = collectTouchedPaths(output.args);
      // Re-read per call: the config may be (re)generated during the session.
      const config = loadProjectContextConfig(
        workspaceRoot + "/.claude/project-context.json",
      );
      for (const touchedPath of touchedPaths) {
        const candidates = buildExtendedRuleCandidates(
          touchedPath,
          workspaceRoot,
          config,
        );
        if (candidates.length === 0) {
          continue;
        }

        queueExtendedRules(workspaceRoot, candidates, state);
      }
    },
    "experimental.chat.system.transform": async (input, output) => {
      if (!input.sessionID) {
        return;
      }

      const state = sessionState.get(input.sessionID);
      if (!state || state.pendingBlocks.length === 0) {
        return;
      }

      output.system.push(...state.pendingBlocks);
      state.pendingBlocks = [];
    },
  };
};

function getSessionState(
  sessionState: Map<string, SessionState>,
  sessionID: string,
): SessionState {
  const existing = sessionState.get(sessionID);
  if (existing) {
    return existing;
  }

  const created = createSessionState();
  sessionState.set(sessionID, created);
  return created;
}

function queueExtendedRules(
  workspaceRoot: string,
  candidatePaths: string[],
  state: SessionState,
): void {
  for (const rule of loadExtendedRules(workspaceRoot, candidatePaths)) {
    if (state.loadedExtendedRules.has(rule.path)) {
      continue;
    }

    state.pendingBlocks.push(
      [
        "<extended-rules>",
        `<rule path="${xmlEscape(rule.path)}">`,
        rule.body,
        "</rule>",
        "</extended-rules>",
      ].join("\n"),
    );
    state.loadedExtendedRules.add(rule.path);
  }
}

export default injectExtendedRulesPlugin;
export { injectExtendedRulesPlugin as server };
