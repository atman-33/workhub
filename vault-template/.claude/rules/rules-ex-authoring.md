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
- **Globs are cwd-relative (cwd = this vault's root).** The vault is usually
  not a sibling of the repositories, so walk up as far as needed — with the
  default layout, `../../repos/<repo>/src/**` reaches
  `C:/repos/<repo>/src/**` from a vault under `C:/obsidian/`.
- **Matching is strict and root-anchored** — full match from the vault root,
  no implicit leading `**/` prefix. Use `**` for any depth; `*` matches a
  single path segment (including the repo-name segment, for rules that apply
  to any repo); `?` a single character.
- **Body = the injected rule.** Everything below the front matter is what
  gets injected into context (wrapped in `<extended-rules>`), once per rule
  per agent context per session. Keep it focused and imperative.

```markdown
---
paths:
  - ../../repos/<repo>/plugins/**/*.mjs
---
In <repo> .mjs hook scripts: zero dependencies, Node built-ins only.
```
