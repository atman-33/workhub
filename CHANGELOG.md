# Changelog

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
