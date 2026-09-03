---
paths:
  - ../workhub/plugins/engineering/hooks/**
  - ../workhub/plugins/**/*.mjs
---

# Example extended rule

This file documents the format consumed by `inject-extended-rules.mjs`. Place real
rules in your WORKSPACE at `<cwd>/.claude/rules-ex/*.md` (e.g.
`C:/obsidian/workhub-vault/.claude/rules-ex/`). They are a complement to a target
repo's own `.claude/rules` (handled by `inject-target-rules.mjs`):

- `.claude/rules` — rules that live WITH the repo they govern.
- `.claude/rules-ex` — cross-cutting rules kept in the workspace (cwd), applied to
  files in ANY repo via cwd-relative globs. `rules-ex` = the *extended* form of
  `.claude/rules`.

## Front matter

- `paths:` is REQUIRED. A rule with no `paths:` is skipped (a cross-cutting rule
  must declare its scope, otherwise it would fire on every file).
- Each glob is resolved **relative to the workspace root (cwd)**, so use `..` to
  reach sibling repos: `../workhub/plugins/**/*.ts`.
- Matching is strict and root-anchored (no implicit `**/` prefix). Use `**` to
  match any depth: `../repo/**/*.ts`. Supports `*` (single segment) and `?`.

## Body

Everything below the front matter is the rule text injected into context (wrapped
in `<extended-rules>`), once per rule per agent context per session.
