---
paths:
  - "src-tauri/src/git.rs"
  - "src/components/graph/**"
  - "src/components/repos/**"
---

# Counting working-tree changes: use the diff, never `git status`

`git status --porcelain` and `git diff HEAD` do not always agree, so a count
taken from one and a file list rendered from the other will contradict each
other on some machines.

The case that bit us (T-0270): with `core.autocrlf=true` and `* text=auto`, a
tracked file checked out with CRLF endings and rewritten with LF is reported by
status as modified, while its HEAD, index and working-tree blobs all hash to
the same value — `git diff HEAD` finds nothing, and `git update-index
--refresh` does not clear it (the index holds the CRLF-era stat). The graph
counted status lines and rendered the diff, so it showed a
"2 uncommitted changes" row whose file list was empty.

**Count from `worktree_change_count()`**, which is built on the same
`worktree_files()` the diff panel renders (`git diff HEAD` name-status plus
`git ls-files --others`). Anything that reports "how many changes are there" —
the graph's `uncommitted`, the repo row's change chip, a worktree's `dirty`
flag — goes through it, so the number and the detail view cannot disagree.

`git status --porcelain=v2 --branch` stays the source for branch name, upstream
and ahead/behind; only the change count moves.
