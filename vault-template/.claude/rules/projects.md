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
  - feature specs → `specs/<feature>.md` (one per feature)
  - ideas / candidate work → `backlog/B-NNN-<title>.md`
  - investigations → `research/` · design notes → `dev-notes/`
  - task outputs → `deliverables/` (link from the task's `## Results`)
- **Backlog ≠ tasks.** `backlog/` is the idea pool; `tasks/` (vault root) is
  the app's executable task list. Promote a `ready` item into a real task via
  the app, then set `status: promoted` / `promoted: T-XXXX` on the item.
- **`B-NNN` is an id, not an order.** Ordering/status come from frontmatter,
  rendered by `backlog/_backlog.base`. Never renumber to reorder.
- **Don't clobber human prose.** Append or create-and-link; keep `_index.md`
  current via `/kb-index`.
