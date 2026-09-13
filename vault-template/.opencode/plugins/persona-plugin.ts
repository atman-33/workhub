import type { Plugin } from "@opencode-ai/plugin";
import { makeEarlyPartId, normalizePath } from "./lib/project-context-core";
import { resolvePersonaInjection } from "../scripts/lib/claude-plugin-sync-core";

// OpenCode adapter for the persona Claude plugin (T-0308).
//
// Mirrors the plugin's two hooks with the same read-only resolution living in
// the sync core: the first message of each MAIN session gets the SessionStart
// block (character + compression + boundaries, filtered to the active level),
// every later message gets the one-line per-turn reminder. Sub-agent (task
// tool) sessions are skipped: they carry a parentID on their Session record,
// while the main session does not.
//
// Gating is live on every message: the user `enabledPlugins` must contain
// `persona@workhub-marketplace` AND `persona.json` must resolve enabled.
// Anything else (plugin off, state off, no characters installed) stays silent,
// so disabling persona in Claude Code or the Persona tab takes it out of
// OpenCode on the very next message with no sync step in between.
//
// Deliberately NOT mirrored: /persona switching (no command path in opencode;
// switch in the Persona tab or a Claude session instead), the session flag,
// and all writes (statusline label, session flag, persona.json) — opencode
// never mutates Claude-side session state.
const personaPlugin: Plugin = async (ctx, _options) => {
  const workspaceRoot = normalizePath(ctx.directory);
  const fullInjectedSessions = new Set<string>();

  return {
    "chat.message": async (input, output) => {
      const sessionID = input.sessionID;
      if (!sessionID) {
        return;
      }

      // Sub-agent filter: skip child sessions so delegated work runs unstyled.
      try {
        const result = await ctx.client.session.get({ path: { id: sessionID } });
        const session = (result as { data?: { parentID?: string } | undefined }).data;
        if (session && typeof session.parentID === "string" && session.parentID) {
          return;
        }
      } catch {
        // If session lookup fails, treat as main session (don't block the chat).
      }

      let injection;
      try {
        injection = resolvePersonaInjection({ cwd: workspaceRoot });
      } catch {
        // Persona must never break the chat. Skip silently; the state can be
        // inspected with plain file reads when something looks off.
        return;
      }
      if (!injection) {
        return;
      }

      const first = !fullInjectedSessions.has(sessionID);
      fullInjectedSessions.add(sessionID);

      output.parts.unshift({
        id: makeEarlyPartId(),
        sessionID: output.message.sessionID,
        messageID: output.message.id,
        type: "text",
        text: first ? injection.full : injection.reminder,
        synthetic: false,
      });
    },
  };
};

export default personaPlugin;
export { personaPlugin as server };
