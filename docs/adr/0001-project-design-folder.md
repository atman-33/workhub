# 0001. Introduce an optional `design/` folder as a standard project home

Date: 2026-11-11
Status: Accepted

## Context

A vault project (`projects/NNNN-<slug>/`) has no standard home for its design:
what the project builds and how it behaves, as a master that spans backlog
items. In `ff15-reimagined` the design material ended up scattered across
`dev-notes/` (19 notes), `story/`, `enemies/` and `maps/`. `dev-notes/` mixed
five different things: design, drafts still under discussion, material meant
to brief an external AI, reference material copied from other projects, and
how-we-work notes.

The cause is a gap in the rules. `vault-template/.claude/rules/projects.md`
defines `dev-notes/` as "architecture, environment, conventions" and never says
where design lives, while "No standard home fits? Create a subfolder" lets each
project invent its own folder. The vault's `CLAUDE.md` also says to put "design
decisions" in `dev-notes/`.

Vault projects are not only games: apps and office-style work exist too, so the
definition has to read sensibly for all of them (app: screens, API and data
specs; game: systems, enemies, maps, story; office work: business flows and
operating rules).

Earlier, `specs/`, `research/` and `deliverables/` were removed (T-0253,
T-0266) because a spec, its research and the output of the tasks that worked on
it belong to one unit of work and live in that unit's `backlog/` item. Any new
folder must not reintroduce that split.

## Decision

1. Add `design/` as a standard project folder. It is optional, like
   `diagrams/`: created with the first design note, not scaffolded.
2. `design/` holds the project-wide master of what the project builds and how
   it behaves, plus material still under discussion. It is read per kind of
   project (see the table in the rule text).
3. Scope against `backlog/`: a spec for a single unit of work stays in that
   item's `backlog/B-NNN-*/`. `design/` is for what outlives any one item and
   applies to the project as a whole. A note that starts in an item and turns
   out to be project-wide is promoted to `design/`.
4. `dev-notes/` is narrowed to how the project is developed: environment
   setup, debugging steps, conventions, code structure.
5. Work in progress is told apart by frontmatter `status: draft | accepted`,
   not by a `drafts/` folder, so confirming a design does not move the file
   and does not break path links.
6. Organise by area in subfolders (for example `design/battle/`). Each area
   has a `README.md` that serves as its table of contents.
7. Reference material from other projects and images or links the owner pastes
   go in `design/references/`.
8. App support: add `design` to `KNOWN_DIRS` in `src-tauri/src/vault_project.rs`
   but not to `EXPECTED_DIRS`, so a project without it raises no finding.
   Unknown folders were already only an `info`-level `unknown-folder` finding,
   so nothing breaks for projects that already use the folder.

## Alternatives considered

- **Bring back `specs/`.** Rejected: that is the structure T-0253 removed. A
  per-unit spec belongs to its backlog item; a second spec folder reopens the
  question "is this an item or a spec?". `design/` is defined by scope
  (project-wide master), not by document type.
- **A `drafts/` folder (or `design/drafts/`).** Rejected: confirming a design
  would move the file and break every path link to it. Frontmatter `status`
  carries the same information without moving anything and can be filtered.
- **Keep everything in `dev-notes/`.** Rejected: that is the current state, and
  it is what produced the 19-note mix. Folder names should tell an agent what
  to read before touching the project's behavior versus its tooling.
- **Leave it to "create a subfolder" per project.** Rejected: every project
  would name it differently, and the app, `project-start` and `kb-ingest`
  could not know where design lives.
- **Name it `docs/` or `specs/` generically.** Rejected: `docs/` says nothing
  about contents, and `specs/` is the retired name.

## Consequences

- Easier: an agent or the owner finds the project's design in one place, and
  `dev-notes/` returns to a small how-to-develop set. Confirming a draft is a
  one-line frontmatter edit.
- Harder: a note's home now depends on a judgement (project-wide master versus
  one unit of work versus how-to-develop). The rule text carries a decision
  table to settle it, and promotion from a backlog item is by move or link.
- Follow-ups (task T-1211): update `projects.md` and the project README
  template, `KNOWN_DIRS`, `PROJECT_DOC_DIRS` in `src/lib/project-documents.ts`
  so the Documents pane lists `design/`, the i18n strings, `demo-vault`, the
  `project-start` and `kb-ingest` skills, and the "design decisions →
  `dev-notes/`" line in `vault-template/CLAUDE.md`.
- Follow-ups (other tasks): a `project-docs-audit` skill to sort existing
  projects (T-1210), migrating `ff15-reimagined` (T-1212), and auditing this
  repository's own `dev-notes/` (T-1213).
