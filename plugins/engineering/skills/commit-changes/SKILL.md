---
description: Commit the current changes with a Conventional Commits message. Use when the user asks to commit, or when a workflow (e.g. develop-small-feature) reaches its commit step after implementation is verified.
name: commit-changes
---
Commit the current changes with a Conventional Commits message.

## Steps

1. **Assess the working tree.** Run `git status --short` and `git diff` (or `git diff --staged` if changes are already staged) to see what changed and why.
   - Completion criterion: the changed files and their purpose are known.

2. **Stage changes.** If nothing is staged, run `git add .`.
   - Completion criterion: at least one change is staged.

3. **Draft the message.** Pick a Conventional Commits prefix based on the diff:
   - `feat` — new feature
   - `fix` — bug fix
   - `docs` — documentation only
   - `style` — formatting, missing semicolons, etc.
   - `refactor` — code change that neither fixes a bug nor adds a feature
   - `test` — adding or correcting tests
   - `chore` — build process or auxiliary tool/library changes
   Then write a short imperative description in `<type>: <description>` format. Use English unless the user requested another language.
   - Completion criterion: the message follows the format and matches the change.

4. **Commit.** Run `git commit -m "<message>"`.
   - Completion criterion: the commit succeeds and its hash is shown.

## Failure modes

- No changes to commit: stop and report.
- `git` not in a repository: stop and report.
- Multiple unrelated changes: consider splitting into multiple commits and ask the user.
