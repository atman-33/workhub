# Changelog

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
