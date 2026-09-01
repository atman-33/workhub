---
name: create-claude-md
description: Generate or refine a concise, effective CLAUDE.md for the current project following official best-practice guidelines. Use when the user wants to create, write, or update a project's CLAUDE.md.
allowed-tools: Read Write Glob Bash(ls *) Bash(cat *) Bash(git log *) Bash(git remote *)
---

Analyze the current project and write an effective `CLAUDE.md` — either creating one from scratch or refining an existing one — following official Claude Code guidelines and the principle that shorter is better.

## Steps

1. **Check for existing CLAUDE.md** at the project root. If one exists, read it first.

2. **Inspect project files** to detect build system, test runner, lint/format setup, and conventions:
   - `package.json`, `pyproject.toml`, `Cargo.toml`, `Makefile`, `*.sln`, `go.mod`
   - `.eslintrc*`, `.prettierrc*`, `biome.json`, `ruff.toml`
   - `README.md`, `docs/` directory, `.github/` for PR/branch conventions
   - `git log --oneline -10` to detect commit message conventions
   - `git remote -v` to identify the repository

3. **Apply the placement decision** for each rule you find:
   - Project-wide rules → `CLAUDE.md`
   - Domain-specific or file-type-specific rules (e.g., "React component rules", "SQL migration rules") → `.claude/rules/<domain>.md` with `paths:` frontmatter
   - Automated/enforcement behaviors (auto-format on save, lint fixing) → do NOT put in CLAUDE.md; note them as candidates for `settings.json` PostToolUse hooks

4. **Apply the include/exclude filter** before writing each line:

   ✅ Include:
   - Bash commands Claude cannot guess (build, test, deploy, migrate, seed)
   - Code style rules that differ from language/framework defaults
   - Testing instructions and preferred test runners
   - Branch naming, PR conventions, commit message format
   - Required env vars or non-obvious setup steps
   - Common gotchas or non-obvious behaviors
   - Critical invariants (wrap in `<important>` tags)

   ❌ Exclude:
   - Anything Claude can infer by reading the code
   - Standard language conventions Claude already knows
   - Detailed API documentation (link to docs instead)
   - File-by-file descriptions of the codebase
   - Self-evident practices like "write clean code"
   - Automated behaviors (formatting, linting) — suggest `settings.json` hooks instead

5. **Write `CLAUDE.md`** to the project root using this structure (omit empty sections):

   ```
   # <Project Name>
   <1-2 sentence description of what the project is>

   # Commands
   - install: <cmd>
   - dev: <cmd>
   - test: <cmd>
   - lint: <cmd>
   - build: <cmd>

   # Code Style
   <only rules that differ from defaults>

   # Workflow
   <branch naming, PR conventions, non-obvious steps>

   <important>
   <critical rules that must not be forgotten>
   </important>
   ```

   Keep the total file under 50 lines where possible. Never exceed 200 lines.

6. **Create `.claude/rules/<domain>.md` stubs** for any domain-specific rules identified. Each stub must include `paths:` frontmatter:

   ```markdown
   ---
   paths:
     - "src/components/**"
   ---
   # <Domain> Rules

   # TODO: add rules here
   ```

7. **Report** what was written, what was excluded and why, any `.claude/rules/` stubs created, and any behaviors suggested for `settings.json`.

## Output Format

After completing the task, output:

```
## CLAUDE.md written
Path: <path>
Lines: <count>

### Included
- <item>: <why included>

### Excluded
- <item>: <why excluded>

### Routed to .claude/rules/
- <file>: applies to <glob pattern>

### Suggested for settings.json
- <behavior>: use PostToolUse hook to automate
```
