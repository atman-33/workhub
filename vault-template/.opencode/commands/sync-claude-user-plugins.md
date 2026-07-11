---
name: sync-claude-user-plugins
description: Copy commands and skills from user-scope Claude plugins into the global OpenCode directories.
---

Copy commands and skills from the installed **user-scope** Claude plugins into the global OpenCode directories.

Run:

```bash
node .opencode/scripts/sync-claude-user-plugins.mjs
```

To overwrite commands or skills that already exist in the OpenCode global directories, run:

```bash
node .opencode/scripts/sync-claude-user-plugins.mjs --force
```

Steps:

1. Verify `claude plugin list` succeeds in the current environment.
2. If needed, override the default roots with environment variables before running the script.
3. Run the script above.
3. Report the copied, skipped, missing, and parse-warning items shown in the script output.

Notes:

- By default, source plugins are resolved under `~/.claude/plugins/marketplaces` and OpenCode global files are resolved under `~/.config/opencode` for the current runtime environment.
- To target a different install location, set `CLAUDE_PLUGINS_ROOT` and/or `OPENCODE_GLOBAL_ROOT` before running the script.
- Commands are copied into `<OPENCODE_GLOBAL_ROOT>/command`.
- Skills are copied into `<OPENCODE_GLOBAL_ROOT>/skills`.
- Example for WSL targeting Windows-installed tools:

```bash
export CLAUDE_PLUGINS_ROOT=/mnt/c/Users/<your-user>/.claude/plugins/marketplaces
export OPENCODE_GLOBAL_ROOT=/mnt/c/Users/<your-user>/.config/opencode
node .opencode/scripts/sync-claude-user-plugins.mjs
```

- OpenCode does not support plugin subfolders for discovery, so name collisions are handled by skipping existing targets unless `--force` is provided.