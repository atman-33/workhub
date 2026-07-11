---
name: setup-all
description: Run all engineering plugin setup steps in sequence — install recommended skills, set up OpenSpec, scaffold project-context.json, and set up rules-ex infrastructure.
disable-model-invocation: true
allowed-tools: Bash(gh skill install *) Bash(gh auth status) Bash(node --version) Bash(npm list *) Bash(npm install *) Bash(openspec *) Read Write
---

Run all engineering plugin setup steps in sequence. Each phase is independent — a failure in one phase is reported and the next phase continues.

---

## Phase 1 — Install recommended skills

1. Run `gh auth status`. If it fails, report the error and skip to Phase 2 with a note that skill installation was skipped.
2. Install the following skills in order. On failure, print the full error, continue, and record the failure:

```bash
gh skill install mattpocock/skills engineering/improve-codebase-architecture --agent claude-code
gh skill install mattpocock/skills engineering/tdd --agent claude-code
gh skill install mattpocock/skills engineering/to-issues --agent claude-code
gh skill install mattpocock/skills engineering/to-prd --agent claude-code
gh skill install mattpocock/skills engineering/codebase-design --agent claude-code
gh skill install mattpocock/skills engineering/grill-with-docs --agent claude-code
```

---

## Phase 2 — Set up OpenSpec

3. Run `node --version`. If Node.js is missing or older than 20.19.0, report the version and skip to Phase 3 with a note.
4. Check whether OpenSpec CLI is already installed globally:
   ```bash
   npm list -g @fission-ai/openspec --depth=0
   ```
   If not installed, install it:
   ```bash
   npm install -g @fission-ai/openspec@latest
   ```
5. Run:
   ```bash
   openspec init --tools claude
   ```

---

## Phase 3 — Scaffold project-context.json

6. Read `.claude/project-context.json` in the current project root.
   - If it already exists: show its current contents and note that it was left unchanged.
   - If it does not exist: create it with the following template (placeholder paths must be replaced by the user):
     ```json
     {
       "roleBasedDelegation": true,
       "openspecPath": "<absolute path to the openspec docs folder>",
       "projects": [
         {
           "name": "example-project",
           "path": "<absolute path to a frequently-used project>",
           "summary": "short one-line description (optional)"
         }
       ]
     }
     ```

---

## Phase 4 — Scaffold rules-ex infrastructure

7. Read `.claude/rules/rules-ex-authoring.md`.
   - If it already exists: show its path and note it was left unchanged.
   - If it does not exist: read `skills/setup-rules-ex/assets/templates/rules-ex-authoring.md`
     (relative to this plugin's root; the canonical template, shared with the
     `setup-rules-ex` skill) and write its exact contents to
     `.claude/rules/rules-ex-authoring.md`.

8. Read `.claude/rules-ex/README.md`.
   - If it already exists: show its path and note it was left unchanged.
   - If it does not exist: read `skills/setup-rules-ex/assets/templates/rules-ex-readme.md`
     (relative to this plugin's root) and write its exact contents to
     `.claude/rules-ex/README.md`.

---

## Output Format

After all four phases complete, print a summary table:

| Phase | Status | Notes |
|-------|--------|-------|
| 1 — Recommended skills | ✓ / ✗ | list any failed skills |
| 2 — OpenSpec | ✓ / ✗ | skipped / installed / already installed |
| 3 — project-context.json | ✓ / ✗ | created / already existed |
| 4 — rules-ex infrastructure | ✓ / ✗ | created / already existed (per file) |

Then remind the user:
- Edit the placeholder paths in `.claude/project-context.json` before starting a new session.
- Changes to `project-context.json` take effect on the next session start (not `/reload-plugins`).
- Use absolute paths matching your environment (Windows: `C:/repos/...`, WSL: `/mnt/c/repos/...`).
- Add cross-cutting rules as `*.md` files under `.claude/rules-ex/` — each must have a `paths:` front matter.
