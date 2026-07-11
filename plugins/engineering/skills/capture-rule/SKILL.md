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

| Insight is about… | Home |
|---|---|
| A specific repo's own code/tooling | that repo's `.claude/rules/<slug>.md` |
| Target-repo files, but the rule must live in the harness workspace | harness `.claude/rules-ex/<slug>.md` |
| The harness's own machinery | harness `.claude/rules/<slug>.md` (often grow the internals notes file, e.g. `harness-internals.md` or `vault-harness.md`) |
| Personal/cross-project preference, feedback, or machine-local fact | auto-memory (`MEMORY.md` + `memory/`) |

If the home is auto-memory, do **not** write a rule — tell the user it belongs in
memory and stop.

## Step 3 — Dedup

Search the chosen directory for an existing rule on the same topic. If one exists,
**update it** instead of creating a new file. One topic = one file.

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
