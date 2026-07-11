---
paths:
  - ".claude/rules-ex/**"
---

# Authoring `.claude/rules-ex/*.md` (extended rules)

You are editing a file under `.claude/rules-ex/`. These are **extended rules**
— a custom mechanism, **not** a native Claude Code feature. They only take
effect via the `engineering@workhub-marketplace` plugin's
`inject-extended-rules` hook (Claude Code) and its OpenCode mirror plugin.
Contrast with `.claude/rules` (native, governs files under the vault itself).

Follow this format when creating or editing a rule here:

- **`paths:` is REQUIRED.** A rule with no `paths:` front matter is skipped
  (a cross-cutting rule must declare its scope, or it would fire on every
  file). The folder's `README.md` has no `paths:` precisely so it is ignored.
- **Prefer project-name globs.** Start the glob with the NAME of a project
  registered in `.claude/project-context.json` (e.g. `workhub/src/**`); the
  rest matches the file's path relative to that project's root. This stays
  valid regardless of where repositories live on each machine.
- **Cwd-relative globs also work** (cwd = this vault's root). Walk up as far
  as needed — with the default layout, `../../repos/<repo>/src/**` reaches
  `C:/repos/<repo>/src/**` from a vault under `C:/obsidian/`. Use for repos
  not registered in project-context.json.
- **Matching is strict and root-anchored** — full match, no implicit leading
  `**/` prefix. Use `**` for any depth; `*` matches a single path segment
  (including the project-name segment, for rules that apply to any project);
  `?` a single character.
- **Body = the injected rule.** Everything below the front matter is what
  gets injected into context (wrapped in `<extended-rules>`), once per rule
  per agent context per session. Keep it focused and imperative.

```markdown
---
paths:
  - <project-name>/plugins/**/*.mjs
---
In <project-name> .mjs hook scripts: zero dependencies, Node built-ins only.
```
