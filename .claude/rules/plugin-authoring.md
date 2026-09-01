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
  project-context dependent → project scope; personal/machine tool → the
  user-scope plugin whose use it shares (`authoring`, `agent-ops`,
  `claude-tooling`, `zenn`).
- **Plugin scripts are Node ESM (`.mjs`), run with `node`** — never Python,
  bash, or PowerShell. Node is the only runtime the plugin ecosystem already
  guarantees (all hooks are `.mjs`); other runtimes reintroduce per-machine
  environment dependencies. This covers hooks and any `scripts/` shipped
  inside a skill.
- Skills live only in plugins, never in `vault-template/`. The exception is
  `.claude/rules` / `.claude/rules-ex` content, which plugins cannot ship —
  those seeds belong in `vault-template/.claude/`.
- `vault-template/CLAUDE.md` and `templates/task.md` are template-managed
  (overwritten in existing vaults while the `workhub-template` marker line is
  intact) — keep the marker when editing them. Everything else in
  `vault-template/` is copy-if-missing.

## What language a plugin file is written in

The repo default is English, and it holds for everything an agent executes or
another developer maintains: implementation and comments in `hooks/` and
`scripts/`, `SKILL.md` bodies, agent bodies, and every `description` in
`plugin.json` / `marketplace.json`.

**`persona` is a deliberate exception, not an oversight.** Its
`characters/**` and `core/compression.md` stay in Japanese. Do not translate
them, and do not treat them as debt:

- They *are* Japanese. Sentence-final particles, 体言止め, 助詞 dropping and
  the 回答例 blocks cannot be expressed in English — an English rewrite keeps
  every Japanese quotation and adds English prose around it, so the injected
  context grows in both languages at once.
- A character file is read by the model as priming for the register it is
  about to produce. Describing the register in another language weakens that,
  and nothing here can detect the loss: there is no test for whether noctis
  still sounds like noctis.
- The saving does not justify it. Measured 2026-08-30, the SessionStart
  payload (`persona-activate.mjs`: one character body + the active level of
  `compression.md` + `boundaries.md`, all filtered) is ~3,200 characters at
  62% CJK — roughly 2,250 tokens once per session. A full translation lands
  near 30% off that, concentrated in exactly the content that resists
  translation.

Two related decisions that follow from the same reasoning:

- Skill and agent `description` frontmatter in `persona` keeps its Japanese
  trigger phrases (「口調を変えて」 and friends). They are what makes the skill
  discoverable from a Japanese request; English there costs recall to save a
  few tokens.
- If the injected payload ever has to shrink, **shorten the Japanese rather
  than translate it**. Same saving, none of the risk above.

`README.md` and other maintainer-facing prose in `persona` may stay Japanese
too — it is never injected, so the language costs nothing and its readers are
Japanese speakers. Every other plugin is English throughout.
