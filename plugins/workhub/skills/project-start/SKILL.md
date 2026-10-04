---
name: project-start
description: Load a vault project's context - read its README first, follow the reading order only as far as the request needs, resolve its repositories, and summarize goal, status, where the source lives and what is in flight. Use when the user says to work on a project by slug or name, or asks what a project is about.
argument-hint: "<project-slug | alias>"
---

# project-start — Load a vault project's context

`task-start` loads the context of one task. This is its project-level
counterpart: the first move of a session whose subject is a project rather
than a single task.

It is **read-only** as far as the vault goes. It changes no task status,
writes no notes, and creates no files. Its output is a summary in the chat,
plus the session's own title (step 6).

## Steps

1. **Resolve the project.** The argument is a project slug
   (`projects/NNNN-<slug>/`), a project's `alias`, or part of a project's
   title. The folder is the slug behind a sort number, so find it with the glob
   `projects/*-<slug>/`.

   **Alias lookup.** When no folder matches as a slug, look for an `alias:`
   equal to the argument in the frontmatter of `projects/*/README.md` and
   `archive/projects/*/README.md` (e.g. `grep -l "^alias: sbr" ...`). The
   matching README's folder name minus its `NNNN-` prefix is the slug; use that
   slug from here on, including in `task-cli --project`, which matches the slug
   exactly and returns nothing for an alias. A slug match wins over an alias
   match. Say the resolution in your first message (`sbr` →
   `spiritual-blade-remake`). `task-orchestrate` resolves its argument the same
   way.

   - No argument, or nothing matches: list the folders under
     `<vault>/projects/` (skipping names that start with `_` or `.`) with the
     `title` from each `README.md`, and ask which one. Do not guess.
   - Several match (two projects sharing an alias, or a slug and a title): ask. A wrong project read in full is a wasted context
     window.

   Vault resolution follows `task-start`: `WORKHUB_VAULT` → the current
   directory when it is a vault (has `tasks/` and `_ai/`) → `vault_path` in
   `%APPDATA%\workhub\config.json`.

   A project that is finished or parked lives under
   `<vault>/archive/projects/NNNN-<slug>/` instead. Read it from there and say
   that it is archived.

2. **Read `README.md` first.** It is the documented entry point: current
   status, what lives where, and the reading order. Everything below is
   steered by it.

3. **Follow the reading order only as far as the request needs.** The point
   of the reading order is that a project is *not* read in full. Take the
   files the README points at that bear on what the user actually asked for:

   - product intent and scope → `prd.md`
   - dates and milestones → `roadmap.md`
   - cross-cutting design and architecture → `dev-notes/`
   - a named feature, bug or case → its item in `backlog/`. Read the entry
     note first — its `## Status` says where the item stands and which of the
     numbered notes beside it is current — and only then the notes it points at
   - what is queued but not started → the rest of `backlog/`, entry notes only
   - repos, environments, dashboards → `links.md`

   Say which of these you read and which you skipped, so the user can send
   you back for more.

4. **Resolve the project's repositories** from `repos:` in
   `projects/NNNN-<slug>/_index.md`. Each entry is an absolute path or a
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

6. **Name the session.** The project is now settled, so apply the vault
   `CLAUDE.md` *Session names* form for a session with no task:
   `[<label>] <title>`, where `<label>` is the `alias` in the README
   frontmatter (the slug when there is none) and `<title>` is a few words on
   what this session is for, cut at 40 characters. Do it only when the
   session's current title does not already follow the form. On Claude
   Desktop `set_session_title` is a deferred tool: load it first, as
   `task-start` step 2 (*Name the session*) describes. Where no such tool
   exists (OpenCode, a bare terminal), skip it.
   When the session is working a task, `task-start` has already named it:
   leave it. Naming is the one write this skill makes, and it touches the
   session, not the vault.

7. **Report.** One summary, in this order:

   - **Goal** — what the project is for, in a sentence or two.
   - **Alias** — the README's `alias`, or "none (slug is used)".
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
