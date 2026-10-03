---
paths:
  - "projects/**"
---

# Working inside a project folder

Layout and rationale for `projects/NNNN-<slug>/`. Read `README.md` first — it
states the current status and points to everything else, so there is no need to
scan the whole folder.

## Layout

Each development project gets one folder under `projects/NNNN-<project-slug>/`
(slug in English kebab-case). Create one from the app's **Projects** tab, which
assigns the number and fills in `templates/project/`'s placeholders.

| Path | Contents |
|---|---|
| `README.md` | Entry point — read first. Overview, current status, where things live, reading order, key links. Embeds the backlog Base. |
| `prd.md` | Product intent, scope, goals — the single source of product intent |
| `roadmap.md` | Milestones and schedule |
| `links.md` | Link collection — repos, environments, dashboards, design files, references. `README.md` keeps only the daily few and points here |
| `backlog/` | One note — or one folder — per unit of work: the candidate, the thinking behind it, and everything it produced. `_backlog.base` renders the items by status/priority |
| `dev-notes/` | Cross-cutting knowledge: architecture, environment, conventions. Nothing that belongs to a single backlog item |
| `schedules/` | Schedule notes (`<name>.md`), one per plan under consideration; read and written by the app's Schedule tab |
| `mindmaps/` | Mindmap notes (`<name>.md`), one per map; read and written by the app's Mindmap tab |
| `shared/` | Shared-space notes (`<name>.md`), one per team knowledge base that lives outside the vault — where it is and how it is organised |
| `attachments/` | Images and binaries for this project |
| `_index.md` | Machine-readable index, maintained by `/kb-index` |

- **The project root is a closed set.** Only `README.md`, `prd.md`,
  `roadmap.md`, `links.md` and `_index.md` live directly under the project
  folder; every other note goes in a subfolder.
- **No standard home fits? Create a subfolder.** The layout is written for
  development projects; an operational one may hold correspondence,
  applications, statements. Make a folder for that kind of document (English
  kebab-case), then register it in `README.md`'s *Where things live* table and
  in `_index.md`.
- **Put things in their home:** product intent → `prd.md`; schedule →
  `roadmap.md`; anything belonging to one unit of work → that item's
  `backlog/B-NNN-<title>/` (spec, research, and the output of every task it
  spawned, linked from the task's `## Results`); knowledge that serves the
  whole project → `dev-notes/`; external links → `links.md` (links to the
  console, never credentials or tokens).
- Folder names are English kebab-case; note file names may be Japanese.
- **Backlog ≠ tasks.** `backlog/` holds units of work and what they produce;
  `tasks/` (vault root) is the app's executable task list. Details are in the
  backlog rule.
- **Don't clobber human prose.** Append or create-and-link; keep `_index.md`
  current via `/kb-index`.

## README frontmatter

```yaml
title: Spiritual Blade Remake
type: project-readme
project: spiritual-blade-remake   # the slug; what every `project:` key uses
status: active                    # active | paused | done
alias: sbr                        # optional; short label for session names
```

`alias` is a short label that stands in for a long slug in session names
(`[sbr] T-0561 ...`, see the vault `CLAUDE.md` *Session names*). Only the
session name uses it: `project:` keys, folder names and links stay the slug.
Unset, the slug is used, so give one only to a slug too long to read in the
session list (leave `workhub` alone).

- Lowercase letters, digits and hyphens (kebab-case), 2 to 8 characters.
- Unique across `projects/` and `archive/projects/`. Check before assigning.
- Not Obsidian's `aliases:` list, which is about note-link resolution.

## The folder number and the slug

**The project folder carries a number; the slug does not.** A project folder
is `NNNN-<slug>` — four digits, a hyphen, the slug (`projects/0010-workhub/`).
The slug is everything after the first `NNNN-`, and it is the only thing the
rest of the vault uses: a task's `project: workhub`, a backlog item's
`project:`, the `project == "workhub"` filter in `_backlog.base`. To find a
project's folder from its slug, glob `projects/*-<slug>/` (or
`archive/projects/*-<slug>/`); never build the path as `projects/<slug>/`.

