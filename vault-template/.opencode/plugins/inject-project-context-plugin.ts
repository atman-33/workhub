import type { Plugin } from "@opencode-ai/plugin";
import {
  buildProjectContext,
  makeEarlyPartId,
  normalizePath,
} from "./lib/project-context-core";

const injectProjectContextPlugin: Plugin = async (ctx, _options) => {
  const workspaceRoot = normalizePath(ctx.directory);
  const configPath = workspaceRoot + "/.claude/project-context.json";
  const projectContext = buildProjectContext(configPath, workspaceRoot);
  const contextInjectedSessions = new Set<string>();

  return {
    "chat.message": async (input, output) => {
      if (contextInjectedSessions.has(input.sessionID)) {
        return;
      }
      contextInjectedSessions.add(input.sessionID);

      if (!projectContext) {
        return;
      }

      output.parts.unshift({
        id: makeEarlyPartId(),
        sessionID: output.message.sessionID,
        messageID: output.message.id,
        type: "text",
        text: projectContext,
        synthetic: false,
      });
    },
  };
};

export default injectProjectContextPlugin;
export { injectProjectContextPlugin as server };