import { Plugin } from "@opencode/plugin";
import {
  isChildSession,
  normalizePath,
} from "./lib/project-context-core.ts";
import { resolvePersonaInjection } from "../scripts/lib/claude-plugin-sync-core.mjs";

// OpenCode adapter for the persona Claude plugin.
//
// Mirrors the plugin's two hooks with the same read-only resolution living in
// the sync core: the first prompt of each MAIN session gets the SessionStart
// block (character + compression + boundaries, filtered to the active level),
// every later prompt gets the one-line per-turn reminder. Sub-agent sessions
// are skipped: they run as child sessions carrying a parentID, while the main
// session does not.
//
// Gating is live on every message: the user `enabledPlugins` must contain
// `persona@workhub-marketplace` AND `persona.json` must resolve enabled.
// Anything else (plugin off, state off, no characters installed) stays silent,
// so disabling persona in Claude Code or the Persona tab takes it out of
// OpenCode on the very next message with no sync step in between.
//
// Deliberately NOT mirrored: /persona switching (no command path in opencode;
// switch in the Persona tab or a Claude session instead), the session flag, and
// all writes (statusline label, session flag, persona.json) — opencode
// never mutates Claude-side session state.
export default Plugin.define({
  id: "persona",
  async setup(ctx) {
    const workspaceRoot = normalizePath(ctx.location.directory);
    const injectedSessions = new Set<string>();
    const childCache = new Map<string, boolean>();

    await ctx.session.hook("prompt", async (event) => {
      const sessionID = event.sessionID;

      // Sub-agent filter: skip child sessions so delegated work runs unstyled.
      if (await isChildSession(ctx, sessionID, childCache)) {
        return;
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

      const first = !injectedSessions.has(sessionID);
      injectedSessions.add(sessionID);

      const text = first ? injection.full : injection.reminder;
      event.prompt.text = `${text}\n\n${event.prompt.text}`;
    });
  },
});