- The number exists so a file explorer that sorts by name — Obsidian's does —
  lists projects in an order the owner chose rather than alphabetically. It has
  no other meaning: no category, no priority.
- Numbers go in tens, like a backlog item's child notes, so a project can be
  slotted between two others without renaming either. The app gives a new
  project the next ten above the highest number in `projects/` and
  `archive/projects/`.
- Renumbering is a folder rename and nothing more. That is why the number is
  not part of the slug: `project:` appears in hundreds of task files, archived
  ones included, and none of them should change because a folder moved in a
  list. Only path-style links (`projects/0010-workhub/README.md`) follow the
  rename; wikilinks resolve by basename and do not care.
- Four digits, not three: the numbers are never reused, archived projects keep
  theirs, and three digits in tens run out at 99 projects.
- A folder with no number reads the same way — its slug is its whole name — so
  the rule has no second path. The app flags two folders that resolve to the
  same slug.
- `B-NNN` stays three digits. It is an identifier, not a sort order, so
  `B-1000` works as written; widening it would mean renaming ids that are
  promised never to change.

## Why the layout has two axes

The layout has two axes, not one. `backlog/` groups by **unit of work** — one
feature, one bug, one support case — keeping its spec, its research and its
task outputs in one place. Everything else groups by **kind**, because it
serves the project as a whole rather than any single item. Scattering one
piece of work across four kind-named folders is exactly what this replaces:
once an item holds all of it, a separate `specs/`, `research/` and
`deliverables/` have nothing left to hold.

`deliverables/` is worth a word, because dropping it looks like it costs
something. It does not: an item is a **folder** at its smallest, holding the
entry note — which is precisely what a deliverable note was, but carrying
`## What`, `## Why` and `## Status` as well. Keeping both folders bought nothing and left
a judgement call behind ("is this worth an item?") that has no good rule to
answer it. A rule you have to remember is a rule that stops working.

## `_index.md` keys

`_index.md` also carries an optional `repos:` key listing the registered
repositories this project belongs to — each entry an absolute path, or the
repository's name as it is registered in the app:

```yaml
repos:
  - C:/repos/workhub
  - C:/repos/workhub-vault
```

**The first entry is the project's default repository** — the one an agent
works in when the task does not say which. The link is stored rather than
inferred because a project folder and its repositories do not share a naming
scheme (the vault's `multi-agent-ff15` is the repository
`multi-agent-ff15-vscode`). The app's **Projects** tab reads and writes it,
including the order.

A project may legitimately span several repositories — an app and its vault,
or a frontend and a backend — which is why this is a list and not a single
key. The pre-T-0216 single `repo:` key is gone; it is not read as a fallback,
so a note that still carries it reads as having no repository at all.

`_index.md` carries two more optional keys, both written by the **Projects**
tab and both safe to edit by hand:

```yaml
pinned: true        # optional; absent = false. Held at the top of the list
order: 2            # optional; manual sort position within its group
```

`pinned` is how the owner says "this is what I am working on now": pinned
projects are listed above the rest. `order` is a manual position, and is a
number rather than an index on purpose — dropping a project between two
others gives it the value halfway between theirs, so one reordering rewrites
one note instead of renumbering every project in the vault. It is the same
mechanism as a task's `order`. A project with no `order` is listed after every
project that has one, alphabetically; archived projects sort last whatever
either key says.

The Projects tab can also list by **name** — the folder name, so by number —
which is the order Obsidian shows. `order` and the folder number are two
orders on purpose: `order` is the app's list, rearranged by dragging; the
number is the file explorer's, rearranged by renaming. Pinned projects stay
on top in both.

Both live in the vault rather than in the app's machine-local config, so a
second PC that clones the vault gets the pins and the order back. (The Repos
tab's star is machine-local instead, because a repository path is specific to
one machine.)

A project that is finished or parked moves to `archive/projects/NNNN-<slug>/`,
number and all —
under `archive/projects/`, not `archive/<slug>/`, so the folder's origin
survives the move. The **Projects** tab archives and restores it; a project
folder is never deleted, because it holds months of hand-written prose.
