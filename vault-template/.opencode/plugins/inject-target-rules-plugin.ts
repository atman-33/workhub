import type { Plugin } from "@opencode-ai/plugin";
import {
  collectTouchedPaths,
  createSessionState,
  findSiblingTargetProject,
  isFileMutationTool,
  loadMatchingRules,
  loadProjectContextConfig,
  normalizePath,
  resolveInstructionsFile,
  safeReadText,
  toRepoRelativePath,
  type SessionState,
  type TargetProject,
  xmlEscape,
} from "./lib/project-context-core";

const injectTargetRulesPlugin: Plugin = async (ctx, _options) => {
  const workspaceRoot = normalizePath(ctx.directory);
  const configPath = workspaceRoot + "/.claude/project-context.json";
  const projectConfig = loadProjectContextConfig(configPath);
  // De-dup is keyed by sessionID. This is safe per agent context because OpenCode
  // runs each sub-agent (task tool) in its own CHILD session with a distinct
  // sessionID (see Session.parentID in @opencode-ai/sdk), so this Map isolates
  // the main session from each sub-agent automatically.
  //
  // NOTE: this differs from the Claude Code mirror
  // (workhub-marketplace engineering plugin's inject-target-rules.mjs), where a
  // sub-agent shares the parent's session_id AND transcript_path. There, the hook
  // runs as a fresh process and de-dups via a shared filesystem sentinel, so it
  // must additionally key on agent_id to avoid a sub-agent's injection suppressing
  // the main session's. OpenCode needs no such agent keying — and could not do it
  // anyway, since tool.execute.before exposes no agent identifier.
  const sessionState = new Map<string, SessionState>();

  return {
    "tool.execute.before": async (input, output) => {
      if (!isFileMutationTool(input.tool) || !projectConfig) {
        return;
      }

      const state = getSessionState(sessionState, input.sessionID);
      const touchedPaths = collectTouchedPaths(output.args);
      for (const touchedPath of touchedPaths) {
        const target = findSiblingTargetProject(
          touchedPath,
          workspaceRoot,
          projectConfig,
        );
        if (!target) {
          continue;
        }

        queueTargetGuidance(target, touchedPath, state);
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

function queueTargetGuidance(
  target: TargetProject,
  touchedPath: string,
  state: SessionState,
): void {
  if (!state.loadedInstructionTargets.has(target.root)) {
    const instructionPath = resolveInstructionsFile(target.root);
    if (instructionPath) {
      const content = safeReadText(instructionPath);
      if (content) {
        state.pendingBlocks.push(
          [
            "<target-project-instructions>",
            `<repo name="${xmlEscape(target.name)}" path="${xmlEscape(target.root)}">`,
            content,
            "</repo>",
            "</target-project-instructions>",
          ].join("\n"),
        );
        state.loadedInstructionTargets.add(target.root);
      }
    }
  }

  const relativePath = toRepoRelativePath(touchedPath, target.root);
  for (const rule of loadMatchingRules(target.root, relativePath)) {
    if (state.loadedRules.has(rule.path)) {
      continue;
    }

    state.pendingBlocks.push(
      [
        "<target-project-rules>",
        `<rule repo="${xmlEscape(target.name)}" path="${xmlEscape(rule.path)}">`,
        rule.body,
        "</rule>",
        "</target-project-rules>",
      ].join("\n"),
    );
    state.loadedRules.add(rule.path);
  }
}

export default injectTargetRulesPlugin;
export { injectTargetRulesPlugin as server };