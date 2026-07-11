# `.claude/rules-ex` — vault extended rules

> **Not a native Claude Code feature.** Unlike `.claude/rules` (which Claude Code
> loads natively), `rules-ex` is a **custom extension**. It only works because of
> the `engineering@workhub-marketplace` plugin's `inject-extended-rules` hook
> (Claude Code) and its OpenCode mirror plugin. Without that plugin enabled,
> files in this folder are ignored — nothing is injected.

Cross-cutting rules kept in the vault and injected when you edit files in
target repositories, via cwd-relative globs. This is the *extended* form of
`.claude/rules` (which only governs files under the vault itself).

| Folder | Native? | Loaded by | Scope |
|--------|---------|-----------|-------|
| `.claude/rules` | **Yes** (Claude Code built-in) | Claude Code itself | files under this vault, via vault-relative `paths:` |
| `.claude/rules-ex` | **No** (custom) | `inject-extended-rules` hook / OpenCode mirror | files in ANY repo, via cwd-relative globs |

## Rule file format

Each `*.md` here needs `paths:` front matter (REQUIRED — a rule with no
`paths:` is skipped). Matching is strict and root-anchored (no implicit
`**/`). Two glob forms are supported:

**Project-name globs (recommended).** Start the glob with the NAME of a
project registered in `.claude/project-context.json`; the rest is matched
against the file's path relative to that project's root. This keeps rules
independent of where repositories live on each machine:

```markdown
---
paths:
  - workhub/src/**/*.ts
---
Rule text injected into context when a matching file is touched.
```

**Cwd-relative globs.** Resolved relative to the vault root (the session
cwd); walk up with `..` as far as needed — with the default layout (vault
under `C:/obsidian/`, repos under `C:/repos/`), e.g.
`../../repos/<repo>/src/**`. Useful for repos not registered in
project-context.json.

In either form, `*` works as the project/repo-name segment for a rule that
applies to every project (e.g. `*/.github/workflows/**`).

`README.md` itself has no `paths:`, so it is ignored by the hook.

> Tip: when you Read/Edit a file in this folder, an authoring guide is
> auto-injected from `.claude/rules/rules-ex-authoring.md` (a native
> path-scoped rule).
