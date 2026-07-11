---
name: develop-small-feature
description: Implement a small, well-scoped feature or fix end-to-end from spec to PR — reuse or create a feature branch, implement test-first, run static checks, get user verification, commit, then open a PR to main.
disable-model-invocation: true
argument-hint: The feature or fix spec to implement (optional — falls back to conversation context).
allowed-tools: Skill Agent Read Write Edit Grep Glob Bash AskUserQuestion
---

# Develop Small Feature

Implement the feature or fix described below, carrying it through the full
branch → TDD → static checks → user verification → commit → PR lifecycle.

This skill is scoped to small, well-scoped changes (a handful of files, a
settled approach). For large or uncertain work — spanning many files, needing
real debugging/trial-and-error, or warranting a deep review — use
`heavy-implementer` and/or the `code-review`/`simplify` skills directly
instead of forcing this flow.

Spec: $ARGUMENTS

If no spec is given as an argument, use the specification already established
in this conversation (the user's most recent instructions, requirements
already discussed, or an agreed-on OpenSpec change). Do not ask the user to
repeat themselves if the spec is already clear from context; ask only if it is
genuinely ambiguous.

## Steps

1. **Feature branch.** Run `git branch --show-current`.
   - If already on a branch other than the repository's default branch (e.g.
     an existing `feature/*` branch), stay on it — do not switch.
   - If on the default branch, invoke the **create-feature-branch** skill to
     create and switch to a new feature branch derived from the spec.

2. **Implement, test-first.** Invoke the **tdd** skill to implement the
   change (red → green → refactor), delegating the work to the
   **implementer** agent by default. Do not use `heavy-implementer` unless
   the user explicitly asks for it, or `implementer` reports (or a retry
   shows) that the change needs cross-file debugging/trial-and-error it can't
   resolve — in that case escalate the rest of the work to
   `heavy-implementer`, which can drive its own TDD loop directly.

3. **Static checks.** Delegate to **test-runner** to run the target repo's
   lint/format/check commands (e.g. `npm run check` for this marketplace) and
   report pass/fail. Let auto-fixable issues (formatters) be fixed directly;
   for remaining lint errors, delegate the fix to **implementer** and re-run
   the checks.
   - This intentionally replaces a full code-review/simplify pass — this
     skill targets small changes where lint + tests + the user's own look are
     enough. If the diff turns out larger or riskier than expected, tell the
     user and suggest running the `code-review` or `simplify` skill manually.

4. **Request user verification.** Before committing, tell the user what was
   implemented and ask them to manually verify the behavior (e.g. run the
   app, exercise the feature) against the *uncommitted* working tree. Stop
   and wait for their confirmation — do not commit yet.

5. **Commit.** Once the user confirms the change works, invoke the
   **commit-changes** skill to commit the work with a Conventional Commits
   message.

6. **Create the PR.** Invoke the **create-pull-request** skill to open a PR.
   Unless the user specifies another target, the PR is for merging into the
   `main` branch.

## Notes

- Follow the steps in order; do not skip the test-first loop or the
  user-verification step even for small changes.
- Keep delegations to `implementer`/`heavy-implementer` focused — pass only
  the spec/context each one needs, and rely on their report contracts rather
  than pasting full diffs, test output, or logs into this conversation.
- If step 4 (user verification) turns up a problem, fix it (re-delegate to
  `implementer`, or escalate per step 2 if it's non-trivial), re-run static
  checks, and only then proceed to commit.
- If a genuine blocker comes up (ambiguous spec, a check that cannot be made
  to pass), stop and surface it to the user rather than guessing.

## Output Format

Report progress step by step:
- Step name and outcome (done / blocked / waiting on user).
- The branch name in use.
- Files changed, once implementation is done (from implementer's or
  heavy-implementer's report).
- Step 3's static-check result summary.
- At step 4, an explicit request for the user to verify the behavior, then
  stop.
- At step 6, the resulting PR URL.
