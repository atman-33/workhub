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
`paths:` is skipped). Globs are resolved **relative to the vault root** (the
session cwd), and matching is strict and root-anchored (no implicit `**/`).

The vault is usually *not* a sibling of your repositories, so walk up as far
as needed. With the default layout (vault under `C:/obsidian/`, repos under
`C:/repos/`), reach a repo with `../../repos/<repo>/`:

```markdown
---
paths:
  - ../../repos/<repo>/src/**/*.ts
---
Rule text injected into context when a matching file is touched.
```

Use `*` as the repo-name segment for a rule that applies to every repo
(e.g. `../../repos/*/.github/workflows/**`).

`README.md` itself has no `paths:`, so it is ignored by the hook.

> Tip: when you Read/Edit a file in this folder, an authoring guide is
> auto-injected from `.claude/rules/rules-ex-authoring.md` (a native
> path-scoped rule).
