---
name: create-pull-request
description: Analyzes git changes, drafts localized PR titles and bodies, and assists with creating or updating GitHub pull requests for the active target project repository. Use when working from the harness workspace (e.g. the workhub vault) and the user wants to create a PR, review branch changes, draft or update a PR description, or check whether a branch is ready for review.
compatibility: Requires Node 18.3+, git, and GitHub CLI. PowerShell examples assume Windows.
---

# Create Pull Request

Creates reviewer-friendly PR drafts for a repository selected from the active workspace's registered projects.

## Quick start

1. Pick the target repository using this order: a repository already resolved by a calling workflow; otherwise the repo named by the user; otherwise the repo owning the current file if it is unambiguous; otherwise a repository already surfaced in the current session's context (e.g. a registered-project list); otherwise ask one narrow question. Never assume a specific harness config file layout — it can change independently of this skill.
2. Run git and gh commands in the target repository root, not in the workspace working directory.
3. Save generated analysis and PR body files only under this skill's own `.tmp/` directory (resolve this skill's actual base directory at runtime; never write into the workspace working directory or the target repository).
4. Draft first and ask for approval before creating or updating the PR, unless the user explicitly asked for immediate creation.

## Workflow

1. Resolve the target repository path from the active context.
2. Use `Push-Location` / `Pop-Location` or an equivalent directory stack when switching into the target repository.
3. Run `scripts/analyze_changes.mjs` from the target repository to produce the analysis JSON.
4. Choose the PR template from `assets/templates/` based on branch intent, then run `scripts/generate_pr_body.mjs`.
5. Run `scripts/quality_checks.mjs` before presenting or creating the PR.
6. Present the draft and warnings to the user, or create or update the PR immediately if the user explicitly asked for that fast path.

## Guardrails

- Never run git or gh against the workspace working directory (e.g. the workhub vault) unless the PR is intentionally for that repository itself.
- Keep all temporary PR artifacts inside `.tmp/` in this skill directory.
- Treat a requested output language as binding for the final PR title and body.
- Preserve issue references, but only emit closing keywords when the PR targets the repository default branch.
- See [REFERENCE.md](REFERENCE.md) for the full workflow, PowerShell examples, and error handling.
