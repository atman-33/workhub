# Another session's uncommitted work (the branch-switch trap)

This repository is routinely worked by more than one agent session at once —
that is what the app it builds is for. Two tasks can be live in the **same**
working tree, and git gives you no warning when they are.

Cutting a branch does not isolate you from them. `git switch -c <new> origin/main`
carries every uncommitted change with it, so the other session's work-in-progress
lands on your branch, and that session is now standing on a branch it never
chose. T-0273 hit exactly this: T-0274's edits to `src-tauri/src/tasks.rs` and
five other files followed the new branch across.

**Before switching or creating a branch, read `git status` for whose work it is
— not merely for whether the tree is clean.** Modified files you did not touch
belong to someone else.

```powershell
git status --short
git log --oneline -3        # whose branch are you standing on?
```

**A `git diff --stat` that comes back empty is not proof.** The other session
may simply be between edits; it will write again a minute later. On Windows the
same command also reports `src-tauri/gen/schemas/*.json` as modified from CRLF
alone — real, harmless, and easy to mistake for "the tree is basically clean".

When you find another session's work:

- **Say so and ask** before switching. Its branch position is that session's
  state, not yours to move.
- If a switch has already happened, **stage your own files by name** —
  never `git add -A` or `git commit -a` — so the commit stays yours alone.
  The other session's changes stay in the working tree and remain its own.
- Do not stash, reset, or check out files you did not modify. A stash empties
  the tree under a running session with no indication of where its work went.

A task marked `worktree: true` avoids all of this by construction; see
`worktree-dev-server.md` for the one thing a worktree does **not** isolate.
