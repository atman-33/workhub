---
name: project-start
description: Load a vault project's context - read its README first, follow the reading order only as far as the request needs, resolve its repositories, and summarize goal, status, where the source lives and what is in flight. Use when the user says to work on a project by slug or name, or asks what a project is about.
argument-hint: "<project-slug>"
---

# project-start — Load a vault project's context

`task-start` loads the context of one task. This is its project-level
counterpart: the first move of a session whose subject is a project rather
than a single task.

It is **read-only**. It changes no task status, writes no notes, and creates
no files. Its whole output is a summary in the chat.

## Steps

1. **Resolve the project.** The argument is a project slug
   (`projects/<slug>/`) or part of a project's title.

   - No argument, or nothing matches: list the folders under
     `<vault>/projects/` (skipping names that start with `_` or `.`) with the
     `title` from each `README.md`, and ask which one. Do not guess.
   - Several match: ask. A wrong project read in full is a wasted context
     window.

   Vault resolution follows `task-start`: `WORKHUB_VAULT` → the current
   directory when it is a vault (has `tasks/` and `_ai/`) → `vault_path` in
   `%APPDATA%\workhub\config.json`.

   A project that is finished or parked lives under
   `<vault>/archive/projects/<slug>/` instead. Read it from there and say
   that it is archived.

2. **Read `README.md` first.** It is the documented entry point: current
   status, what lives where, and the reading order. Everything below is
   steered by it.

3. **Follow the reading order only as far as the request needs.** The point
   of the reading order is that a project is *not* read in full. Take the
   files the README points at that bear on what the user actually asked for:

   - product intent and scope → `prd.md`
   - dates and milestones → `roadmap.md`
   - design decisions and architecture → `dev-notes/`
   - a named feature → the matching file in `specs/`
   - candidate work, not yet executable → `backlog/`
   - repos, environments, dashboards → `links.md`

   Say which of these you read and which you skipped, so the user can send
   you back for more.

4. **Resolve the project's repositories** from `repos:` in
   `projects/<slug>/_index.md`. Each entry is an absolute path or a
   repository name as registered in the app
   (`.claude/project-context.json`); resolve a name through that file. The
   **first entry is the project's default repository**. When the key is
   absent or empty, say the project has no repository linked — that is a
   normal state for a research or planning project, not a fault to repair.

   Never guess a repository path from the slug: a project folder and its
   repositories do not share a naming scheme.

5. **Find the work in flight.** Read `<vault>/_ai/index/tasks.json` (fall
   back to the frontmatter of `<vault>/tasks/*.md` if it is missing) and
   collect the tasks whose `project:` is this slug and whose `status` is not
   `done`. Note any that are `blocked`.

6. **Report.** One summary, in this order:

   - **Goal** — what the project is for, in a sentence or two.
   - **Status** — the README's stated status, plus how stale it looks
     (when the README's own dates disagree with what the notes say, report
     the disagreement rather than picking one).
   - **Source** — the linked repositories, default first; say which entries
     do not resolve to a registered repository.
   - **In flight** — open tasks by status, with the blocked ones called out.
   - **Read / skipped** — the files you actually opened, and what you left.

## Notes

- Do not run `/kb-index`, fix layout findings, or tidy the folder. Reporting
  a gap is in scope; repairing one is a separate, explicit request.
- The project's `## Memo`-style hand-written prose is the owner's. Quote it,
  never rewrite it.
