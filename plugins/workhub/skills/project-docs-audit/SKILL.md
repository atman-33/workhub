---
name: project-docs-audit
description: Audit where one vault project keeps its documents, report findings as numbered candidates, and move or fix only the ones the owner picks. Finds misplaced design notes, missing area indexes, stale drafts, bloated README tables, overlapping notes, broken links and areas scattered across folders. Use when a project's notes feel scattered, before migrating a project to design/, or when the owner asks to tidy a project's documents.
argument-hint: "<project-slug>"
---

# Project Docs Audit

Sort out where one project keeps its documents. It works in three phases, in
the manner of an architecture review: **survey** (read-only), **report**
(numbered candidates, nothing changed), **fix** (only the candidates the owner
picks).

## How this differs from `kb-lint`

`kb-lint` is a vault-wide health check: index drift, orphans, tags,
frontmatter, stale files, decision-policy size. It asks "is this file
well-formed and linked?". This skill asks "is this document in the right
place, and can a reader find it?" for **one project**. It is a different
question, so it is a separate skill rather than a `kb-lint` mode.

Shared ground is only broken links and `_index.md` drift. Check those two
within the project, and point at `/kb-lint` for vault-wide results instead of
repeating its other checks (tags, frontmatter, inbox pileup, decision policy).

## Ground rules

- **The survey is read-only.** Phases 1 and 2 write nothing.
- **Fix only what the owner picked.** Moves, link updates and appended
  indexes, nothing else.
- **Never delete or rewrite human prose.** Allowed: move a file, append, add
  frontmatter, create an index, update links that pointed at a moved file.
  Merging two overlapping notes is a proposal for the owner, never an edit.
- **Do not touch** `journal/`, `tasks/` (except the path rewrite described in
  Phase 3), `_ai/`, or the inside of `backlog/B-NNN-*/` item folders (their
  layout is owned by the backlog rule). Notes inside an item are only
  candidates for *promotion* to `design/`, and only when they describe the
  whole project.
- **Read the rules first**: `.claude/rules/projects.md` (layout and, where
  present, the *Design notes* decision table) and `.claude/rules/backlog.md`.
  If the vault's rules have no `design/` yet, say so: the vault is on an older
  template, and `design/` candidates are marked "pending template update".

## Phase 1 — Survey

1. Resolve the project: `projects/*-<slug>/` (or `archive/projects/*-<slug>/`).
   With no argument, list the projects and ask which one.
2. Read `README.md` and `prd.md` and decide the **kind of project**: app,
   game, office/operational work, research, or other. State the kind and the
   evidence in the report. Do not assume games: the lenses are chosen per kind
   (see *Lenses by kind*).
3. List every note under the project folder, plus non-Markdown files. Read
   frontmatter (`title`, `type`, `status`, `created`, `updated`) and the first
   lines of each note; read a whole note only when classifying needs it.
4. Classify each note into one home with the table below.

### Where a note belongs

| Kind of content | Home |
|---|---|
| What the project builds and how it behaves, project-wide, outliving one item | `design/`, by area subfolder, the area `README.md` being its table of contents |
| A design still under discussion | `design/`, frontmatter `status: draft` (never a `drafts/` folder) |
| Reference material from other projects, pasted images or links | `design/references/` |
| Spec, research or output of one unit of work | that item's `backlog/B-NNN-*/` |
| How the project is developed: environment, debugging steps, conventions, code structure | `dev-notes/` |
| Terms | `glossary.md` (root) |
| Product intent / schedule / links | `prd.md` / `roadmap.md` / `links.md` |
| Diagrams, schedules, mindmaps, shared-space notes | `diagrams/`, `schedules/`, `mindmaps/`, `shared/` |
| Operational documents of an office-style project (correspondence, applications, statements) | a project-specific subfolder registered in the README table |

A note mixing design and procedure is a **split** candidate: propose which
part goes where; never cut it unless the owner picked it. Material meant to
brief an external AI is design if it carries design, `dev-notes/` if it
carries procedure: decide by content.

## Phase 2 — Report

