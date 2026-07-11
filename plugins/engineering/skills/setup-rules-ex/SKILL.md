---
name: setup-rules-ex
description: Scaffold the rules-ex extended-rules infrastructure (.claude/rules/rules-ex-authoring.md and .claude/rules-ex/README.md) required by the engineering plugin's inject-extended-rules hook.
disable-model-invocation: true
allowed-tools: Read Write
---

Scaffold the two files that enable the `rules-ex` extended-rules system for this
project. Both files are templates — they will not be overwritten if they already
exist. The canonical template content lives in this skill's `assets/templates/`
folder (also used by the `setup-all` skill's Phase 4 — treat it as the single
source of truth and edit it there, not inline in either SKILL.md).

**What gets created:**

- `.claude/rules/rules-ex-authoring.md` — a native path-scoped rule that
  auto-injects an authoring guide whenever you Read/Edit a file under
  `.claude/rules-ex/`. Required so the guide fires for the *current* repo
  (native `.claude/rules` files only govern the repo they live in).
- `.claude/rules-ex/README.md` — explains what the `rules-ex` folder is and how
  to author rules in it. Has no `paths:` front matter intentionally, so the hook
  ignores it.

---

## Steps

1. Read `.claude/rules/rules-ex-authoring.md`.
   - If it already exists, display its path and current contents, then note it
     was left unchanged.
   - If it does not exist, read `assets/templates/rules-ex-authoring.md` (in this
     skill's folder) and write its exact contents to `.claude/rules/rules-ex-authoring.md`.

2. Read `.claude/rules-ex/README.md`.
   - If it already exists, display its path and current contents, then note it
     was left unchanged.
   - If it does not exist, read `assets/templates/rules-ex-readme.md` (in this
     skill's folder) and write its exact contents to `.claude/rules-ex/README.md`.

---

## Output Format

Print a summary table after completing both steps:

| File | Status |
|------|--------|
| `.claude/rules/rules-ex-authoring.md` | created / already existed |
| `.claude/rules-ex/README.md` | created / already existed |

Then remind the user:
- Add your own cross-cutting rules as `*.md` files under `.claude/rules-ex/`.
  Each file must have a `paths:` front matter (workspace-relative globs) — see
  the authoring guide that auto-injects when you edit files there.
- The `inject-extended-rules` hook fires on Read/Edit/Write; rules take effect
  immediately in the current session without a restart.
