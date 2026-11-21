import { Plugin } from "@opencode/plugin";
import {
  buildProjectContext,
  normalizePath,
} from "./lib/project-context-core.ts";

export default Plugin.define({
  id: "inject-project-context",
  async setup(ctx) {
    const workspaceRoot = normalizePath(ctx.location.directory);
    const configPath = workspaceRoot + "/.claude/project-context.json";
    const projectContext = buildProjectContext(configPath);
    if (!projectContext) {
      return;
    }

    const injectedSessions = new Set<string>();

    await ctx.session.hook("prompt", (event) => {
      if (injectedSessions.has(event.sessionID)) {
        return;
      }
      injectedSessions.add(event.sessionID);

      event.prompt.text = `${projectContext}\n\n${event.prompt.text}`;
    });
  },
});
