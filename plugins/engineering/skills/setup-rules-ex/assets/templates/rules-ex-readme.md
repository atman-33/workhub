# `.claude/rules-ex` — workspace extended rules

> **Not a native Claude Code feature.** Unlike `.claude/rules` (which Claude Code
> loads natively), `rules-ex` is a **custom extension**. It only works because of
> the `engineering@workhub-marketplace` plugin's `inject-extended-rules` hook (Claude
> Code) and its OpenCode mirror `.opencode/plugins/inject-extended-rules-plugin.ts`.
> Without that plugin enabled (or the OpenCode plugin present), files in this folder
> are ignored — nothing is injected.

Cross-cutting rules kept in the workspace and injected when you edit files in
**other** repos, via cwd-relative globs. This is the *extended* form of
`.claude/rules` (which only governs this repo's own files).

Two complementary injection paths:

| Folder | Native? | Loaded by | Scope |
|--------|---------|-----------|-------|
| `.claude/rules` | **Yes** (Claude Code built-in) | Claude Code itself (+ engineering hook for sibling repos) | files of the repo it lives in, via repo-relative `paths:` |
| `.claude/rules-ex` | **No** (custom) | `inject-extended-rules` hook / OpenCode mirror | files in ANY repo, via cwd-relative `..` globs |

## Rule file format

Each `*.md` here needs `paths:` front matter (REQUIRED — a rule with no `paths:`
is skipped). Globs are resolved relative to the workspace root — walk up with
`..` as far as needed to reach the target repo (`../other-repo/**` for sibling
repos, or e.g. `../../repos/other-repo/**` from an Obsidian vault under
`C:/obsidian/`). Matching is strict and root-anchored.

```markdown
---
paths:
  - ../other-repo/plugins/**/*.mjs
---
Rule text injected into context when a matching file is touched.
```

`README.md` itself has no `paths:`, so it is ignored by the hook.

> Tip: when you Read/Edit a file in this folder, an authoring guide is auto-injected
> from `.claude/rules/rules-ex-authoring.md` (a native path-scoped rule).
