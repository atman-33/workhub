---
name: install-recommended-skills-globally
description: Install recommended productivity skills (grill-me, handoff, writing-great-skills) globally via gh skill install.
---

Install the following recommended productivity skills for OpenCode **at user scope** (available across all projects, installed to `~/.config/opencode/skills/`):

- grill-me
- handoff
- writing-great-skills

Steps:

1. Verify `gh` is installed and authenticated. If `gh auth status` fails, stop and ask the user to run `gh auth login`.
2. Run the following commands in order and report the result of each:

```bash
gh skill install mattpocock/skills productivity/grill-me --agent opencode --scope user
gh skill install mattpocock/skills productivity/handoff --agent opencode --scope user
gh skill install mattpocock/skills productivity/writing-great-skills --agent opencode --scope user
```

3. If any install fails, print the full error, continue with the remaining skills, and report a summary at the end.
4. On success, list the installed skill paths.
