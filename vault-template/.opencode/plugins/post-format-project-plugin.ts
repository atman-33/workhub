import type { Plugin } from "@opencode-ai/plugin";
import {
  collectTouchedPaths,
  findSiblingTargetProject,
  isWriteTool,
  loadProjectContextConfig,
  normalizePath,
  resolveFormatCommands,
  runFormatCommands,
} from "./lib/project-context-core";

const postFormatProjectPlugin: Plugin = async (ctx, _options) => {
  const workspaceRoot = normalizePath(ctx.directory);
  const configPath = workspaceRoot + "/.claude/project-context.json";
  const projectConfig = loadProjectContextConfig(configPath);

  return {
    "tool.execute.after": async (input) => {
      if (!isWriteTool(input.tool) || !projectConfig) {
        return;
      }

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

        const commands = resolveFormatCommands(projectConfig, target.project);
        if (commands.length === 0) {
          continue;
        }

        runFormatCommands(target.root, commands);
      }
    },
  };
};

export default postFormatProjectPlugin;
export { postFormatProjectPlugin as server };