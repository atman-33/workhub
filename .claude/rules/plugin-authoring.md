---
description: Versioning and catalog invariants when editing plugins or the marketplace
paths:
  - "plugins/**"
  - ".claude-plugin/**"
  - "docs/plugins.md"
---

# Plugin authoring rules

- **Every change under `plugins/<name>/` bumps that plugin's version in BOTH
  places**: `plugins/<name>/.claude-plugin/plugin.json` and the matching entry
  in `.claude-plugin/marketplace.json`. The two must never diverge — installed
  copies update based on the marketplace entry. Semver: new/changed
  skills/hooks/agents → minor; wording or doc-only fixes → patch.
- Plugin changes do **not** bump the app version in `src-tauri/Cargo.toml` and
  need no `CHANGELOG.md` entry (those are for app behavior only).
- Adding or removing a plugin: register it in `.claude-plugin/marketplace.json`
  AND add/remove its row in `docs/plugins.md` (required/optional × user/project
  scope + placement rationale). Follow the scope policy there — vault or
  project-context dependent → project scope; personal/machine tool →
  `productivity` (user scope).
- Skills live only in plugins, never in `vault-template/`. The exception is
  `.claude/rules` / `.claude/rules-ex` content, which plugins cannot ship —
  those seeds belong in `vault-template/.claude/`.
- `vault-template/CLAUDE.md` and `templates/task.md` are template-managed
  (overwritten in existing vaults while the `workhub-template` marker line is
  intact) — keep the marker when editing them. Everything else in
  `vault-template/` is copy-if-missing.
