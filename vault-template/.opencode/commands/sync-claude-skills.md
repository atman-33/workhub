---
name: sync-claude-skills
description: Copy skills and agents from project-scope Claude plugins into .opencode.
---

Copy the skills and agents of the project-scope plugins listed in
`.claude/settings.json` into `.opencode/skills/` and `.opencode/agent/`.

Agents are rewritten into OpenCode's frontmatter on the way (`mode: subagent`,
a tools map, no `model:` — Claude's short model aliases are not OpenCode model
ids). Both directories are generated: edit the plugin source, then re-run this.

Run:

```bash
node .opencode/scripts/sync-claude-skills.mjs
```

To overwrite copies that already exist, run:

```bash
node .opencode/scripts/sync-claude-skills.mjs --force
```

To also delete copies whose source plugin no longer provides them (e.g. after
a plugin was removed from `.claude/settings.json`), run:

```bash
node .opencode/scripts/sync-claude-skills.mjs --prune
```

`--prune` only deletes manifest-tracked orphans; hand-written targets the
manifest never recorded are left alone. The two flags combine (`--force --prune`).

Steps:

1. Verify `.claude/settings.json` exists in the working directory and contains at least one enabled plugin.
2. Run the script above.
3. Report the copied, skipped, and missing items shown in the script output.
