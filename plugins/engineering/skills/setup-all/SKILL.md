---
name: setup-all
description: Run all project setup steps in sequence — set up OpenSpec, scaffold project-context.json, and set up rules-ex infrastructure.
disable-model-invocation: true
allowed-tools: Bash(node --version) Bash(npm list *) Bash(npm install *) Bash(openspec *) Read Write Skill
---

Run all project setup steps in sequence. Each phase is independent — a failure in one phase is reported and the next phase continues.

Phases 2 and 3 scaffold files that only the `workhub` plugin's harness hooks
read (`inject-project-context`, `inject-extended-rules`), so the skills that own
those templates live in that plugin. This skill delegates to them rather than
carrying its own copies — one template, one owner.

---

## Phase 1 — Set up OpenSpec

1. Run `node --version`. If Node.js is missing or older than 20.19.0, report the version and skip to Phase 2 with a note.
2. Check whether OpenSpec CLI is already installed globally:
   ```bash
   npm list -g @fission-ai/openspec --depth=0
   ```
   If not installed, install it:
   ```bash
   npm install -g @fission-ai/openspec@latest
   ```
3. Run:
   ```bash
   openspec init --tools claude
   ```

---

## Phase 2 — Scaffold project-context.json

4. Invoke the `workhub:setup-project-context` skill and let it do the work.
   - If the skill is unavailable (the `workhub` plugin is not installed), skip
     this phase and report that `.claude/project-context.json` was not
     scaffolded, naming the plugin the user has to enable.

---

## Phase 3 — Scaffold rules-ex infrastructure

5. Invoke the `workhub:setup-rules-ex` skill and let it do the work.
   - If the skill is unavailable (the `workhub` plugin is not installed), skip
     this phase and report that `.claude/rules/rules-ex-authoring.md` and
     `.claude/rules-ex/README.md` were not scaffolded, naming the plugin the
     user has to enable.

---

## Output Format

After all three phases complete, print a summary table:

| Phase | Status | Notes |
|-------|--------|-------|
| 1 — OpenSpec | ✓ / ✗ | skipped / installed / already installed |
| 2 — project-context.json | ✓ / ✗ / skipped | created / already existed / `workhub` not installed |
| 3 — rules-ex infrastructure | ✓ / ✗ / skipped | created / already existed (per file) / `workhub` not installed |

Then remind the user:
- Edit the placeholder paths in `.claude/project-context.json` before starting a new session.
- Changes to `project-context.json` take effect on the next session start (not `/reload-plugins`).
- Use absolute paths matching your environment (Windows: `C:/repos/...`, WSL: `/mnt/c/repos/...`).
- Add cross-cutting rules as `*.md` files under `.claude/rules-ex/` — each must have a `paths:` front matter.
