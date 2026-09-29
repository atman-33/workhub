---
name: create-feature-branch
description: Creates a new work branch from main inside the intended repository after confirming the branch target and repository context, named <type>/<task-id>-<slug> unless the repository says otherwise. Use when the user wants to start a new branch, asks to create a branch for upcoming work, mentions a branch name such as feature/<name> or fix/<name>, or another workflow has already resolved the target repository.
argument-hint: "What feature or branch name should this use?"
---

# Create Feature Branch

Create a new branch for the user's next task in the intended repository.

## Quick start

1. Confirm the target repository root unless the calling workflow already resolved it.
2. Ask what the branch should represent unless the user already gave a clear branch name.
3. Name it by the rules in *Branch name* below — by default `<type>/<task-id>-<slug>`, such as `feature/t-0456-battle-core`.
4. Switch into the target repository root with `Push-Location` / `Pop-Location` or an equivalent directory stack.
5. Update the local `main` branch to the latest state and create the new branch there.

## Branch name

Take the first of these that applies:

1. **The repository's own convention** — CONTRIBUTING, CLAUDE.md, or a rule
   file that names a branch format. Follow it as written.
2. **The workflow's own convention** — a caller that fixes the name, such as
   workhub's worktree mode, which works on `task/<task-id>`. Use that name.
3. **The default below.**

The default is `<type>/<task-id>-<slug>`:

- `<type>` is one of four:
  - `feature` — new behaviour
  - `fix` — a bug fix
  - `docs` — documentation only
  - `chore` — dependency updates, configuration, cleanup

  Never `feat`: the short Conventional Commits spelling belongs in commit
  messages, not branch names. Pick the type from what the change is, not from
  the word the user happened to use.
- `<task-id>` is the id of the task this work belongs to, lowercased
  (`T-0456` → `t-0456`). Take it from the task being worked on — the launch
  prompt or the task file. With no task, drop it and its hyphen.
- `<slug>` is two to four lowercase ASCII words joined by hyphens, saying what
  the branch does.

Examples:

- `feature/t-0456-battle-core`
- `fix/t-0460-billboard-depth`
- `docs/t-0457-branch-naming`
- `chore/dependency-upgrade` — no task

## Workflow

1. Resolve the repository context.
   - If a calling workflow already resolved a repository root or repository id, treat it as binding.
   - If multiple repositories could apply, ask one narrow question before running any git command.
   - Run `git rev-parse --show-toplevel` in the working directory and stop if it does not match the intended repository.
   - Never rely on the shell's inherited current directory when the repository matters.
2. Confirm the branch target.
   - If the user gives a description of the work, build the name from it by the rules in *Branch name*.
   - If the user gives an exact branch name, use it when it matches the convention that applies; otherwise propose the conforming name and say why.
3. Sync `main` in the target repository.
   - Use `Push-Location` / `Pop-Location` or an equivalent directory stack when switching into the target repository root.
   - Switch to the local `main` branch in that repository.
   - Update it from the default remote with a non-interactive command.
4. Create the branch.
   - Create the branch from the updated `main` branch in the target repository.
   - Switch to the new branch immediately.
5. Report the result.
   - Tell the user the final branch name.
   - Tell the user which repository root the branch was created in.
   - Surface blockers such as repository mismatches, uncommitted changes, missing remotes, or pull failures instead of guessing.

## Notes

- Never run git against the workspace working directory (e.g. the workhub vault) unless it is intentionally the target.
- Use non-interactive git commands.
- Do not invent a branch name when the requested work is still ambiguous.
- Only perform the git steps when the user has explicitly asked for branch creation.
