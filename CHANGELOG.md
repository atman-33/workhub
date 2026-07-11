# Changelog

## 0.3.0 (2026-07-11)

- Task AI sessions now always start in the vault (the agent-harness home)
  instead of the task's repository; the `task-start` skill resolves the
  target repository via the vault's `.claude/project-context.json`. The
  hardcoded `C:/repos/<name>` project-path convention is removed.
- Registered projects are synced into the vault's
  `.claude/project-context.json` on every config save and on vault init
  (merge-safe: hand-edited fields and manually registered entries are
  preserved).
- Vault init skips dev artifacts in the template working copy
  (`node_modules/`, `.claude-plugin-sync-manifest.json`).

## 0.2.5 (2026-07-11)

- Move the configured vault path indicator from the Tasks toolbar to the top
  app bar so it is visible from every tab.

## 0.2.4 (2026-07-11)

- Fix task description not appearing after creation: align the Rust task
  creation body with the vault template parser (`## Description / ## Results`)
  and pass the description body in a single `create_task` call instead of a
  separate follow-up update.

## 0.2.3 (2026-07-11)

- Replace native `<select>` elements in the Tasks view and task dialog with
  shadcn/ui `Select` for consistent theming and better readability.
- Unify Tasks screen labels and vault headers to English for consistent UI
  copy.

## 0.2.2 (2026-07-11)

- Fix `check_vault_path` command argument naming so the frontend's `vaultPath`
  is correctly received by the Rust backend.
- Add error handling around the vault existence check so a failure shows the
  vault selection prompt instead of leaving the Tasks view blank.

## 0.2.1 (2026-07-11)

- Fix vault-path handling on startup: only prompt for a vault folder when the
  configured path is missing or no longer exists; otherwise load tasks
  immediately.
- Keep the app-level Settings dialog in sync when a vault folder is chosen from
  the Tasks view, preventing accidental overwrite of the vault path on the next
  Settings save.
- Skip starting the file watcher on startup when the configured vault path does
  not exist.

## 0.2.0 (2026-07-11)

- Music player (new Music tab), ported from
  [tube-loop-player](https://github.com/atman-33/tube-loop-player): add
  YouTube videos by URL (title fetched via oEmbed), multiple playlists
  (create/rename/delete/clear, drag & drop reordering), loop all/one and
  shuffle playback. Playback keeps running while switching tabs.
- Playlists are persisted in the vault at `_ai/music/playlists.json`
  (no cloud sync; the vault is the source of truth).

## 0.1.0 (2026-07-11)

- Initial release, scaffolded from [devdeck](https://github.com/atman-33/devdeck)
  v0.5.0 (its repository-management features live in the Repos tab).
- Task management MVP: tasks stored as Markdown + frontmatter in a dedicated
  Obsidian vault; list/kanban views with drag & drop (status change and manual
  ordering via the `order` field); filters; live sync via file watching;
  `_ai/index/tasks.json` machine index.
- Launch Claude Code / OpenCode on a task in its target repository (vault
  fallback for tasks without a project).
- Bundled Claude Code marketplace + `workhub` plugin (`task-list`,
  `task-start`, `task-report`, `vault-init` skills; report-reminder and
  vault-write-guard hooks) and the vault template.
- App-level settings, self-update from GitHub Releases, dark-native controls,
  new app icon.
