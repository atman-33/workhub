---
name: sync-claude-skills
description: Mirror the vault-local Claude skills and agents into .opencode.
---

Copy the vault's own `.claude/skills/` and `.claude/agents/` into
`.opencode/skills/` and `.opencode/agent/`.

Agents are rewritten into OpenCode's frontmatter on the way (`mode: subagent`,
a tools map, no `model:` — Claude's short model aliases are not OpenCode model
ids). Both directories are generated: edit the vault-local source, then re-run
this. Plugin skills/agents are not handled here — they reach OpenCode through
`/sync-claude-user-plugins` (enabled user-scope plugins only).

Run:

```bash
node .opencode/scripts/sync-claude-skills.mjs
```

To overwrite copies that already exist, run:

```bash
node .opencode/scripts/sync-claude-skills.mjs --force
```

To also delete copies whose source is gone (e.g. a deleted vault-local skill,
or a plugin copy stranded by the move to user-scope-only plugins), run:

```bash
node .opencode/scripts/sync-claude-skills.mjs --prune
```

`--prune` only deletes manifest-tracked orphans; hand-written targets the
manifest never recorded are left alone. The two flags combine (`--force --prune`).

Steps:

1. Run the script above from the vault root.
2. Report the copied, skipped, and missing items shown in the script output.