Write the report, numbered, most valuable first (most reading cost saved).
Print it in chat; save it to `_ai/logs/project-docs-audit-<slug>-<date>.md`
only if the owner asks. Never write it into the project folder.

Open with: project, kind (with evidence), file counts per folder, and one line
each for what was clean or skipped. Each candidate has this shape:

```
### N. <short title>  [<category>]
- Evidence: <paths, counts, dates, quoted frontmatter>
- Why it matters: <what a reader or agent gets wrong today>
- Proposed fix: <exact moves / appends / links>
- Risk: <links that break, who else points here>
- Size: <number of files touched>
```

Close with "which numbers shall I fix?" and say what you did not check.

### Categories

| Category | Look for |
|---|---|
| `misplaced` | Design material in `dev-notes/`; design and procedure mixed in one note; a project-wide note stuck inside one backlog item; an item-specific note sitting in `design/` or `dev-notes/` |
| `no-area-index` | An area (a folder, or several notes about one subject) with no `README.md` or list-style note, or one whose list no longer matches the files |
| `stale-draft` | `status: draft` not updated for about 30 days and not linked from a recent task or item. Suggest: confirm to `accepted`, move to the item it belongs to, or ask the owner whether to drop it. Never decide this yourself |
| `bloated-readme-table` | A *Where things live* cell with about ten or more links, or a row that lists notes instead of naming a folder. Fix: point at the area README |
| `overlap` | Two or more notes covering one subject (same title stem, same headings, copied passages). Propose the canonical one and links from the others; merging is the owner's call |
| `broken-link` | `[[wikilinks]]` and relative paths whose target is missing, within the project, including `README.md` and `_index.md` |
| `index-drift` | `_index.md` or the README table lists files that do not exist, or misses ones that do |
| `scattered-area` | One subject spread over several top-level folders (for example `story/`, `enemies/`, `maps/` plus notes in `dev-notes/`). Fix: gather under `design/<area>/` with one area README |
| `unregistered-folder` | A project subfolder that is neither standard nor registered in the README table |
| `root-clutter` | Notes at the project root outside the closed set (`README.md`, `prd.md`, `roadmap.md`, `links.md`, `glossary.md`, `_index.md`) |

### Lenses by kind

Pick from the kind read in Phase 1 and say which you applied.

- **app**: screens, API and data specs are design; build, test and deploy
  notes are `dev-notes/`.
- **game**: systems, enemies, maps and story are design areas, often
  scattered; `scattered-area` is the category with the most yield.
- **office / operational**: business flows and operating rules are design;
  correspondence and applications are their own registered folders, not
  design. Expect few `dev-notes/`; do not invent them.
- **other**: apply the generic categories only and say the kind is unclear.

Skip a category that cannot apply and say so in one line.

## Phase 3 — Fix (only picked candidates)

1. Wait for the owner's pick. "All" means all numbered candidates, never ones
   you add later.
2. Before moving anything, check `git status` for uncommitted edits in the
   project folder and say so if there are any. Do not use `git stash` in the
   vault (it collides with the auto-backup). Prefer `git mv`.
3. For each picked candidate, in order:
   - Move or create what the proposal said. Folder names are kebab-case in any
     script, with no leading `_`, `.` or `NNNN-`.
   - Add `status: draft | accepted` to a moved design note that lacks it only
     when the owner confirmed the status; otherwise leave it out and list it as
     open.
   - Find every reference to the old path (`[[name]]`, relative links,
     `README.md`, `_index.md`, backlog item `## Status` / `## Notes`, and task
     `## Results`) and update it. In `tasks/` change the path text only.
   - Create or update the area `README.md` as a table of contents; append
     entries, do not rewrite human text.
   - Update the project README's *Where things live* table and, if present,
     `_index.md` (`/kb-index` repairs it).
4. Re-check links in the touched files. Report what moved, which links were
   rewritten, and what remains open.
5. Append to `_ai/logs/kb-log.md`:
   `[date] project-docs-audit | <slug> | candidates N | fixed N`.
6. Do not commit unless the owner asked.

## Re-running

The audit is meant to be repeated. A second run on a tidy project should say
"nothing to fix" in a few lines, and say what is new since a saved earlier
report if one exists.
