---
name: setup-team-context
description: Set up team-ops for this machine/project - create .claude/team-context.json, scaffold the team-shared ai/ folder skeleton, and optionally register a project. Use when onboarding a machine to a team shared folder, when the team-context hook reports a config error, or when adding a new team project.
---

# Set up the team-ops context

Configure this working directory to use a team-shared folder as the team's
single source of truth (see `${CLAUDE_PLUGIN_ROOT}/docs/design.html`).

## Steps

1. **Collect inputs** (ask only for what's missing):
   - `teamRootPath` — the locally synced shared folder (Google Drive /
     OneDrive / file server). The `ai/` zone is created inside it.
   - `me` — the user's short name (used in activity-log entries).
   - Optionally a project name to scaffold, and the team content language
     (BCP 47 tag like `ja` / `en`; only applied when `_meta/team.json` does
     not exist yet).
2. **Run the setup script**:

   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup/init-team-context.mjs" \
     --team-root "<path>" --me "<name>" [--project "<name>"] [--language ja]
   ```

   It writes/merges `.claude/team-context.json` (and gitignores it),
   scaffolds `ai/` (`knowledge/`, `_meta/conventions.md`, `_meta/team.json`,
   `_meta/activity-log.md`), and — with `--project` — the project skeleton
   (`config/project.json`, `backlog/`, `sprints/`, `docs/spec/spec.md`,
   `reports/daily/`). It only creates missing files, never overwrites.
3. **Configure the project's repos** (when a project was scaffolded): open
   `projects/<name>/config/project.json` and replace the example entry with
   the real repositories — `name`, `url`, and each repo's `devMainBranch`
   (the project development main branch PBI work merges into).
4. **Report** the JSON summary and remind the user that the new context is
   injected on the next session start.

## Notes

- The local config holds machine-local paths only; everything shared lives
  in the shared folder itself, so teammates just point at the same
  `teamRootPath`.
- Changing the team language later = editing `_meta/team.json`.
