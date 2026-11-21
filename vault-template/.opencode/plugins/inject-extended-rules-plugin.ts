import { Plugin } from "@opencode/plugin";
import {
  appendTextToToolContent,
  buildExtendedRuleCandidates,
  collectTouchedPaths,
  createSessionState,
  isFileMutationTool,
  loadExtendedRules,
  loadProjectContextConfig,
  normalizePath,
  type SessionState,
  xmlEscape,
} from "./lib/project-context-core.ts";

// OpenCode mirror of the engineering plugin's inject-extended-rules.mjs hook.
//
// Second rule-injection path, complementary to inject-target-rules-plugin.ts:
// where that plugin loads a TARGET repo's own `.claude/rules`, this one loads
// workspace-local "extended rules" from `<cwd>/.claude/rules-ex/*.md` and applies
// them to files in ANY repo via cwd-relative globs (`paths: ../repo/**`) or
// project-name globs (`paths: <project-name>/src/**`, resolved against the
// project roots registered in `.claude/project-context.json`).
export default Plugin.define({
  id: "inject-extended-rules",
  async setup(ctx) {
    const workspaceRoot = normalizePath(ctx.location.directory);
    const sessionState = new Map<string, SessionState>();

    await ctx.tool.hook("execute.after", (event) => {
      if (event.status !== "completed") {
        return;
      }
      if (!isFileMutationTool(event.tool)) {
        return;
      }

      const state = getSessionState(sessionState, event.sessionID);
      const blocks: string[] = [];
      const touchedPaths = collectTouchedPaths(event.input);
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

        collectExtendedRules(workspaceRoot, candidates, state, blocks);
      }

      if (blocks.length === 0) {
        return;
      }

      const suffix = [
        "",
        '<injected-project-guidance source="inject-extended-rules-plugin">',
        "The tool call above touched a file covered by workspace extended rules.",
        "Follow this guidance. It is injected by the harness and is not part of",
        "the tool output.",
        blocks.join("\n\n"),
        "</injected-project-guidance>",
      ].join("\n");
      event.result = {
        ...event.result,
        content: appendTextToToolContent(event.result.content, suffix),
      };
    });
  },
});

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

function collectExtendedRules(
  workspaceRoot: string,
  candidatePaths: string[],
  state: SessionState,
  blocks: string[],
): void {
  for (const rule of loadExtendedRules(workspaceRoot, candidatePaths)) {
    if (state.loadedExtendedRules.has(rule.path)) {
      continue;
    }

    blocks.push(
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
