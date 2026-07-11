# workhub plugin

Claude Code plugin for the [workhub](../../README.md) task board. Lets an AI
agent list, start, and report tasks stored as Markdown + frontmatter in the
workhub Obsidian vault.

## Skills

| Skill | Description |
|-------|-------------|
| `task-list` | List and filter tasks from the vault (via `_ai/index/tasks.json`, falling back to `tasks/` frontmatter) |
| `task-start` | Mark a task `doing`, load its body as working context, resolve the target repository |
| `task-report` | Record results: raw report to `_ai/logs/`, polished notes to `projects/`/`knowledge/`, update the task's `## Results` and set `status: review` |
| `vault-init` | Expand `vault-template/` into a new workhub vault |
| `kb-ingest` | Classify notes from `inbox/` into `projects/`/`knowledge/`/`archive/`, propose tasks for actionable items, link and index |
| `kb-query` | Search the vault and synthesize answers across notes, citing sources with wikilinks |
| `kb-lint` | Health check: orphan notes, broken links, index drift, tag issues, stale content |
| `kb-index` | Update the zone `_index.md` files (smart diff by default, `--full` rebuild) |

## Hooks

| Hook | Trigger | Purpose |
|------|---------|---------|
| task-sync reminder | Stop | Remind to run `task-report` if a started task was left unreported |

## Vault contract

Skills follow the rules in the vault's `CLAUDE.md`: AI may only transition
`todo → doing → review` (never `done`), may only change `status`, `updated`,
and the `## Results` section of a task file, and must keep raw logs in `_ai/`.

The vault path is resolved in this order:

1. `WORKHUB_VAULT` environment variable
2. `vault_path` in `%APPDATA%\workhub\config.json`
