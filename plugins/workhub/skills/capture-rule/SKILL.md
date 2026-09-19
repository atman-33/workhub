---
name: capture-rule
description: Capture a reusable, non-obvious project insight into the rules home where it will auto-inject in future sessions. Use when investigation or implementation surfaces knowledge worth persisting (a gotcha, a convention, the "why" behind a decision), or when the user asks to remember a project learning.
argument-hint: The insight to capture, and which repository it applies to.
---

# Capture Rule

Route durable knowledge to the home where it will auto-inject when next relevant.

## Step 1 — Qualify the insight

Capture only knowledge that is **reusable** and **non-obvious from code, git
history, or existing instruction files**: gotchas, build/tooling quirks, design
invariants, conventions, the "why" behind a decision.

Skip (and tell the user why) if it is: a one-off fact for this task only, already
documented in the repo, or plainly derivable by reading the code. If it does not
qualify, stop here.

Establish the **target repository** the insight is about. If unclear, infer from
the files touched this session and confirm with the user.

## Step 2 — Route to a home

Pick exactly one:

The question is **when the insight has to reach a session**, not what it is
about. There are three answers, and they are exhaustive:

| It has to arrive… | Home |
|---|---|
| when a matching **file is touched** — a constraint about particular code | that repo's `.claude/rules/<slug>.md` |
| the same, but the rule cannot live in that repo | harness `.claude/rules-ex/<slug>.md` |
| when the **question** makes it relevant — everything else durable | the vault's `memory/notes/`, as a typed note |

A rule fires on a path and costs nothing until that path is opened; a memory
note is found by searching and costs nothing until someone looks. Anything
that does not need to arrive *while a specific file is open* belongs in memory,
where it is typed, searchable, in git and checked by `memory-doctor`.

If the home is `memory/notes/`, do **not** write a rule file. Write the note
(`cli.mjs new lesson "…"` from the `memory` plugin), or tell the user that is
where it belongs and stop.

Auto-memory is deliberately not on this list. It is per-project, local,
invisible and outside git — `memory/notes/` does the same job better on every
axis, and keeping both would mean choosing between them every time, which is a
routing decision with no rule behind it.

Knowledge about the harness's own machinery is a memory note too, unless it has
to fire on a path — the vault's `.claude/rules/vault-harness-local.md` is the
home for the ones that do. Never write to `vault-harness.md` beside it: that
file is app-managed, so an edit turns into a conflict on the next template
update and ends up in a `.bak` nobody reads.

## Step 3 — Dedup

Search the chosen home for an existing rule or note on the same topic. If one
exists, **update it** instead of creating a second. One topic = one file.

## Step 4 — Write the rule

Use a kebab-case slug. The body below the frontmatter is exactly what gets
injected — keep it focused and imperative.

**`.claude/rules` (native, lives in the repo it governs):**
- `paths:` is **optional**. Omit it to inject on every file touched in that repo;
  add repo-relative globs to scope it. Matching is permissive (an implicit leading
  `**/` is tried), so `src/**` also matches nested paths.

```markdown
---
paths:
  - "src/**/*.ts"
---
<the insight, imperative and focused>
```

**`.claude/rules-ex` (extended rules, lives in the harness workspace):**
- `paths:` is **required** (a rule without it is skipped). Two glob forms:
  **project-name globs (preferred)** — start with the NAME of a project
  registered in `.claude/project-context.json` (`<project-name>/src/**`); the
  rest matches the file's path relative to that project's root, independent of
  machine layout. **Cwd-relative globs** — walk up with `..` from the workspace
  root to reach the repo (`../<repo>/**` for sibling repos, or e.g.
  `../../repos/<repo>/**` from an Obsidian vault under `C:/obsidian/`); use for
  repos not registered in project-context.json. Matching is **strict and
  root-anchored** (no implicit `**/`); use `**` for any depth. `*` also works
  as the project/repo-name segment itself, for an insight that applies to
  *any* repo rather than one specific one.

```markdown
---
paths:
  - <project-name>/plugins/**/*.mjs
---
<the cross-cutting insight>
```

Cross-repo example (applies to every registered project, not just one):

```markdown
---
paths:
  - */.github/workflows/**
---
<an insight that applies to any repo's GitHub Actions workflows>
```

If the harness has `.claude/rules/rules-ex-authoring.md` or an internals notes
file (`harness-internals.md` / `vault-harness.md`), consult them for the full
extended-rules mechanics before writing there.

## Step 5 — Wrap up

Report the file path written or updated. Suggest committing it (Conventional
Commits: `docs:` or `chore:`). No plugin version bump is involved — rules and
memory are content, not plugin code.
