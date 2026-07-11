---
name: check-claude-plugin-sync
description: Diagnose drift between Claude Code plugin artifacts (skills, commands) and their OpenCode copies.
---

Diagnose whether Claude Code plugin skills and commands are in sync with their OpenCode copies, both project-scope and user-scope.

Run:

```bash
node .opencode/scripts/check-claude-plugin-sync.mjs
```

Steps:

1. Run the diagnostic script above.
2. Report every drift item with its status verbosely. Map statuses to plain-language advice:
   - `missing` — Source has it, target doesn't. Run the appropriate sync command below.
   - `stale-source` — Source content changed since the last recorded copy. Re-run the sync with `--force`.
   - `diverged` — Both source and target changed; `--force` will overwrite the local hand-edits. Point this out to the user before running.
   - `orphan` — Target still exists, but the source plugin no longer provides it. Suggest `rm -rf <targetPath>` only after the user confirms it isn't hand-written.
   - `silent-user-edit` / `seeded` — Informational only; no action needed.
3. If any actionable drift is present, suggest the corresponding remediation commands:
   - Project scope: `node .opencode/scripts/sync-claude-skills.mjs [--force]`
   - User scope: `node .opencode/scripts/sync-claude-user-plugins.mjs [--force]`

Notes:

- The exit code is `0` when there is no actionable drift, and `2` when there is.
- User-scope discovery runs `claude plugin list`; if `claude` is unavailable, that scope is skipped with a warning. Install the Claude CLI to enable user-scope checks.
- The reminder is also injected automatically at the start of every main-session chat message via the `inject-claude-plugin-sync-reminder-plugin`. Use this command for a detailed, on-demand full report.