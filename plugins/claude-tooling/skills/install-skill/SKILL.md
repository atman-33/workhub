---
description: Install a Claude Code skill from a GitHub skills repository URL.
disable-model-invocation: true
name: install-skill
---
Install a Claude Code skill from a GitHub skills repository URL.

## Steps

1. **Route the input.** Decide whether the user gave a GitHub tree URL or a repo/skill reference.
   - Completion criterion: the input is classified as exactly one of URL or reference.

2. **Extract repo and skill path.** For a tree URL of the form `https://github.com/OWNER/REPO/tree/<ref>/skills/<category>/<skill>`, extract `OWNER/REPO` and the path under `skills/` — for example, `productivity/writing-great-skills`. If the user gave `OWNER/REPO <path>` directly, use it as-is.
   - Completion criterion: both the repository and the skill path are identified.

3. **Install for Claude Code.** Run:
   ```bash
   gh skill install <repo> <skill-path> --agent claude-code
   ```
   - Completion criterion: the command exits successfully.

4. **Report result.** Show the installed skill path and any warnings.
   - Completion criterion: the user can see whether the install succeeded.

## Failure modes

- `gh` missing or unauthenticated: stop and ask the user to run `gh auth login`.
- URL with no `skills/` segment: stop and ask for a repo/skill reference.
- `gh skill install` fails: print the full error and do not retry.
