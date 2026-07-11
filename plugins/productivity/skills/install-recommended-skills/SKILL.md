---
name: install-recommended-skills
description: Install recommended productivity skills (grill-me, handoff, writing-great-skills) globally via gh skill install.
disable-model-invocation: true
allowed-tools: Bash(gh skill install *) Bash(gh auth status)
---

Install the following recommended productivity skills for Claude Code **at user scope** (available across all projects, installed to `~/.claude/skills/`):

- grill-me
- handoff
- writing-great-skills

> **Note:** This plugin itself should be installed globally with `--scope user`:
> `/plugin install productivity --scope user`

Steps:

1. Verify `gh` is installed and authenticated. If `gh auth status` fails, stop and ask the user to run `gh auth login`.
2. Run the following commands in order and report the result of each:

```bash
gh skill install mattpocock/skills productivity/grill-me --agent claude-code --scope user
gh skill install mattpocock/skills productivity/handoff --agent claude-code --scope user
gh skill install mattpocock/skills productivity/writing-great-skills --agent claude-code --scope user
```

3. If any install fails, print the full error, continue with the remaining skills, and report a summary at the end.
4. On success, list the installed skill paths.
