---
paths:
  - "projects/**"
---

# Working inside a project folder

Full layout and rationale live in the vault `CLAUDE.md` ("Project layout").
This is the working checklist when touching `projects/<slug>/`.

- **Read `README.md` first.** It is the project entry point — current status,
  where things live, reading order. Don't scan the whole folder blind.
- **One folder per project** under `projects/<slug>/` (English kebab-case).
  New project = copy `templates/project/` and fill placeholders.
- **Put things in their home:**
  - product intent → `prd.md` · schedule → `roadmap.md`
  - anything belonging to one unit of work (a feature, a bug, a support case)
    → that item's `backlog/B-NNN-<title>[/]` — its spec, its research, and the
    output of every task it spawned (link from the task's `## Results`)
  - knowledge that serves the whole project → `dev-notes/`
  - external links (repos, environments, dashboards, references) → `links.md`
    — never credentials or tokens; link to the console instead
- **Backlog ≠ tasks.** `backlog/` holds units of work and everything they
  produce; `tasks/` (vault root) is the app's executable task list. A task
  points at its item with `backlog: B-NNN`; the item never lists its tasks.
- **A task with a project has an item.** No project = vault housekeeping, and
  its output goes to `_ai/logs/` or `knowledge/`. An empty `backlog` means
  "not chosen yet", never "no item needed" — settle it at `task-start` and
  write it back onto the task. Recurring tasks are the exception: a habit is
  not a unit of work.
- **Only start a new item when nothing existing overlaps.** Overlap at all and
  it goes on the existing item. A misfiled note is one move to undo; a
  duplicate item splits a subject and nobody can see that it happened. A
  project with no items yet is the one case where you just start one.
- **An item grows into a folder.** One note until it needs a second file, then
  a folder of the same name with the entry note's filename unchanged, so
  existing `[[B-NNN-…]]` links keep resolving. Child notes are `NNN-<title>.md`
  numbered in tens; a task's output is `NNN-T-XXXX-<title>.md`.
- **`## Status` says what is current, not the numbering.** Append a dated line
  to the entry note's `## Status` whenever the item moves. Number prefixes
  record creation order, which is not the same question.
- **`B-NNN` is an id, not an order.** Ordering/status come from frontmatter,
  rendered by `backlog/_backlog.base`. Never renumber to reorder.
- **Don't clobber human prose.** Append or create-and-link; keep `_index.md`
  current via `/kb-index`.
