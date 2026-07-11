import type { Plugin } from "@opencode-ai/plugin";
import { makeEarlyPartId, normalizePath } from "./lib/project-context-core";
import {
  buildReminderXml,
  detectFullDrift,
} from "../scripts/lib/claude-plugin-sync-core";

// Injects a one-shot reminder block at the start of the first chat message of
// each MAIN session when Claude Code plugin artifacts (skills/commands) are out
// of sync with their OpenCode copies. Sub-agent (task tool) sessions are skipped:
// they carry a parentID on their Session record, while the main session does not.
//
// Drift categories reported:
//   - missing      : source has it, target doesn't (new artifact, never copied)
//   - stale-source : source content changed since the last recorded copy
//   - diverged     : both source and target changed independently (--force may
//                    clobber hand-edits; the reminder calls this out explicitly)
//   - orphan       : manifest knows the artifact, but the source plugin no longer
//                    provides it (plugin disabled/removed; the copy is stranded)
//
// Silent cases (no reminder):
//   - "silent-user-edit": target was hand-edited but source unchanged (respect
//     the local edit; nothing to re-sync).
//   - "seeded": target pre-existed without a manifest entry; treated as a prior
//     sync baseline until the next --force rewrites the manifest.
//
// Project scope (skills) is always computed (filesystem only, cheap). User scope
// invokes `claude plugin list`; an in-memory tmp cache backs it (TTL defaults to
// 10 minutes, configurable via CLAUDE_PLUGIN_SYNC_CACHE_TTL_MS). If `claude` is
// unavailable, user-scope drift is skipped with a note.
const injectClaudePluginSyncReminderPlugin: Plugin = async (ctx, _options) => {
  const workspaceRoot = normalizePath(ctx.directory);
  const injected = new Set<string>();

  return {
    "chat.message": async (input, output) => {
      const sessionID = input.sessionID;
      if (!sessionID || injected.has(sessionID)) {
        return;
      }

      // Sub-agent filter: skip child sessions so we don't nag inside task runs.
      try {
        const result = await ctx.client.session.get({ path: { id: sessionID } });
        const session = (result as { data?: { parentID?: string } | undefined }).data;
        if (session && typeof session.parentID === "string" && session.parentID) {
          injected.add(sessionID);
          return;
        }
      } catch {
        // If session lookup fails, treat as main session (don't block the chat).
      }

      let report;
      try {
        report = await detectFullDrift({ cwd: workspaceRoot });
      } catch {
        // Drift detection must never break the chat. Skip silently and let the
        // user run the /check-claude-plugin-sync command if they suspect drift.
        injected.add(sessionID);
        return;
      }

      // Mark injected AFTER we've cleared the lookups so a transient error doesn't
      // repeatedly re-trigger the reminder on every message of this session.
      injected.add(sessionID);

      const text = buildReminderXml(report);
      if (!text) {
        return;
      }

      output.parts.unshift({
        id: makeEarlyPartId(),
        sessionID: output.message.sessionID,
        messageID: output.message.id,
        type: "text",
        text,
        synthetic: false,
      });
    },
  };
};

export default injectClaudePluginSyncReminderPlugin;
export { injectClaudePluginSyncReminderPlugin as server };