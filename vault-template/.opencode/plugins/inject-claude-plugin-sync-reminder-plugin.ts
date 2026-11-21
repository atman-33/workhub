import { Plugin } from "@opencode/plugin";
import {
  isChildSession,
  normalizePath,
} from "./lib/project-context-core.ts";
import {
  buildReminderXml,
  detectFullDrift,
} from "../scripts/lib/claude-plugin-sync-core.mjs";

// Injects a one-shot reminder block at the start of the first chat message of
// each MAIN session when Claude Code plugin artifacts (skills/commands/agents,
// plus OpenCode-only custom tools) are out of sync with their OpenCode copies.
// Sub-agent sessions are skipped: they run as child sessions carrying a
// parentID, while the main session does not.
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
export default Plugin.define({
  id: "inject-claude-plugin-sync-reminder",
  async setup(ctx) {
    const workspaceRoot = normalizePath(ctx.location.directory);
    const injected = new Set<string>();
    const childCache = new Map<string, boolean>();

    await ctx.session.hook("prompt", async (event) => {
      const sessionID = event.sessionID;
      if (injected.has(sessionID)) {
        return;
      }

      // Sub-agent filter: skip child sessions so we don't nag inside task runs.
      if (await isChildSession(ctx, sessionID, childCache)) {
        injected.add(sessionID);
        return;
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

      // Mark injected AFTER we have cleared the lookups so a transient error
      // doesn't repeatedly re-trigger the reminder on every message of this
      // session.
      injected.add(sessionID);

      const text = buildReminderXml(report);
      if (!text) {
        return;
      }

      event.prompt.text = `${text}\n\n${event.prompt.text}`;
    });
  },
});
