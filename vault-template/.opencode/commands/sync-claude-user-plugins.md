---
name: sync-claude-user-plugins
description: Copy commands, skills, and agents from the enabled harness-set plugins into the global OpenCode directories.
---

Copy commands, skills, and agents from the harness set — `workhub`,
`engineering`, `obsidian`, `persona` (required + recommended) — to the extent
each is enabled at **user scope**, into the global OpenCode directories.

Only set members enabled in the user `~/.claude/settings.json` `enabledPlugins`
are synced — switching one off in Claude Code removes it from OpenCode
on the next sync. Anything outside the harness set stays Claude-only: a skill
syncs mechanically, but a plugin's hooks need a hand-written OpenCode port,
which exists solely for these four. Agents are rewritten into OpenCode's frontmatter on the way
(`mode: subagent`, a tools map, no `model:`).

Run:

```bash
node .opencode/scripts/sync-claude-user-plugins.mjs
```

To overwrite commands, skills, or agents that already exist in the OpenCode global directories, run:

```bash
node .opencode/scripts/sync-claude-user-plugins.mjs --force
```

To also delete copies whose source plugin no longer provides them (e.g. after
a plugin was disabled or removed), run:

```bash
node .opencode/scripts/sync-claude-user-plugins.mjs --prune
```

`--prune` only deletes manifest-tracked orphans; hand-written targets the
manifest never recorded are left alone.

Steps:

1. Verify `claude plugin list` succeeds in the current environment.
2. If needed, override the default roots with environment variables before running the script.
3. Run the script above.
3. Report the copied, skipped, missing, and parse-warning items shown in the script output.

Notes:

- By default, source plugins are resolved under `~/.claude/plugins/marketplaces`, the enabled set is read from `~/.claude/settings.json` (override with `CLAUDE_USER_SETTINGS`), and OpenCode global files are resolved under `~/.config/opencode` for the current runtime environment.
- To target a different install location, set `CLAUDE_PLUGINS_ROOT` and/or `OPENCODE_GLOBAL_ROOT` before running the script.
- Commands are copied into `<OPENCODE_GLOBAL_ROOT>/command`.
- Skills are copied into `<OPENCODE_GLOBAL_ROOT>/skills`.
- Agents are copied into `<OPENCODE_GLOBAL_ROOT>/agent`.
- Example for WSL targeting Windows-installed tools:

```bash
export CLAUDE_PLUGINS_ROOT=/mnt/c/Users/<your-user>/.claude/plugins/marketplaces
export OPENCODE_GLOBAL_ROOT=/mnt/c/Users/<your-user>/.config/opencode
node .opencode/scripts/sync-claude-user-plugins.mjs
```

- OpenCode does not support plugin subfolders for discovery, so name collisions are handled by skipping existing targets unless `--force` is provided.