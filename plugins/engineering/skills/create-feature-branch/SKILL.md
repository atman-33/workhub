---
name: create-feature-branch
description: Creates a new feature branch from main inside the intended repository after confirming the branch target and repository context. Use when the user wants to start a new feature branch, asks to create a branch for upcoming work, mentions a branch name such as feature/<name>, or another workflow has already resolved the target repository.
argument-hint: "What feature or branch name should this use?"
---

# Create Feature Branch

Create a new feature branch for the user's next task in the intended repository.

## Quick start

1. Confirm the target repository root unless the calling workflow already resolved it.
2. Ask what feature the branch should represent unless the user already gave a clear branch name.
3. Turn the answer into a short branch name such as `feature/<name>`.
4. Switch into the target repository root with `Push-Location` / `Pop-Location` or an equivalent directory stack.
5. Update the local `main` branch to the latest state and create the new branch there.

## Workflow

1. Resolve the repository context.
   - If a calling workflow already resolved a repository root or repository id, treat it as binding.
   - If multiple repositories could apply, ask one narrow question before running any git command.
   - Run `git rev-parse --show-toplevel` in the working directory and stop if it does not match the intended repository.
   - Never rely on the shell's inherited current directory when the repository matters.
2. Confirm the branch target.
   - If the user gives a feature description, convert it to a concise kebab-case slug.
   - If the user gives an exact branch name, use it when it matches the repository convention.
   - If the repository uses a different prefix than `feature/`, follow that convention.
3. Sync `main` in the target repository.
   - Use `Push-Location` / `Pop-Location` or an equivalent directory stack when switching into the target repository root.
   - Switch to the local `main` branch in that repository.
   - Update it from the default remote with a non-interactive command.
4. Create the feature branch.
   - Create the branch from the updated `main` branch in the target repository.
   - Switch to the new branch immediately.
5. Report the result.
   - Tell the user the final branch name.
   - Tell the user which repository root the branch was created in.
   - Surface blockers such as repository mismatches, uncommitted changes, missing remotes, or pull failures instead of guessing.

## Notes

- Never run git against `agent-harness` unless that repository is intentionally the target.
- Use non-interactive git commands.
- Do not invent a branch name when the requested feature is still ambiguous.
- Only perform the git steps when the user has explicitly asked for branch creation.