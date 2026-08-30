# Vault-local skills

Skills in this folder belong to **this vault's owner only**. Put each one at
`<name>/SKILL.md`; agents go in `.claude/agents/<name>.md`.

## Why this is safe

`_ai/template-manifest.json` lists the app-managed paths one by one, and
`apply_vault_template` only touches paths it lists. `.claude/skills/` and
`.claude/agents/` are not listed, so an app update never overwrites or deletes
what you put here.

## Writing one

- Frontmatter needs `name` and `description`. Add
  `disable-model-invocation: true` when you will always invoke the skill by
  hand — the description then costs no context on every turn.
- Keep reference material in `references/` and executables in `scripts/`, and
  link to them from `SKILL.md`, so the skill body stays short.
- Write in whatever language you work in. These are your own tools.

## Promoting to a plugin

The moment someone else would use it, move it to the workhub repo's
`plugins/<plugin>/skills/` (rewritten in English, since plugins are shared),
add the plugin to `.claude-plugin/marketplace.json` if it is new, then delete
the vault copy so there is one source of truth.

## OpenCode

`.opencode/scripts/sync-claude-skills.mjs` mirrors both the enabled plugins'
skills and this folder into `.opencode/skills/` (agents into `.opencode/agent/`).
If a vault-local skill has the same name as a plugin skill, the plugin wins and
the sync prints a warning — rename yours.
