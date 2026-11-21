import { Plugin } from "@opencode/plugin";
import {
  appendTextToToolContent,
  collectSkillCatalog,
  collectTouchedPaths,
  createSessionState,
  isFileMutationTool,
  loadMatchingRules,
  loadProjectContextConfig,
  normalizePath,
  resolveInstructionsFile,
  resolveTargetChain,
  safeReadText,
  toRepoRelativePath,
  type SessionState,
  type TargetProject,
  xmlEscape,
} from "./lib/project-context-core.ts";

// OpenCode mirror of the engineering plugin's inject-target-rules.mjs hook.
//
// Injection happens in `tool.execute.after` by appending the guidance blocks to
// the tool result, so the guidance reaches the model in the SAME turn the file
// is touched. De-dup is keyed per sessionID (sub-agents run in distinct child
// sessions), tracked in SessionState.loadedRules and friends.
export default Plugin.define({
  id: "inject-target-rules",
  async setup(ctx) {
    const workspaceRoot = normalizePath(ctx.location.directory);
    const configPath = workspaceRoot + "/.claude/project-context.json";
    const projectConfig = loadProjectContextConfig(configPath);
    // De-dup is keyed by sessionID. This is safe per agent context because
    // OpenCode runs each sub-agent (task tool) in its own CHILD session with a
    // distinct sessionID, so this Map isolates the main session from each
    // sub-agent automatically.
    const sessionState = new Map<string, SessionState>();

    await ctx.tool.hook("execute.after", (event) => {
      if (event.status !== "completed") {
        return;
      }
      if (!isFileMutationTool(event.tool) || !projectConfig) {
        return;
      }

      const state = getSessionState(sessionState, event.sessionID);
      const blocks: string[] = [];
      const touchedPaths = collectTouchedPaths(event.input);
      for (const touchedPath of touchedPaths) {
        // Every repository that owns the file, outermost first: registered
        // roots plus unregistered repository ancestors above them. Outermost
        // first so the innermost, most specific guidance reads closest to the
        // request.
        for (const target of resolveTargetChain(
          touchedPath,
          workspaceRoot,
          projectConfig,
        )) {
          collectTargetGuidance(target, touchedPath, state, blocks);
        }
      }

      if (blocks.length === 0) {
        return;
      }

      const suffix = [
        "",
        '<injected-project-guidance source="inject-target-rules-plugin">',
        "The tool call above touched a registered target project. Follow this",
        "guidance for that repository. It is injected by the harness and is not",
        "part of the tool output.",
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

  // The skill catalog is a single unit — keyed on the repo, not on each
  // SKILL.md. The skills are NOT registered with the host's skill mechanism, so
  // the model is pointed at the files and reads one when it applies.
  if (!state.loadedSkillCatalogs.has(target.root)) {
    state.loadedSkillCatalogs.add(target.root);
    const skills = collectSkillCatalog(target.root);
    if (skills.length > 0) {
      blocks.push(
        [
          "<target-project-skills>",
          `<repo name="${xmlEscape(target.name)}" path="${xmlEscape(target.root)}">`,
          "These skills are defined by the repository above and cannot be invoked",
          "by name. When one fits the work at hand, read its SKILL.md and follow it.",
          ...skills.map(
            (skill) =>
              `<skill name="${xmlEscape(skill.name)}" path="${xmlEscape(skill.path)}">${xmlEscape(skill.description)}</skill>`,
          ),
          "</repo>",
          "</target-project-skills>",
        ].join("\n"),
      );
    }
  }
}
