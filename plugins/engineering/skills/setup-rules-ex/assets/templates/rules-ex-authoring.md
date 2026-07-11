---
paths:
  - ".claude/rules-ex/**"
---

# Authoring `.claude/rules-ex/*.md` (extended rules)

You are editing a file under `.claude/rules-ex/`. These are **extended rules** — a
custom mechanism, **not** a native Claude Code feature. They only take effect via
the `engineering@workhub-marketplace` plugin's `inject-extended-rules` hook (Claude
Code) and the OpenCode mirror `.opencode/plugins/inject-extended-rules-plugin.ts`.
Contrast with `.claude/rules` (native, governs this repo's own files).

Follow this format when creating or editing a rule here:

- **`paths:` is REQUIRED.** A rule with no `paths:` front matter is skipped (a
  cross-cutting rule must declare its scope, or it would fire on every file). The
  folder's `README.md` has no `paths:` precisely so it is ignored.
- **Prefer project-name globs.** Start the glob with the NAME of a project
  registered in `.claude/project-context.json` (e.g. `other-repo/src/**`); the
  rest matches the file's path relative to that project's root, independent of
  machine layout.
- **Cwd-relative globs also work (cwd = this workspace's root).** Walk up with
  `..` as far as needed to reach the target repo: `../other-repo/**` when repos
  are siblings, or e.g. `../../repos/other-repo/**` when the workspace is an
  Obsidian vault under `C:/obsidian/` with repos under `C:/repos/`. Use for
  repos not registered in project-context.json. A bare `src/**` would target
  this workspace itself.
- **Matching is strict and root-anchored** — full match from the workspace root, no
  implicit leading `**/` prefix. Use `**` for any depth: `../repo/**/*.ts`. `*`
  matches a single path segment; `?` a single character.
- **Body = the injected rule.** Everything below the front matter is what gets
  injected into context (wrapped in `<extended-rules>`), once per rule per agent
  context per session. Keep it focused and imperative.

```markdown
---
paths:
  - other-repo/plugins/**/*.mjs
---
In other-repo .mjs hook scripts: zero dependencies, Node built-ins only.
```
