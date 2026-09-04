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
  - external links (repos, environments, dashboards, references) → `links.md`
    — never credentials or tokens; link to the console instead
- **The project root is a closed set.** Only `README.md`, `prd.md`,
  `roadmap.md`, `links.md` and `_index.md` live directly under
  `projects/<slug>/`. Everything else goes in a subfolder — never drop a new
  note at the root.
- **No standard home fits? Create a subfolder.** The layout above is written
  for development projects; an operational one may hold correspondence,
  applications, statements. Make a folder for that kind of document (English
  kebab-case), then register it in `README.md`'s *Where things live* table and
  in `_index.md`. A new folder is cheap; a root full of loose notes is not.
- **Backlog ≠ tasks.** `backlog/` is the idea pool; `tasks/` (vault root) is
  the app's executable task list. Promote a `ready` item into a real task via
  the app, then set `status: promoted` / `promoted: T-XXXX` on the item.
- **`B-NNN` is an id, not an order.** Ordering/status come from frontmatter,
  rendered by `backlog/_backlog.base`. Never renumber to reorder.
- **Don't clobber human prose.** Append or create-and-link; keep `_index.md`
  current via `/kb-index`.
