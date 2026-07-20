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

// OpenCode mirror of the engineering plugin's inject-target-rules.mjs hook.
//
// Injection happens in `tool.execute.after` by appending the guidance blocks to
// the tool result (`output.output`). The tool result is fed straight back to the
// model within the same agentic loop, so the guidance reaches the model in the
// SAME turn the file is touched — the OpenCode equivalent of Claude Code's
// PreToolUse `additionalContext` placement. The earlier design queued blocks in
// `tool.execute.before` and flushed them via `experimental.chat.system.transform`,
// but that hook only runs when the system prompt is assembled at the start of a
// user turn, so the guidance arrived one full turn late.
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
  // anyway, since the tool hooks expose no agent identifier.
  const sessionState = new Map<string, SessionState>();

  return {
    "tool.execute.after": async (input, output) => {
      if (!isFileMutationTool(input.tool) || !projectConfig) {
        return;
      }

      const state = getSessionState(sessionState, input.sessionID);
      const blocks: string[] = [];
      const touchedPaths = collectTouchedPaths(input.args);
      for (const touchedPath of touchedPaths) {
        const target = findSiblingTargetProject(
          touchedPath,
          workspaceRoot,
          projectConfig,
        );
        if (!target) {
          continue;
        }

        collectTargetGuidance(target, touchedPath, state, blocks);
      }

      if (blocks.length === 0) {
        return;
      }

      output.output = [
        output.output,
        "",
        '<injected-project-guidance source="inject-target-rules-plugin">',
        "The tool call above touched a registered target project. Follow this",
        "guidance for that repository. It is injected by the harness and is not",
        "part of the tool output.",
        blocks.join("\n\n"),
        "</injected-project-guidance>",
      ].join("\n");
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

function collectTargetGuidance(
  target: TargetProject,
  touchedPath: string,
  state: SessionState,
  blocks: string[],
): void {
  if (!state.loadedInstructionTargets.has(target.root)) {
    const instructionPath = resolveInstructionsFile(target.root);
    if (instructionPath) {
      const content = safeReadText(instructionPath);
      if (content) {
        blocks.push(
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

    blocks.push(
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
