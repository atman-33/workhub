---
name: sync-claude-skills
description: Copy skills from project-scope Claude plugins into .opencode/skills.
---

Copy skills from the project-scope plugins listed in `.claude/settings.json` into `.opencode/skills/`.

Run:

```bash
node .opencode/scripts/sync-claude-skills.mjs
```

To overwrite skills that already exist in `.opencode/skills/`, run:

```bash
node .opencode/scripts/sync-claude-skills.mjs --force
```

Steps:

1. Verify `.claude/settings.json` exists in the working directory and contains at least one enabled plugin.
2. Run the script above.
3. Report the copied, skipped, and missing items shown in the script output.
