import { Plugin } from "@opencode/plugin";
import {
  collectTouchedPaths,
  findSiblingTargetProject,
  isWriteTool,
  loadProjectContextConfig,
  normalizePath,
  resolveFormatCommands,
  runFormatCommands,
} from "./lib/project-context-core.ts";

export default Plugin.define({
  id: "post-format-project",
  async setup(ctx) {
    const workspaceRoot = normalizePath(ctx.location.directory);

    await ctx.tool.hook("execute.after", (event) => {
      if (event.status !== "completed") {
        return;
      }
      if (!isWriteTool(event.tool)) {
        return;
      }

      // Re-read per call: the config may be (re)generated during the session.
      const projectConfig = loadProjectContextConfig(
        workspaceRoot + "/.claude/project-context.json",
      );
      if (!projectConfig) {
        return;
      }

      const touchedPaths = collectTouchedPaths(event.input);
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
    });
  },
});
