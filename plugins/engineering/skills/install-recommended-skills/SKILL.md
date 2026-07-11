---
name: install-recommended-skills
description: Install recommended engineering skills (improve-codebase-architecture, tdd, to-issues, to-prd, codebase-design, grill-with-docs) via gh skill install.
disable-model-invocation: true
allowed-tools: Bash(gh skill install *) Bash(gh auth status)
---

Install the following recommended engineering skills for Claude Code:

- improve-codebase-architecture
- tdd
- to-issues
- to-prd
- codebase-design
- grill-with-docs

Steps:

1. Verify `gh` is installed and authenticated. If `gh auth status` fails, stop and ask the user to run `gh auth login`.
2. Run the following commands in order and report the result of each:

```bash
gh skill install mattpocock/skills engineering/improve-codebase-architecture --agent claude-code
gh skill install mattpocock/skills engineering/tdd --agent claude-code
gh skill install mattpocock/skills engineering/to-issues --agent claude-code
gh skill install mattpocock/skills engineering/to-prd --agent claude-code
gh skill install mattpocock/skills engineering/codebase-design --agent claude-code
gh skill install mattpocock/skills engineering/grill-with-docs --agent claude-code
```

3. If any install fails, print the full error, continue with the remaining skills, and report a summary at the end.
4. On success, list the installed skill paths.
